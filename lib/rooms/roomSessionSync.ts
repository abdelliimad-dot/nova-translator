import type { LiveConnectionStatus } from "@/lib/ai/geminiLiveClient";
import { findLanguage, type SupportedLanguage } from "@/lib/languages";
import type { ParticipantRole, PublicRoomSnapshot } from "@/lib/rooms/roomStore";

export interface AuthoritativeRoomLanguages {
  myLang: SupportedLanguage;
  partnerLang: SupportedLanguage;
  pairKey: string;
}

export interface SynchronizedTranslatorHandle {
  connect(): Promise<void>;
  disconnect(): void;
  sendAudioStreamEnd(): void;
  getStatus?(): LiveConnectionStatus;
}

export interface RoomLanguageSyncDeps {
  getRole(): ParticipantRole;
  isSessionActive(): boolean;
  isSpeaking(): boolean;
  createTranslator(
    langs: AuthoritativeRoomLanguages,
    epoch: number
  ): SynchronizedTranslatorHandle;
  onBeforeReplace(opts: {
    previousClient: SynchronizedTranslatorHandle | null;
    hadActiveSpeech: boolean;
  }): void;
  onActiveClientChanged(
    client: SynchronizedTranslatorHandle | null,
    langs: AuthoritativeRoomLanguages | null
  ): void;
  /**
   * Emits authoritative user-facing translator status derived from actual
   * Gemini `setupComplete` readiness and replacement failure state.
   */
  onStatusChange?(status: LiveConnectionStatus, detail?: string): void;
  onFatalError?(message: string): Promise<void> | void;
}

/**
 * Compute the single authoritative spoken/partner language pair from the
 * server room snapshot and the verified participant role.
 */
export function resolveAuthoritativeRoomLanguages(
  role: ParticipantRole,
  room: Pick<PublicRoomSnapshot, "hostLangCode" | "guestLangCode">
): AuthoritativeRoomLanguages {
  const myCode = role === "host" ? room.hostLangCode : room.guestLangCode;
  const partnerCode = role === "host" ? room.guestLangCode : room.hostLangCode;
  const myLang = findLanguage(myCode);
  const partnerLang = findLanguage(partnerCode);
  return {
    myLang,
    partnerLang,
    pairKey: `${myLang.code}->${partnerLang.code}`,
  };
}

/**
 * Serializes Mode B translator session starts, stops, readiness transitions,
 * and live language-pair updates (`PATCH`, `SSE lang_update`, or polling snapshots):
 * - Never emits `"connected"` before Gemini sends `setupComplete`.
 * - Gates audio readiness strictly to verified `setupComplete` on the active epoch.
 * - Coalesces rapid consecutive language updates with zero duplicate sessions.
 * - Transitions explicitly to `"error"` (never stuck on `"reconnecting"`) if a
 *   replacement fails before session teardown.
 * - Deterministically drops all callbacks from superseded/closing sessions.
 */
export class RoomLanguageSyncController {
  private deps: RoomLanguageSyncDeps;
  private epoch = 0;
  private activeClient: SynchronizedTranslatorHandle | null = null;
  private activePairKey: string | null = null;
  private activeMode: "initial" | "reconfiguring" = "initial";
  private readyForAudio = false;
  private transitionInFlight = false;
  private pendingRoom: PublicRoomSnapshot | null = null;
  private latestRoom: PublicRoomSnapshot | null = null;

  constructor(deps: RoomLanguageSyncDeps) {
    this.deps = deps;
  }

  public getEpoch(): number {
    return this.epoch;
  }

  public getActivePairKey(): string | null {
    return this.activePairKey;
  }

  public getLatestRoom(): PublicRoomSnapshot | null {
    return this.latestRoom;
  }

  public getActiveClient(): SynchronizedTranslatorHandle | null {
    return this.activeClient;
  }

  public isReadyForAudio(): boolean {
    return this.readyForAudio && this.activeClient !== null;
  }

  public isCurrentCallback(
    callbackEpoch: number,
    client: SynchronizedTranslatorHandle
  ): boolean {
    return callbackEpoch === this.epoch && this.activeClient === client;
  }

  /**
   * Authoritative translator lifecycle bridge called by the active client's
   * `onStatusChange` callback. Filters stale sessions and ensures `"connected"`
   * only surfaces after `setupComplete`.
   */
  public handleTranslatorStatus(
    callbackEpoch: number,
    client: SynchronizedTranslatorHandle,
    status: LiveConnectionStatus,
    detail?: string
  ): boolean {
    if (!this.isCurrentCallback(callbackEpoch, client)) {
      return false;
    }

    if (status === "connected") {
      this.readyForAudio = true;
      this.activeMode = "initial";
      this.deps.onStatusChange?.("connected", detail);
      return true;
    }

    if (status === "connecting") {
      this.readyForAudio = false;
      // Preserve `"reconnecting"` UX while swapping language until new `setupComplete` arrives
      const effectiveStatus: LiveConnectionStatus =
        this.activeMode === "reconfiguring" ? "reconnecting" : "connecting";
      this.deps.onStatusChange?.(effectiveStatus, detail);
      return true;
    }

    if (status === "reconnecting") {
      this.readyForAudio = false;
      this.deps.onStatusChange?.("reconnecting", detail);
      return true;
    }

    if (status === "error") {
      this.readyForAudio = false;
      this.activeMode = "initial";
      this.deps.onStatusChange?.("error", detail);
      return true;
    }

    // "idle" or "disconnected"
    this.readyForAudio = false;
    this.deps.onStatusChange?.(status, detail);
    return true;
  }

