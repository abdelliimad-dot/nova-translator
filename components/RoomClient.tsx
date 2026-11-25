"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import AudioSettingsDrawer from "@/components/AudioSettingsDrawer";
import AudioVisualizer from "@/components/AudioVisualizer";
import EarbudTestModal from "@/components/EarbudTestModal";
import LanguageFlag from "@/components/nova/LanguageFlag";
import RecoveryBanner from "@/components/nova/RecoveryBanner";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  MicIcon,
  MicOffIcon,
  PhoneCallIcon,
  PhoneOffIcon,
  QrCodeIcon,
  SettingsGearIcon,
  SpeakerPlayIcon,
  TrashIcon,
  VolumeMutedIcon,
} from "@/components/nova/NovaIcons";
import RoomQRCode from "@/components/RoomQRCode";
import {
  GeminiLiveTranslatorClient,
  type LiveConnectionStatus,
} from "@/lib/ai/geminiLiveClient";
import {
  getMicManager,
  listMicDevices,
  type ClassifiedMicDevice,
} from "@/lib/audio/micManager";
import {
  appendTurnAudioChunk,
  clearTurnAudioCache,
  replayTurnAudio,
} from "@/lib/audio/replayHelper";
import { getStereoEngine } from "@/lib/audio/stereoEngine";
import { VadManager } from "@/lib/audio/vadManager";
import {
  WebRtcCallManager,
  type CallConnectionState,
} from "@/lib/audio/webrtcCallManager";
import { useIsOnline } from "@/lib/hooks/useNetworkStatus";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { LANGUAGE_ARABIC_NAMES } from "@/lib/i18n";
import {
  findLanguage,
  formatTranscriptForExport,
  SUPPORTED_LANGUAGES,
} from "@/lib/languages";
import type {
  ParticipantRole,
  PublicRoomSnapshot,
  RelayedAudioPacket,
  RelayedSignalPacket,
  RoomServerEvent,
  RoomTranscriptItem,
} from "@/lib/rooms/roomStore";
import {
  triggerHaptic,
  updateNovaSettings,
  useNovaSettings,
} from "@/lib/settingsStore";
import {
  clearPersistedRoomMessages,
  mergeAndSaveRoomMessages,
  upsertPersistedRoomMessage,
  usePersistedRoomMessages,
} from "@/lib/transcriptStore";

type CaptureMode = "vad" | "ptt";
type RoomSyncStatus = "connecting" | "connected" | "reconnecting" | "error";

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const evenSamples = Math.floor(bytes.byteLength / 2);
  if (evenSamples <= 0) return new Int16Array(0);
  return new Int16Array(bytes.slice(0, evenSamples * 2).buffer);
}