  public async beginFreshSession(
    room: PublicRoomSnapshot
  ): Promise<{
    client: SynchronizedTranslatorHandle;
    epoch: number;
    langs: AuthoritativeRoomLanguages;
  }> {
    this.latestRoom = room;
    this.pendingRoom = null;
    this.teardownCurrentClient();

    const epoch = ++this.epoch;
    this.activeMode = "initial";
    this.readyForAudio = false;
    const langs = resolveAuthoritativeRoomLanguages(this.deps.getRole(), room);
    const client = this.deps.createTranslator(langs, epoch);
    this.activeClient = client;
    this.activePairKey = langs.pairKey;
    this.deps.onActiveClientChanged(client, langs);
    this.deps.onStatusChange?.("connecting");
    return { client, epoch, langs };
  }

  public teardownCurrentClient(): number {
    const nextEpoch = ++this.epoch;
    const prev = this.activeClient;
    const hadActiveSpeech = this.deps.isSpeaking();

    this.activeClient = null;
    this.activePairKey = null;
    this.activeMode = "initial";
    this.readyForAudio = false;
    this.pendingRoom = null;
    this.deps.onActiveClientChanged(null, null);

    if (prev) {
      this.deps.onBeforeReplace({ previousClient: prev, hadActiveSpeech });
      try {
        prev.disconnect();
      } catch {
        // Ignore disconnect error on superseded session
      }
    }

    return nextEpoch;
  }

  /**
   * Synchronize active translation session whenever the room language pair
   * changes (via local PATCH, remote partner SSE `lang_update`, or polling).
   */
  public async syncWithRoomSnapshot(room: PublicRoomSnapshot): Promise<void> {
    this.latestRoom = room;
    if (!this.deps.isSessionActive()) {
      return;
    }

    const nextLangs = resolveAuthoritativeRoomLanguages(
      this.deps.getRole(),
      room
    );

    if (!this.transitionInFlight && nextLangs.pairKey === this.activePairKey) {
      return;
    }

    // Coalesce rapid updates cleanly instead of launching duplicate connections
    this.pendingRoom = room;
    if (this.transitionInFlight) {
      return;
    }

    this.transitionInFlight = true;
    try {
      while (this.pendingRoom && this.deps.isSessionActive()) {
        const targetRoom = this.pendingRoom;
        this.pendingRoom = null;

        const targetLangs = resolveAuthoritativeRoomLanguages(
          this.deps.getRole(),
          targetRoom
        );
        if (targetLangs.pairKey === this.activePairKey) {
          continue;
        }

        const prevClient = this.activeClient;
        const hadActiveSpeech = this.deps.isSpeaking();
        const swapEpoch = ++this.epoch;

        this.activeClient = null;
        this.activePairKey = null;
        this.activeMode = "reconfiguring";
        this.readyForAudio = false;
        this.deps.onActiveClientChanged(null, null);

        if (prevClient) {
          this.deps.onBeforeReplace({
            previousClient: prevClient,
            hadActiveSpeech,
          });
          try {
            prevClient.disconnect();
          } catch {
            // Ignore close errors while replacing
          }
        }

        this.deps.onStatusChange?.(
          "reconnecting",
          `Updating live translator to ${targetLangs.myLang.label} ↔ ${targetLangs.partnerLang.label}...`
        );

        const nextClient = this.deps.createTranslator(targetLangs, swapEpoch);
        this.activeClient = nextClient;
        this.activePairKey = targetLangs.pairKey;
        this.deps.onActiveClientChanged(nextClient, targetLangs);

        try {
          await nextClient.connect();
        } catch (err) {
          if (swapEpoch !== this.epoch || !this.deps.isSessionActive()) {
            // Superseded by intentional stop/unmount or a newer language update
            try {
              nextClient.disconnect();
            } catch {
              // Ignore
            }
            continue;
          }
          const msg =
            err instanceof Error
              ? err.message
              : "Failed to switch translation language.";
          this.activeClient = null;
          this.activePairKey = null;
          this.activeMode = "initial";
          this.readyForAudio = false;
          this.pendingRoom = null;
          this.deps.onActiveClientChanged(null, null);
          try {
            nextClient.disconnect();
          } catch {
            // Ignore
          }
          this.deps.onStatusChange?.("error", msg);
          await this.deps.onFatalError?.(msg);
          break;
        }

        // If stopped manually, errored via socket callback, or superseded mid-connect(), clean up
        if (
          swapEpoch !== this.epoch ||
          !this.deps.isSessionActive() ||
          this.activeClient !== nextClient
        ) {
          if (this.activeClient === nextClient) {
            this.activeClient = null;
            this.activePairKey = null;
            this.readyForAudio = false;
            this.deps.onActiveClientChanged(null, null);
          }
          try {
            nextClient.disconnect();
          } catch {
            // Ignore
          }
          continue;
        }

        // Do NOT emit `"connected"` here: readiness arrives strictly via
        // `handleTranslatorStatus(..., "connected")` once Gemini emits `setupComplete`.
        if (nextClient.getStatus?.() === "connected" && !this.readyForAudio) {
          this.handleTranslatorStatus(swapEpoch, nextClient, "connected");
        }
      }
    } finally {
      this.transitionInFlight = false;
    }
  }
}