function mergeInt16Chunks(chunks: Int16Array[]): Int16Array {
  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Int16Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function formatCallDuration(totalSec: number): string {
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default function RoomClient() {
  const params = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();
  const roomId = (params?.roomId ?? "").toUpperCase();
  const role: ParticipantRole =
    searchParams.get("role") === "host" ? "host" : "guest";
  const initiallyConfirmed =
    role === "host" || searchParams.get("confirmed") === "1";

  const settings = useNovaSettings();
  const isOnline = useIsOnline();
  const isArabicUi = settings.uiLocale === "ar";
  const persistedMessages = usePersistedRoomMessages(roomId);

  const [room, setRoom] = useState<PublicRoomSnapshot | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomEnded, setRoomEnded] = useState(false);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [endingRoom, setEndingRoom] = useState(false);
  const [roomSyncStatus, setRoomSyncStatus] =
    useState<RoomSyncStatus>("connecting");
  const [retrySeed, setRetrySeed] = useState(0);
  const [ephemeralMessages, setEphemeralMessages] = useState<
    RoomTranscriptItem[]
  >([]);
  const [joinConfirmed, setJoinConfirmed] = useState(initiallyConfirmed);
  const [showQR, setShowQR] = useState(role === "host");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [earbudTestOpen, setEarbudTestOpen] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const [replayingMessageId, setReplayingMessageId] = useState<string | null>(
    null
  );

  // Audio & Gemini Live state
  const [liveStatus, setLiveStatus] = useState<LiveConnectionStatus>("idle");
  const [isRunning, setIsRunning] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [pttActive, setPttActive] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [partnerOutputLevel, setPartnerOutputLevel] = useState(0);
  const [remoteVoiceLevel, setRemoteVoiceLevel] = useState(0);
  const [isVoiceDucked, setIsVoiceDucked] = useState(false);
  const [callState, setCallState] = useState<CallConnectionState>("idle");
  const [callElapsedSec, setCallElapsedSec] = useState(0);
  const [originalVoiceEnabled, setOriginalVoiceEnabled] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [micDevices, setMicDevices] = useState<ClassifiedMicDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [activeMicLabel, setActiveMicLabel] = useState<string | null>(null);
  const [isBluetoothMicRisk, setIsBluetoothMicRisk] = useState(false);
  const [audioCtxState, setAudioCtxState] = useState<
    AudioContextState | "uninitialized"
  >("uninitialized");
  const [audioChannelCount, setAudioChannelCount] = useState(0);

  const captureMode: CaptureMode = settings.captureMode;
  const messages = settings.saveTranscripts
    ? persistedMessages
    : ephemeralMessages;
  const wakeLockActive = useWakeLock(isRunning && settings.wakeLockEnabled);

  const clientRef = useRef<GeminiLiveTranslatorClient | null>(null);
  const vadRef = useRef<VadManager | null>(null);
  const callManagerRef = useRef<WebRtcCallManager | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteAudioUsingFallbackRef = useRef(false);
  const originalVoiceEnabledRef = useRef(true);
  const voiceCallDesiredRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Audio relay batching refs
  const audioBatchRef = useRef<Int16Array[]>([]);
  const audioBatchSamplesRef = useRef(0);
  const audioSampleRateRef = useRef(24000);
  const audioSeqRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranscriptSentRef = useRef(0);
  const lastReceivedAudioSeqRef = useRef(0);
  const lastReceivedSignalSeqRef = useRef(0);
  const initialSignalCursorSyncedRef = useRef(false);
  const latestPartnerMessageIdRef = useRef<string | null>(null);
  const sseActiveRef = useRef(false);
  const pttActiveRef = useRef(false);
  const captureModeRef = useRef<CaptureMode>(captureMode);
  const saveTranscriptsRef = useRef(settings.saveTranscripts);

  useEffect(() => {
    captureModeRef.current = captureMode;
  }, [captureMode]);

  useEffect(() => {
    saveTranscriptsRef.current = settings.saveTranscripts;
  }, [settings.saveTranscripts]);

  useEffect(() => {
    originalVoiceEnabledRef.current = originalVoiceEnabled;
  }, [originalVoiceEnabled]);

  useEffect(() => {
    if (callState !== "connected") return;
    const timer = setInterval(() => {
      setCallElapsedSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [callState]);

  const getOrCreateCallManager = useCallback(() => {
    if (callManagerRef.current) return callManagerRef.current;

    const manager = new WebRtcCallManager(role, {
      onStateChange: (state, detail) => {
        setCallState(state);
        if (state === "idle" || state === "disconnected") {
          setCallElapsedSec(0);
          setIsVoiceDucked(false);
          setRemoteVoiceLevel(0);
        }
        if (state === "error" && detail) {
          setStatusError(detail);
        }
      },
      onRemoteStream: (stream) => {
        const engine = getStereoEngine();
        const webAudioAttached = engine.attachRemoteVoiceStream(stream);
        engine.setOriginalVoiceMode(originalVoiceEnabledRef.current);
        remoteAudioUsingFallbackRef.current = !webAudioAttached;

        const audioEl = remoteAudioRef.current;
        if (audioEl) {
          audioEl.srcObject = stream;
          // Mute the direct <audio> element when Web Audio GainNode owns smart ducking;
          // unmute cleanly only as a browser fallback if createMediaStreamSource fails.
          audioEl.muted = webAudioAttached;
          audioEl.volume = webAudioAttached
            ? 1.0
            : originalVoiceEnabledRef.current
              ? 0.85
              : 0;
          void audioEl.play().catch(() => {});
        }
      },
      onRemoteEnded: () => {
        getStereoEngine().detachRemoteVoiceStream();
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = null;
        }
        setRemoteVoiceLevel(0);
        setIsVoiceDucked(false);
        setCallElapsedSec(0);
      },
      onSignal: async (kind, payload) => {
        try {
          await fetch(`/api/rooms/${roomId}/relay`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role, kind, payload }),
          });
        } catch {
          // Non-fatal network blip; ICE/fallback poll retries
        }
      },
    });

    callManagerRef.current = manager;
    return manager;
  }, [role, roomId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const syncAudioDiagnostics = useCallback(() => {
    const diag = getStereoEngine().getDiagnostics();
    setAudioCtxState(diag.contextState);
    setAudioChannelCount(diag.channelCount);
  }, []);

  // Poll partner incoming audio, WebRTC voice level & AudioContext state while live
  useEffect(() => {
    if (!isRunning && callState !== "connected") return;
    let active = true;
    const tick = () => {
      if (!active) return;
      const engine = getStereoEngine();
      const lv = engine.getChannelLevels();
      setPartnerOutputLevel(Math.max(lv.left, lv.right));
      setRemoteVoiceLevel(engine.getRemoteVoiceLevel());
      setIsVoiceDucked(engine.isVoiceDucked());
      const diag = engine.getDiagnostics();
      setAudioCtxState(diag.contextState);
      setAudioChannelCount(diag.channelCount);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setPartnerOutputLevel(0);
      setRemoteVoiceLevel(0);
      setIsVoiceDucked(false);
    };
  }, [isRunning, callState]);

  const flushAudioRelay = useCallback(async () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (audioBatchRef.current.length === 0) return;

    const merged = mergeInt16Chunks(audioBatchRef.current);
    const sampleRate = audioSampleRateRef.current;
    const seq = ++audioSeqRef.current;
    audioBatchRef.current = [];
    audioBatchSamplesRef.current = 0;

    try {
      await fetch(`/api/rooms/${roomId}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          kind: "audio",
          data: int16ToBase64(merged),
          sampleRate,
          seq,
        }),
      });
    } catch {
      // Non-fatal network blip
    }
  }, [role, roomId]);

  const queueAudioForPartner = useCallback(
    (pcm16: Int16Array, sampleRate: number) => {
      audioSampleRateRef.current = sampleRate;
      audioBatchRef.current.push(pcm16);
      audioBatchSamplesRef.current += pcm16.length;

      if (audioBatchSamplesRef.current >= Math.round(sampleRate * 0.16)) {
        void flushAudioRelay();
      } else if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => {
          void flushAudioRelay();
        }, 120);
      }
    },
    [flushAudioRelay]
  );

  const stopAudioSession = useCallback(async () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    audioBatchRef.current = [];
    audioBatchSamplesRef.current = 0;

    callManagerRef.current?.hangup(true);
    getStereoEngine().detachRemoteVoiceStream();
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    if (vadRef.current) {
      await vadRef.current.destroy();
      vadRef.current = null;
    }
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    getStereoEngine().stopAll();
    setIsRunning(false);
    setIsMuted(false);
    setIsSpeaking(false);
    setPttActive(false);
    pttActiveRef.current = false;
    setInputLevel(0);
    setRemoteVoiceLevel(0);
    setIsVoiceDucked(false);
    setCallState("idle");
    setCallElapsedSec(0);
    setLiveStatus("disconnected");
    syncAudioDiagnostics();
  }, [syncAudioDiagnostics]);

  // SSE + 1000ms fallback polling (preserved intact from Phase 3)
  useEffect(() => {
    if (!roomId) return;

    let cancelled = false;
    sseActiveRef.current = false;

    const syncMessagesFromServer = (serverMsgs: RoomTranscriptItem[]) => {
      const latestPartner = [...serverMsgs]
        .reverse()
        .find((m) => m.sender !== role);
      if (latestPartner) {
        latestPartnerMessageIdRef.current = latestPartner.id;
      }
      if (saveTranscriptsRef.current) {
        mergeAndSaveRoomMessages(roomId, serverMsgs);
      } else {
        setEphemeralMessages(serverMsgs);
      }
    };

    const upsertSingleMessage = (item: RoomTranscriptItem) => {
      if (item.sender !== role) {
        latestPartnerMessageIdRef.current = item.id;
      }
      if (saveTranscriptsRef.current) {
        upsertPersistedRoomMessage(roomId, item);
      } else {
        setEphemeralMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === item.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = item;
            return copy;
          }
          return [...prev.slice(-49), item];
        });
      }
    };

    const applyRoomSnapshot = (snap: PublicRoomSnapshot) => {
      setRoom(snap);
      syncMessagesFromServer(snap.messages);
      setRoomError(null);
      setRoomSyncStatus("connected");
      if (snap.ended) {
        setRoomEnded(true);
        void stopAudioSession();
        return;
      }
      if (snap.latestAudioSeq > lastReceivedAudioSeqRef.current) {
        lastReceivedAudioSeqRef.current = snap.latestAudioSeq;
      }
      if (!initialSignalCursorSyncedRef.current) {
        initialSignalCursorSyncedRef.current = true;
        if (snap.latestSignalSeq > lastReceivedSignalSeqRef.current) {
          lastReceivedSignalSeqRef.current = snap.latestSignalSeq;
        }
      }
      if (role === "host" && snap.guestConnected) {
        setShowQR(false);
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      if (!cancelled) {
        setRoomSyncStatus("error");
        setRoomError(
          `Timed out connecting to room ${roomId} after 5 seconds.`
        );
      }
    }, 5000);

    void fetch(`/api/rooms/${roomId}?role=${role}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timeoutId);
        const data = (await res.json()) as {
          room?: PublicRoomSnapshot;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.room) {
          setRoomSyncStatus("error");
          setRoomError(data.error || "Room not found.");
          return;
        }
        applyRoomSnapshot(data.room);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setRoomSyncStatus("error");
        setRoomError("Unable to reach room server.");
      });

    const es = new EventSource(`/api/rooms/${roomId}/events?role=${role}`);
    es.onmessage = (ev) => {
      sseActiveRef.current = true;
      setRoomSyncStatus("connected");
      try {
        const parsed = JSON.parse(ev.data) as RoomServerEvent;
        if (parsed.type === "init") {
          applyRoomSnapshot(parsed.room);
        } else if (parsed.type === "presence") {
          setRoom(parsed.room);
          if (role === "host" && parsed.room.guestConnected) {
            setShowQR(false);
          }
        } else if (parsed.type === "lang_update") {
          setRoom(parsed.room);
        } else if (parsed.type === "transcript") {
          upsertSingleMessage(parsed.item);
        } else if (parsed.type === "audio") {
          if (
            parsed.sender !== role &&
            parsed.seq > lastReceivedAudioSeqRef.current
          ) {
            lastReceivedAudioSeqRef.current = parsed.seq;
            const pcm16 = base64ToInt16(parsed.data);
            if (pcm16.length > 0) {
              if (latestPartnerMessageIdRef.current) {
                appendTurnAudioChunk(
                  `room:${latestPartnerMessageIdRef.current}`,
                  pcm16,
                  parsed.sampleRate
                );
              }
              getStereoEngine().enqueuePcm16(pcm16, 0.0, parsed.sampleRate);
            }
          }
        } else if (parsed.type === "interrupted") {
          if (parsed.sender !== role) {
            getStereoEngine().stopAll();
          }
        } else if (parsed.type === "webrtc_signal") {
          if (
            parsed.sender !== role &&
            parsed.seq > lastReceivedSignalSeqRef.current
          ) {
            lastReceivedSignalSeqRef.current = parsed.seq;
            void getOrCreateCallManager().handleIncomingSignal(
              parsed.kind,
              parsed.payload
            );
          }
        } else if (parsed.type === "room_ended") {
          setRoomEnded(true);
          setRoom((prev) => (prev ? { ...prev, ended: true } : prev));
          void stopAudioSession();
        } else if (parsed.type === "error") {
          setRoomSyncStatus("error");
          setRoomError(parsed.error);
        }
      } catch {
        // Ignore malformed SSE payload
      }
    };

    es.onerror = () => {
      sseActiveRef.current = false;
      if (!cancelled) {
        setRoomSyncStatus((prev) => (prev === "error" ? prev : "reconnecting"));
      }
    };

    const pollTimer = setInterval(() => {
      if (cancelled || sseActiveRef.current) return;
      void fetch(
        `/api/rooms/${roomId}?role=${role}&afterAudioSeq=${lastReceivedAudioSeqRef.current}&afterSignalSeq=${lastReceivedSignalSeqRef.current}`,
        { cache: "no-store" }
      )
        .then(async (res) => {
          if (!res.ok || cancelled) return;
          const data = (await res.json()) as {
            room?: PublicRoomSnapshot;
            audio?: RelayedAudioPacket[];
            signals?: RelayedSignalPacket[];
          };
          if (data.room) {
            setRoom(data.room);
            syncMessagesFromServer(data.room.messages);
            if (data.room.ended) {
              setRoomEnded(true);
              void stopAudioSession();
              return;
            }
            if (role === "host" && data.room.guestConnected) {
              setShowQR(false);
            }
          }
          if (data.signals && data.signals.length > 0) {
            const callMgr = getOrCreateCallManager();
            for (const sig of data.signals) {
              if (sig.seq > lastReceivedSignalSeqRef.current) {
                lastReceivedSignalSeqRef.current = sig.seq;
                void callMgr.handleIncomingSignal(sig.kind, sig.payload);
              }
            }
          }
          if (data.audio && data.audio.length > 0) {
            for (const pkt of data.audio) {
              if (pkt.seq > lastReceivedAudioSeqRef.current) {
                lastReceivedAudioSeqRef.current = pkt.seq;
                const pcm16 = base64ToInt16(pkt.data);
                if (pcm16.length > 0) {
                  if (latestPartnerMessageIdRef.current) {
                    appendTurnAudioChunk(
                      `room:${latestPartnerMessageIdRef.current}`,
                      pcm16,
                      pkt.sampleRate
                    );
                  }
                  getStereoEngine().enqueuePcm16(pcm16, 0.0, pkt.sampleRate);
                }
              }
            }
          }
        })
        .catch(() => {});
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      clearInterval(pollTimer);
      controller.abort();
      es.close();
    };
  }, [roomId, role, retrySeed, stopAudioSession, getOrCreateCallManager]);

  useEffect(() => {
    return () => {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
      void stopAudioSession();
    };
  }, [stopAudioSession]);

  const startAudioSession = useCallback(
    async (unlockedCtx: AudioContext, currentRoom: PublicRoomSnapshot) => {
      setStatusError(null);
      setLiveStatus("connecting");

      const myLang = findLanguage(
        role === "host" ? currentRoom.hostLangCode : currentRoom.guestLangCode
      );
      const partnerLang = findLanguage(
        role === "host" ? currentRoom.guestLangCode : currentRoom.hostLangCode
      );

      try {
        if (unlockedCtx.state === "suspended") {
          await unlockedCtx.resume();
        }
        syncAudioDiagnostics();

        const client = new GeminiLiveTranslatorClient({
          langACode: myLang.code,
          langALabel: myLang.label,
          langBCode: partnerLang.code,
          langBLabel: partnerLang.label,
          voiceName: settings.voiceName,
          speakerOverride: "A",
          callbacks: {
            onStatusChange: (s) => setLiveStatus(s),
            onTranscriptUpdate: (turn) => {
              const now = Date.now();
              if (!turn.isFinal && now - lastTranscriptSentRef.current < 240) {
                return;
              }
              lastTranscriptSentRef.current = now;

              const item: RoomTranscriptItem = {
                id: `${role}-${turn.id}`,
                sender: role,
                sourceText: turn.sourceText,
                translatedText: turn.translatedText,
                sourceLang: myLang.code,
                targetLang: partnerLang.code,
                isFinal: turn.isFinal,
                timestamp: turn.timestamp,
              };

              void fetch(`/api/rooms/${roomId}/relay`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role, kind: "transcript", item }),
              });

              if (turn.isFinal) {
                void flushAudioRelay();
              }
            },
            onAudioOutput: (pcm16, sampleRate, _channel, turnId) => {
              if (turnId) {
                appendTurnAudioChunk(`room:${role}-${turnId}`, pcm16, sampleRate);
              }
              queueAudioForPartner(pcm16, sampleRate);
            },
            onInterrupted: () => {
              audioBatchRef.current = [];
              audioBatchSamplesRef.current = 0;
              void fetch(`/api/rooms/${roomId}/relay`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role, kind: "interrupted" }),
              });
            },
            onError: (msg) => setStatusError(msg),
          },
        });

        clientRef.current = client;
        await client.connect();

        const micInfo = await getMicManager().acquireMic(
          selectedMicId || undefined
        );
        setSelectedMicId(micInfo.deviceId);
        setActiveMicLabel(micInfo.label);
        setIsBluetoothMicRisk(micInfo.isBluetoothRisk);
        getStereoEngine().unlockSync();
        syncAudioDiagnostics();
        void listMicDevices().then((res) => setMicDevices(res.devices));

        const vad = new VadManager({
          onInputLevel: (level) => setInputLevel(level),
          onSpeechStart: () => {
            if (captureModeRef.current === "vad") {
              setIsSpeaking(true);
            }
          },
          onSpeechEnd: () => {
            if (captureModeRef.current === "vad") {
              setIsSpeaking(false);
              client.sendAudioStreamEnd();
            }
          },
          onVADMisfire: () => {
            if (captureModeRef.current === "vad") {
              setIsSpeaking(false);
            }
          },
          onAudioFrame: (pcm16) => {
            if (captureModeRef.current === "vad" || pttActiveRef.current) {
              client.sendPcm16Frame(pcm16);
            }
          },
          onError: (msg) => setStatusError(msg),
        });

        vadRef.current = vad;
        await vad.start({
          stream: micInfo.stream,
          preferredDeviceId: micInfo.deviceId || undefined,
          audioContext: unlockedCtx,
          sensitivity: settings.vadSensitivity,
        });

        getStereoEngine().unlockSync();
        syncAudioDiagnostics();
        setIsRunning(true);
        setIsMuted(false);

        if (voiceCallDesiredRef.current) {
          const callMgr = getOrCreateCallManager();
          await callMgr.startCall(micInfo.stream, false);
        }
      } catch (err) {
        setStatusError(
          err instanceof Error ? err.message : "Failed to start room audio."
        );
        await stopAudioSession();
      }
    },
    [
      flushAudioRelay,
      getOrCreateCallManager,
      queueAudioForPartner,
      role,
      roomId,
      selectedMicId,
      settings.vadSensitivity,
      settings.voiceName,
      stopAudioSession,
      syncAudioDiagnostics,
    ]
  );

  const handleStartLive = (withVoiceCall: boolean) => {
    if (!room) return;
    triggerHaptic(settings.hapticsEnabled, 12);
    if (isRunning) {
      void stopAudioSession();
      return;
    }
    voiceCallDesiredRef.current = withVoiceCall;
    const ctx = getStereoEngine().unlockSync();
    syncAudioDiagnostics();
    void startAudioSession(ctx, room);
  };

  const handleToggleStart = () => {
    handleStartLive(true);
  };

  const handleToggleVoiceCall = async () => {
    if (!isRunning) return;
    triggerHaptic(settings.hapticsEnabled, 10);
    const callMgr = getOrCreateCallManager();
    if (callState !== "idle" && callState !== "disconnected") {
      callMgr.hangup(true);
      getStereoEngine().detachRemoteVoiceStream();
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
      }
      setCallElapsedSec(0);
      setIsVoiceDucked(false);
      setRemoteVoiceLevel(0);
      return;
    }
    const micStream = getMicManager().getActiveMic()?.stream;
    if (micStream) {
      await callMgr.startCall(micStream, isMuted);
    } else {
      const micInfo = await getMicManager().acquireMic(selectedMicId || undefined);
      await callMgr.startCall(micInfo.stream, isMuted);
    }
  };

  const handleToggleOriginalVoice = () => {
    triggerHaptic(settings.hapticsEnabled, 8);
    const next = !originalVoiceEnabled;
    setOriginalVoiceEnabled(next);
    getStereoEngine().setOriginalVoiceMode(next);
    if (remoteAudioRef.current && remoteAudioUsingFallbackRef.current) {
      remoteAudioRef.current.volume = next ? 0.85 : 0;
    }
  };

  const handleToggleMute = async () => {
    triggerHaptic(settings.hapticsEnabled, 10);
    const engine = getStereoEngine();
    const ctx = engine.unlockSync();
    syncAudioDiagnostics();
    if (!isRunning) return;
    if (isMuted) {
      setIsMuted(false);
      callManagerRef.current?.setLocalMuted(false);
      if (vadRef.current) {
        await vadRef.current.start({
          preferredDeviceId: selectedMicId || undefined,
          audioContext: ctx,
          sensitivity: settings.vadSensitivity,
        });
      }
      engine.unlockSync();
    } else {
      setIsMuted(true);
      setIsSpeaking(false);
      setInputLevel(0);
      callManagerRef.current?.setLocalMuted(true);
      if (vadRef.current) {
        await vadRef.current.pause();
      }
    }
  };

  const handleSetCaptureMode = (mode: CaptureMode) => {
    triggerHaptic(settings.hapticsEnabled, 8);
    updateNovaSettings({ captureMode: mode });
  };

  const handlePttDown = () => {
    getStereoEngine().unlockSync();
    syncAudioDiagnostics();
    if (!isRunning || captureMode !== "ptt") return;
    triggerHaptic(settings.hapticsEnabled, 10);
    pttActiveRef.current = true;
    setPttActive(true);
    setIsSpeaking(true);
  };

  const handlePttUp = () => {
    if (!pttActiveRef.current) return;
    pttActiveRef.current = false;
    setPttActive(false);
    setIsSpeaking(false);
    clientRef.current?.sendAudioStreamEnd();
  };

  const handleLanguageChange = async (newLangCode: string) => {
    if (!room) return;
    const body =
      role === "host" ? { hostLang: newLangCode } : { guestLang: newLangCode };
    const res = await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as { room: PublicRoomSnapshot };
      setRoom(data.room);
      if (isRunning) {
        const ctx = getStereoEngine().unlockSync();
        await stopAudioSession();
        await startAudioSession(ctx, data.room);
      }
    }
  };

  const handleSelectMic = async (deviceId: string) => {
    const engine = getStereoEngine();
    const ctx = engine.unlockSync();
    syncAudioDiagnostics();
    setSelectedMicId(deviceId);
    if (vadRef.current && isRunning && !isMuted) {
      await vadRef.current.pause();
      const micInfo = await getMicManager().acquireMic(deviceId || undefined);
      setActiveMicLabel(micInfo.label);
      setIsBluetoothMicRisk(micInfo.isBluetoothRisk);
      await callManagerRef.current?.replaceLocalStream(micInfo.stream);
      vadRef.current.setPreferredDeviceId(micInfo.deviceId || undefined);
      await vadRef.current.start({
        stream: micInfo.stream,
        preferredDeviceId: micInfo.deviceId || undefined,
        audioContext: ctx,
        sensitivity: settings.vadSensitivity,
      });
      engine.unlockSync();
      syncAudioDiagnostics();
    }
  };

  const handleCopyTranscript = async () => {
    if (messages.length === 0 || !room) return;
    const myL = findLanguage(
      role === "host" ? room.hostLangCode : room.guestLangCode
    );
    const partnerL = findLanguage(
      role === "host" ? room.guestLangCode : room.hostLangCode
    );
    const text = formatTranscriptForExport(
      messages.map((m) => ({
        speakerLabel:
          m.sender === role
            ? `You (${myL.label})`
            : `Partner (${partnerL.label})`,
        sourceText: m.sourceText,
        translatedText: m.translatedText,
      }))
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const handleClearMessages = () => {
    triggerHaptic(settings.hapticsEnabled, 10);
    clearTurnAudioCache(`room:`);
    clearPersistedRoomMessages(roomId);
    setEphemeralMessages([]);
  };

  const handleBeepTest = () => {
    getStereoEngine().playBeepTestSequence(() => {
      syncAudioDiagnostics();
    });
  };

  const handleEndRoomForEveryone = async () => {
    triggerHaptic(settings.hapticsEnabled, 14);
    setEndingRoom(true);
    try {
      await stopAudioSession();
      await fetch(`/api/rooms/${roomId}`, { method: "DELETE" });
      setRoomEnded(true);
      setRoom((prev) => (prev ? { ...prev, ended: true } : prev));
    } catch {
      setStatusError(
        isArabicUi
          ? "تعذر إنهاء الغرفة على الخادم، تم إيقاف الصوت محليًا."
          : "Could not reach server to close room; local audio was stopped."
      );
    } finally {
      setEndingRoom(false);
      setConfirmEndOpen(false);
    }
  };

  const handleReplayMessage = (
    item: RoomTranscriptItem,
    myLangCode: string,
    partnerLangCode: string
  ) => {
    triggerHaptic(settings.hapticsEnabled, 8);
    const isMine = item.sender === role;
    const textToSpeak = isMine
      ? item.sourceText || item.translatedText
      : item.translatedText || item.sourceText;
    const spokenLangCode = isMine
      ? item.sourceText
        ? myLangCode
        : partnerLangCode
      : item.translatedText
        ? myLangCode
        : partnerLangCode;

    replayTurnAudio({
      turnId: `room:${item.id}`,
      text: textToSpeak,
      langCode: spokenLangCode,
      channel: "both",
    });

    setReplayingMessageId(item.id);
    if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    replayTimerRef.current = setTimeout(() => {
      setReplayingMessageId(null);
    }, 1400);
  };

  const getLangName = (code: string, fallback: string) => {
    if (code === "ar") return "العربية";
    return isArabicUi ? (LANGUAGE_ARABIC_NAMES[code] ?? fallback) : fallback;
  };

  if (roomError) {
    return (
      <main
        dir={isArabicUi ? "rtl" : "ltr"}
        className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center bg-[#F5F3ED] px-6 text-center space-y-4"
      >
        <div className="w-full">
          <RecoveryBanner
            isOnline={isOnline}
            errorMessage={roomError}
            onRetry={() => {
              setRoomError(null);
              setRoomSyncStatus("connecting");
              setRetrySeed((s) => s + 1);
            }}
            isArabicUi={isArabicUi}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setRoomError(null);
              setRoomSyncStatus("connecting");
              setRetrySeed((s) => s + 1);
            }}
            className="min-h-[44px] rounded-full bg-[#315F4A] px-6 text-xs font-semibold text-white transition hover:bg-[#214536]"
          >
            {isArabicUi ? "إعادة المحاولة" : "Retry"}
          </button>
          <Link
            href="/mode-b"
            className="inline-flex min-h-[44px] items-center rounded-full border border-[#E6E5DE] bg-white px-5 text-xs font-semibold text-[#242A26] nova-soft-shadow hover:bg-[#DCE8DD]/40"
          >
            {isArabicUi ? "العودة للوضع B" : "Back to Mode B"}
          </Link>
        </div>
      </main>
    );
  }

  if (roomEnded || room?.ended) {
    return (
      <main
        dir={isArabicUi ? "rtl" : "ltr"}
        className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center bg-[#F5F3ED] px-6 text-center space-y-4"
      >
        <div className="w-full rounded-[26px] border border-[#E6E5DE] bg-white p-6 space-y-3 nova-card-shadow">
          <span
            dir="ltr"
            className="inline-flex rounded-full bg-[#E8D8BF] px-3 py-1 font-mono text-xs font-bold text-[#242A26]"
          >
            {roomId}
          </span>
          <h1 className="text-lg font-bold text-[#242A26]">
            {isArabicUi ? "انتهت جلسة الغرفة" : "Translation Room Ended"}
          </h1>
          <p className="text-xs leading-relaxed text-[#777F79]">
            {isArabicUi
              ? "تم إغلاق هذه الغرفة وإنهاء البث لجميع المشاركين."
              : "This room has been closed and disconnected for all participants."}
          </p>

          {messages.length > 0 && (
            <div className="flex justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleCopyTranscript()}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-4 text-xs font-semibold text-[#315F4A] hover:bg-[#DCE8DD]"
              >
                <CopyIcon className="w-3.5 h-3.5" />
                <span>
                  {copiedToast
                    ? isArabicUi
                      ? "تم النسخ!"
                      : "Copied!"
                    : isArabicUi
                      ? "نسخ المحادثة المحفوظة"
                      : "Copy Saved Transcript"}
                </span>
              </button>
              <button
                type="button"
                onClick={handleClearMessages}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-4 text-xs font-semibold text-[#C76A67] hover:bg-[#C76A67]/12"
              >
                <TrashIcon className="w-3.5 h-3.5" />
                <span>{isArabicUi ? "مسح" : "Clear"}</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href="/mode-b"
            className="inline-flex min-h-[44px] items-center rounded-full bg-[#315F4A] px-6 text-xs font-semibold text-white transition hover:bg-[#214536]"
          >
            {isArabicUi ? "إنشاء غرفة جديدة" : "Create New Room"}
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center rounded-full border border-[#E6E5DE] bg-white px-5 text-xs font-semibold text-[#242A26] nova-soft-shadow hover:bg-[#DCE8DD]/40"
          >
            {isArabicUi ? "الرئيسية" : "Home"}
          </Link>
        </div>
      </main>
    );
  }

  if (!room) {
    return (
      <main
        dir={isArabicUi ? "rtl" : "ltr"}
        className="flex min-h-dvh flex-col items-center justify-center bg-[#F5F3ED] px-6 text-center space-y-4"
      >
        <div className="rounded-[24px] border border-[#E6E5DE] bg-white px-6 py-5 space-y-2 nova-card-shadow">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#DCE8DD] px-3 py-1 text-xs font-semibold text-[#214536]">
            <span className="h-2 w-2 rounded-full bg-[#315F4A] animate-ping" />
            <span dir="ltr" className="font-mono">
              {roomId}
            </span>
          </span>
          <p className="text-sm font-semibold text-[#242A26]">
            {isArabicUi
              ? `جاري الاتصال بالغرفة ${roomId}...`
              : `Connecting to room ${roomId}...`}
          </p>
          <p className="text-xs text-[#777F79]">
            {isArabicUi
              ? "يتم تهيئة البث المباشر..."
              : "Setting up real-time room sync..."}
          </p>
        </div>
        <Link
          href="/mode-b"
          className="inline-flex min-h-[44px] items-center rounded-full border border-[#E6E5DE] bg-white px-5 text-xs font-semibold text-[#242A26] nova-soft-shadow"
        >
          {isArabicUi ? "العودة للوضع B" : "Back to Mode B"}
        </Link>
      </main>
    );
  }

  const partnerConnected =
    role === "host" ? room.guestConnected : room.hostConnected;
  const myLang = findLanguage(
    role === "host" ? room.hostLangCode : room.guestLangCode
  );
  const partnerLang = findLanguage(
    role === "host" ? room.guestLangCode : room.hostLangCode
  );

  return (
    <div
      dir={isArabicUi ? "rtl" : "ltr"}
      className="mx-auto flex h-[100dvh] w-full max-w-xl flex-col overflow-hidden bg-[#F5F3ED] text-[#242A26]"
    >
      {/* Top NOVA Room Header */}
      <header className="border-b border-[#E6E5DE] bg-white px-3.5 py-2.5 space-y-2.5 nova-soft-shadow">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link
              href="/mode-b"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-3 text-xs font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]/60"
            >
              <ArrowLeftIcon
                className={`w-3.5 h-3.5 ${isArabicUi ? "rotate-180" : ""}`}
              />
              <span>{isArabicUi ? "الغرف" : "Rooms"}</span>
            </Link>

            <span
              dir="ltr"
              className="inline-flex min-h-[36px] items-center rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-3 font-mono text-xs font-bold text-[#214536]"
            >
              {room.id}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Presence + Connection State Pill */}
            <span
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold ${
                roomSyncStatus === "reconnecting"
                  ? "border-[#C28B47]/40 bg-[#E8D8BF] text-[#242A26]"
                  : partnerConnected
                    ? "border-[#A8BDA9] bg-[#DCE8DD] text-[#214536]"
                    : "border-[#C58B62]/40 bg-[#E8D8BF]/70 text-[#242A26]"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  roomSyncStatus === "reconnecting"
                    ? "bg-[#C28B47] animate-ping"
                    : partnerConnected
                      ? "bg-[#4C8062]"
                      : "bg-[#C58B62] animate-ping"
                }`}
              />
              <span>
                {roomSyncStatus === "reconnecting"
                  ? isArabicUi
                    ? "مزامنة احتياطية"
                    : "Syncing"
                  : partnerConnected
                    ? isArabicUi
                      ? "الشريك متصل"
                      : "Partner connected"
                    : isArabicUi
                      ? "بانتظار الشريك"
                      : "Waiting"}
              </span>
            </span>

            {messages.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => void handleCopyTranscript()}
                  aria-label={isArabicUi ? "نسخ المحادثة" : "Copy transcript"}
                  className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-2.5 text-xs font-semibold text-[#315F4A] hover:bg-[#DCE8DD]"
                >
                  <CopyIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {copiedToast ? "✓" : isArabicUi ? "نسخ" : "Copy"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleClearMessages}
                  aria-label={isArabicUi ? "مسح السجل" : "Clear transcript"}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#E6E5DE] bg-[#F5F3ED] text-[#777F79] hover:bg-[#C76A67]/15 hover:text-[#C76A67]"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setShowQR((v) => !v)}
              aria-label={showQR ? "Hide QR code" : "Show QR code"}
              className={`inline-flex h-11 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition ${
                showQR
                  ? "border-[#315F4A] bg-[#DCE8DD] text-[#214536]"
                  : "border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]/60"
              }`}
            >
              <QrCodeIcon className="w-4 h-4" />
              <span>{isArabicUi ? "QR" : showQR ? "Hide" : "QR"}</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmEndOpen(true)}
              aria-label={isArabicUi ? "إنهاء الغرفة للجميع" : "End room for everyone"}
              className="inline-flex min-h-[44px] items-center rounded-full border border-[#C76A67]/40 bg-[#C76A67]/10 px-3 text-xs font-semibold text-[#C76A67] transition hover:bg-[#C76A67]/20"
            >
              {isArabicUi ? "إنهاء" : "End"}
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={isArabicUi ? "الإعدادات" : "Open settings drawer"}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${
                isBluetoothMicRisk
                  ? "border-[#C28B47] bg-[#E8D8BF] text-[#242A26]"
                  : "border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]"
              }`}
            >
              <SettingsGearIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Language Strip */}
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#E6E5DE] bg-[#F5F3ED] px-3 py-1.5 text-xs">
          <div className="relative flex min-h-[38px] items-center gap-1.5 min-w-0">
            <LanguageFlag code={myLang.code} size={18} />
            <span className="text-[#777F79] font-medium">
              {isArabicUi ? "أنت:" : "You:"}
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-[#315F4A] truncate">
              {getLangName(myLang.code, myLang.label)}
              <ChevronDownIcon className="w-3 h-3 shrink-0" />
            </span>
            <select
              aria-label="Your spoken language"
              value={myLang.code}
              onChange={(e) => void handleLanguageChange(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.native})
                </option>
              ))}
            </select>
          </div>

          <span className="text-[#A8BDA9] font-semibold">↔</span>

          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[#777F79] font-medium">
              {isArabicUi ? "الشريك:" : "Partner:"}
            </span>
            <LanguageFlag code={partnerLang.code} size={18} />
            <span className="font-semibold text-[#C58B62] truncate">
              {getLangName(partnerLang.code, partnerLang.label)}
            </span>
          </div>
        </div>
      </header>

      {/* Collapsible QR Invite Card */}
      {showQR && (
        <div className="border-b border-[#E6E5DE] bg-[#F5F3ED] p-3">
          <RoomQRCode roomId={room.id} compact />
        </div>
      )}

      {/* Live Chat Transcript */}
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col overflow-y-auto px-4 py-4 space-y-3 overscroll-contain"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center px-4">
            <div className="max-w-sm rounded-[24px] border border-[#E6E5DE] bg-white p-5 space-y-2 nova-card-shadow">
              <p className="text-sm font-semibold text-[#242A26]">
                {partnerConnected
                  ? isArabicUi
                    ? "تم اتصال الشريك! اضغط بدء الصوت المباشر وتحدّث."
                    : "Partner is connected! Tap Start Live Audio below and speak."
                  : isArabicUi
                    ? "شارك رمز QR مع شريكك ثم اضغط بدء الصوت المباشر."
                    : "Share the QR code with your partner, then tap Start Live Audio."}
              </p>
              <p className="text-xs leading-relaxed text-[#777F79]">
                {isArabicUi
                  ? `تتحدث بـ ${getLangName(myLang.code, myLang.label)} وتسمع ترجمة شريكك إلى ${getLangName(myLang.code, myLang.label)}.`
                  : `You speak in ${myLang.label} and hear your partner translated into ${myLang.label}.`}
              </p>
            </div>
          </div>
        ) : (
          messages.map((item) => {
            const isMine = item.sender === role;
            const mainText = isMine
              ? item.sourceText || "..."
              : item.translatedText || "...";
            const subText = isMine ? item.translatedText : item.sourceText;
            const mainDir = myLang.rtl ? "rtl" : "ltr";
            const subDir = partnerLang.rtl ? "rtl" : "ltr";
            const isReplaying = replayingMessageId === item.id;

            return (
              <div
                key={item.id}
                className={`max-w-[88%] rounded-2xl border px-4 py-3 nova-soft-shadow ${
                  isMine
                    ? "self-end border-[#A8BDA9] bg-[#DCE8DD]/65"
                    : "self-start border-[#E6E5DE] bg-white"
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      isMine ? "text-[#214536]" : "text-[#C58B62]"
                    }`}
                  >
                    {isMine
                      ? isArabicUi
                        ? `أنت (${getLangName(myLang.code, myLang.label)})`
                        : `You (${myLang.label})`
                      : isArabicUi
                        ? `الشريك → ${getLangName(myLang.code, myLang.label)}`
                        : `Partner → ${myLang.label}`}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {!item.isFinal && (
                      <span className="text-[10px] font-semibold text-[#315F4A] animate-pulse">
                        {isArabicUi ? "مباشر" : "live"}
                      </span>
                    )}
                    {item.isFinal && (
                      <button
                        type="button"
                        onClick={() =>
                          handleReplayMessage(
                            item,
                            myLang.code,
                            partnerLang.code
                          )
                        }
                        aria-label={
                          isArabicUi ? "إعادة تشغيل الصوت" : "Replay audio"
                        }
                        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border px-2.5 text-[10px] font-semibold transition active:scale-95 ${
                          isReplaying
                            ? "border-[#315F4A] bg-[#315F4A] text-white"
                            : "border-[#E6E5DE] bg-[#F5F3ED] text-[#315F4A] hover:bg-[#DCE8DD]"
                        }`}
                      >
                        <SpeakerPlayIcon className="w-3.5 h-3.5" />
                        <span>{isArabicUi ? "تشغيل" : "Play"}</span>
                      </button>
                    )}
                  </div>
                </div>

                <p
                  dir={mainDir}
                  className="text-[15px] font-semibold leading-snug text-[#242A26]"
                >
                  {mainText}
                </p>
                {subText && (
                  <p dir={subDir} className="mt-1 text-xs text-[#777F79]">
                    {subText}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Hidden WebRTC remote peer audio element (muted when Web Audio GainNode owns smart ducking) */}
      <audio
        ref={remoteAudioRef}
        playsInline
        autoPlay
        muted
        className="hidden"
      />

      {/* Live Voice Call & Translation Control Bar */}
      <footer className="border-t border-[#E6E5DE] bg-white px-3.5 py-3 space-y-2.5 shadow-[0_-4px_20px_-8px_rgba(33,69,54,0.1)]">
        <RecoveryBanner
          isOnline={isOnline}
          errorMessage={statusError}
          onRetry={!isRunning ? handleToggleStart : undefined}
          onDismiss={() => setStatusError(null)}
          isArabicUi={isArabicUi}
          compact
        />

        {/* Status / Timer / Ducking Row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                callState === "connected"
                  ? "border-[#A8BDA9] bg-[#DCE8DD] text-[#214536]"
                  : callState === "connecting" || callState === "reconnecting"
                    ? "border-[#C28B47]/40 bg-[#E8D8BF]/70 text-[#242A26]"
                    : isRunning
                      ? "border-[#A8BDA9] bg-[#F5F3ED] text-[#315F4A]"
                      : "border-[#E6E5DE] bg-[#F5F3ED] text-[#777F79]"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  callState === "connected"
                    ? "bg-[#4C8062]"
                    : callState === "connecting" || callState === "reconnecting"
                      ? "bg-[#C28B47] animate-ping"
                      : isRunning
                        ? "bg-[#315F4A] animate-pulse"
                        : "bg-[#A8BDA9]"
                }`}
              />
              <span>
                {callState === "connected"
                  ? isArabicUi
                    ? "المكالمة متصلة"
                    : "Call Connected"
                  : callState === "connecting"
                    ? isArabicUi
                      ? "جاري ربط المكالمة..."
                      : "Connecting Call..."
                    : callState === "reconnecting"
                      ? isArabicUi
                        ? "إعادة ربط المكالمة..."
                        : "Reconnecting..."
                      : isRunning
                        ? isArabicUi
                          ? `ترجمة AI · ${liveStatus}`
                          : `AI Live · ${liveStatus}`
                        : isArabicUi
                          ? "جاهز للمكالمة"
                          : "Ready for Call"}
              </span>
            </span>

            {(callState === "connected" || callElapsedSec > 0) && (
              <span
                dir="ltr"
                className="rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#214536] tabular-nums"
              >
                {formatCallDuration(callElapsedSec)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <AudioVisualizer
              level={Math.max(inputLevel, partnerOutputLevel, remoteVoiceLevel)}
              active={
                isSpeaking ||
                partnerOutputLevel > 0.04 ||
                remoteVoiceLevel > 0.04
              }
              accent="forest"
              compact
            />
          </div>
        </div>

        {/* Capture Mode + Voice Call / Smart Ducking Mode Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex min-h-[44px] items-center rounded-full border border-[#E6E5DE] bg-[#F5F3ED] p-0.5">
            <button
              type="button"
              onClick={() => handleSetCaptureMode("vad")}
              className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-[11px] font-semibold transition ${
                captureMode === "vad"
                  ? "bg-[#214536] text-white"
                  : "text-[#777F79] hover:text-[#242A26]"
              }`}
            >
              {isArabicUi ? "تلقائي" : "Auto-VAD"}
            </button>
            <button
              type="button"
              onClick={() => handleSetCaptureMode("ptt")}
              className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-[11px] font-semibold transition ${
                captureMode === "ptt"
                  ? "bg-[#214536] text-white"
                  : "text-[#777F79] hover:text-[#242A26]"
              }`}
            >
              {isArabicUi ? "اضغط للتحدث" : "Push-to-Talk"}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {isRunning && (
              <button
                type="button"
                onClick={() => void handleToggleVoiceCall()}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition active:scale-[0.98] ${
                  callState !== "idle" && callState !== "disconnected"
                    ? "border-[#315F4A] bg-[#DCE8DD] text-[#214536]"
                    : "border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]/60"
                }`}
              >
                <PhoneCallIcon className="w-3.5 h-3.5" />
                <span>
                  {callState !== "idle" && callState !== "disconnected"
                    ? isArabicUi
                      ? "الصوت P2P مفعّل"
                      : "Voice Call On"
                    : isArabicUi
                      ? "تفعيل المكالمة"
                      : "Join Voice Call"}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleToggleOriginalVoice}
              aria-label={
                originalVoiceEnabled
                  ? "Original Voice + AI Dubbing"
                  : "AI Translation Only"
              }
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition active:scale-[0.98] ${
                originalVoiceEnabled
                  ? isVoiceDucked
                    ? "border-[#315F4A] bg-[#DCE8DD]/80 text-[#214536]"
                    : "border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]/50"
                  : "border-[#C58B62]/50 bg-[#E8D8BF] text-[#242A26]"
              }`}
            >
              {originalVoiceEnabled ? (
                <SpeakerPlayIcon className="w-3.5 h-3.5 text-[#315F4A]" />
              ) : (
                <VolumeMutedIcon className="w-3.5 h-3.5 text-[#C58B62]" />
              )}
              <span>
                {originalVoiceEnabled
                  ? isVoiceDucked
                    ? isArabicUi
                      ? "خفض الصوت (AI)"
                      : "Original (Ducked)"
                    : isArabicUi
                      ? "الأصلي + AI"
                      : "Original + AI"
                  : isArabicUi
                    ? "ترجمة AI فقط"
                    : "AI Only"}
              </span>
            </button>
          </div>
        </div>

        {/* Main Call & Mic Actions */}
        <div className="flex flex-wrap gap-2">
          {!isRunning ? (
            <>
              <button
                type="button"
                onClick={() => handleStartLive(true)}
                className="inline-flex min-h-[48px] flex-1 min-w-[160px] items-center justify-center gap-2 rounded-full bg-[#315F4A] px-5 text-xs font-semibold text-white shadow-[0_6px_16px_-4px_rgba(33,69,54,0.38)] transition hover:bg-[#214536] active:scale-[0.98]"
              >
                <PhoneCallIcon className="w-4 h-4" />
                <span>
                  {isArabicUi ? "بدء مكالمة بالترجمة" : "Start Live Call"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleStartLive(false)}
                className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-4 text-xs font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]/60 active:scale-[0.98]"
              >
                {isArabicUi ? "ترجمة AI فقط" : "AI Dub Only"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleToggleMute()}
                className={`inline-flex min-h-[48px] flex-1 min-w-[116px] items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition active:scale-[0.98] ${
                  isMuted
                    ? "bg-[#E8D8BF] text-[#242A26] border border-[#C28B47]/40"
                    : "border border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]"
                }`}
              >
                {isMuted ? (
                  <MicIcon className="w-4 h-4 text-[#315F4A]" />
                ) : (
                  <MicOffIcon className="w-4 h-4 text-[#777F79]" />
                )}
                <span>
                  {isMuted
                    ? isArabicUi
                      ? "تشغيل الميكروفون"
                      : "Unmute Mic"
                    : isSpeaking
                      ? isArabicUi
                        ? "يتحدث..."
                        : "Speaking..."
                      : isArabicUi
                        ? "كتم الميكروفون"
                        : "Mute Mic"}
                </span>
              </button>

              {captureMode === "ptt" && (
                <button
                  type="button"
                  onPointerDown={handlePttDown}
                  onPointerUp={handlePttUp}
                  onPointerCancel={handlePttUp}
                  onPointerLeave={handlePttUp}
                  className={`inline-flex min-h-[48px] flex-1 min-w-[130px] select-none items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition ${
                    pttActive
                      ? "bg-[#214536] text-white"
                      : "border border-[#315F4A]/40 bg-[#DCE8DD] text-[#214536]"
                  }`}
                >
                  <MicIcon className="w-4 h-4" />
                  <span>
                    {pttActive
                      ? isArabicUi
                        ? "اترك للإرسال"
                        : "Release to Send"
                      : isArabicUi
                        ? "اضغط للتحدث"
                        : "Hold to Speak"}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={handleToggleStart}
                className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-full border border-[#C76A67]/40 bg-[#C76A67]/12 px-4 text-xs font-semibold text-[#C76A67] transition hover:bg-[#C76A67]/20 active:scale-[0.98]"
              >
                <PhoneOffIcon className="w-4 h-4" />
                <span>{isArabicUi ? "إنهاء المكالمة" : "End Call"}</span>
              </button>
            </>
          )}
        </div>
      </footer>

      {/* Direct QR Camera Guest Join Confirmation Modal */}
      {!joinConfirmed && role === "guest" && (
        <div
          dir={isArabicUi ? "rtl" : "ltr"}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#242A26]/45 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="direct-join-confirm-title"
        >
          <div className="w-full max-w-md rounded-t-[28px] sm:rounded-[28px] border border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.25)] p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2
                  id="direct-join-confirm-title"
                  className="text-base font-bold text-[#242A26]"
                >
                  {isArabicUi
                    ? `الانضمام إلى الغرفة ${room.id}`
                    : `Join Room ${room.id}`}
                </h2>
                <p className="text-xs text-[#777F79]">
                  {isArabicUi
                    ? "اختر لغتك وتأكد من استعدادك لبدء المحادثة"
                    : "Confirm your spoken language before entering the conversation"}
                </p>
              </div>
              <span
                dir="ltr"
                className="rounded-full bg-[#DCE8DD] px-3 py-1 font-mono text-xs font-bold text-[#214536]"
              >
                {room.id}
              </span>
            </div>

            <div className="rounded-2xl border border-[#E6E5DE] bg-white p-4 space-y-3 nova-soft-shadow">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#777F79]">
                  {isArabicUi ? "لغة الشريك (المضيف)" : "Partner Speaks (Host)"}
                </span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#242A26]">
                  <LanguageFlag code={partnerLang.code} size={18} />
                  <span>{getLangName(partnerLang.code, partnerLang.label)}</span>
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E6E5DE]">
                <label
                  htmlFor="guest-join-lang"
                  className="text-xs font-semibold text-[#315F4A]"
                >
                  {isArabicUi ? "لغتك المحكية" : "Your Spoken Language"}
                </label>
                <select
                  id="guest-join-lang"
                  value={myLang.code}
                  onChange={(e) => void handleLanguageChange(e.target.value)}
                  className="min-h-[42px] rounded-xl border border-[#E6E5DE] bg-[#F5F3ED] px-3 py-1.5 text-xs font-semibold text-[#242A26] outline-none focus:border-[#315F4A]"
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label} ({l.native})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Link
                href="/mode-b"
                className="inline-flex min-h-[46px] items-center justify-center rounded-full border border-[#E6E5DE] bg-white px-4 text-xs font-semibold text-[#242A26] transition hover:bg-[#F5F3ED]"
              >
                {isArabicUi ? "إلغاء" : "Cancel"}
              </Link>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(settings.hapticsEnabled, 12);
                  getStereoEngine().unlockSync();
                  syncAudioDiagnostics();
                  setJoinConfirmed(true);
                }}
                className="min-h-[46px] rounded-full bg-[#315F4A] px-4 text-xs font-semibold text-white transition hover:bg-[#214536] active:scale-[0.98]"
              >
                {isArabicUi ? "دخول الغرفة" : "Confirm & Join"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm End Room Modal */}
      {confirmEndOpen && (
        <div
          dir={isArabicUi ? "rtl" : "ltr"}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#242A26]/45 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-room-confirm-title"
        >
          <div className="w-full max-w-md rounded-t-[28px] sm:rounded-[28px] border border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.25)] p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2
                  id="end-room-confirm-title"
                  className="text-base font-bold text-[#242A26]"
                >
                  {isArabicUi
                    ? "إنهاء الغرفة للجميع؟"
                    : "End Room for Everyone?"}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-[#777F79]">
                  {isArabicUi
                    ? "سيتم فصل الهاتفين وإغلاق رابط الدعوة لهذه الغرفة."
                    : "This disconnects both phones and permanently closes this room invite."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmEndOpen(false)}
                aria-label={isArabicUi ? "إلغاء" : "Cancel"}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E6E5DE] bg-white text-[#242A26]"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmEndOpen(false)}
                className="min-h-[46px] rounded-full border border-[#E6E5DE] bg-white px-4 text-xs font-semibold text-[#242A26] hover:bg-[#F5F3ED]"
              >
                {isArabicUi ? "إلغاء" : "Keep Room Open"}
              </button>
              <button
                type="button"
                disabled={endingRoom}
                onClick={() => void handleEndRoomForEveryone()}
                className="min-h-[46px] rounded-full bg-[#C76A67] px-4 text-xs font-semibold text-white transition hover:bg-[#b25855] disabled:opacity-60"
              >
                {endingRoom
                  ? isArabicUi
                    ? "جاري الإنهاء..."
                    : "Ending..."
                  : isArabicUi
                    ? "إنهاء للجميع"
                    : "End for Everyone"}
              </button>
            </div>
          </div>
        </div>
      )}

      <AudioSettingsDrawer
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        micDevices={micDevices}
        selectedMicId={selectedMicId}
        activeMicLabel={activeMicLabel}
        isBluetoothMicRisk={isBluetoothMicRisk}
        onSelectMic={(id) => void handleSelectMic(id)}
        audioCtxState={audioCtxState}
        audioChannelCount={audioChannelCount}
        wakeLockActive={wakeLockActive}
        onBeepTest={handleBeepTest}
        onOpenEarbudTest={() => setEarbudTestOpen(true)}
        transcriptCount={messages.length}
        onExportTranscript={handleCopyTranscript}
        onClearTranscripts={handleClearMessages}
      />

      <EarbudTestModal
        isOpen={earbudTestOpen}
        onClose={() => setEarbudTestOpen(false)}
        langALabel={myLang.label}
        langBLabel={partnerLang.label}
      />
    </div>
  );
}
