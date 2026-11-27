"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import AudioSettingsDrawer from "@/components/AudioSettingsDrawer";
import AudioVisualizer from "@/components/AudioVisualizer";
import ConversationSummaryModal from "@/components/nova/ConversationSummaryModal";
import EarbudTestModal from "@/components/EarbudTestModal";
import LanguageFlag from "@/components/nova/LanguageFlag";
import RecoveryBanner from "@/components/nova/RecoveryBanner";
import {
  ArrowLeftIcon,
  CameraFlipIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  MicIcon,
  MicOffIcon,
  PhoneCallIcon,
  PhoneOffIcon,
  QrCodeIcon,
  SendArrowIcon,
  SettingsGearIcon,
  SparklesIcon,
  SpeakerPlayIcon,
  StarIcon,
  TrashIcon,
  VideoCamIcon,
  VideoOffCamIcon,
  VolumeMutedIcon,
} from "@/components/nova/NovaIcons";
import RoomQRCode from "@/components/RoomQRCode";
import {
  buildSavedPhraseKey,
  toggleSavedPhrase,
  useSavedPhrases,
} from "@/lib/favoritesStore";
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
import {
  resolveAuthoritativeRoomLanguages,
  RoomLanguageSyncController,
  type SynchronizedTranslatorHandle,
} from "@/lib/rooms/roomSessionSync";
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

function createRoomTextItem(params: {
  sender: ParticipantRole;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
}): RoomTranscriptItem {
  const now = Date.now();
  return {
    id: `text-${params.sender}-${now}-${Math.random().toString(36).slice(2, 6)}`,
    sender: params.sender,
    sourceText: params.sourceText,
    translatedText: params.translatedText,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
    isFinal: true,
    timestamp: now,
  };
}

export default function RoomClient() {
  const params = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();
  const roomId = (params?.roomId ?? "").toUpperCase();

  const [verifiedRole, setVerifiedRole] = useState<ParticipantRole | null>(
    null
  );
  const role: ParticipantRole = verifiedRole ?? "guest";
  const roleRef = useRef<ParticipantRole>(role);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const [hostInviteToken, setHostInviteToken] = useState<string | null>(null);
  const [hostPasscode, setHostPasscode] = useState<string | null>(null);
  const scrubbedInviteRef = useRef<string | null>(null);
  const [scrubbedInviteToken, setScrubbedInviteToken] = useState<string | null>(
    null
  );
  const [needsJoinAuth, setNeedsJoinAuth] = useState(false);
  const [joinPasscodeInput, setJoinPasscodeInput] = useState("");
  const [joinLangChoice, setJoinLangChoice] = useState("en");
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [joinAuthError, setJoinAuthError] = useState<string | null>(null);

  const settings = useNovaSettings();
  const isOnline = useIsOnline();
  const isArabicUi = settings.uiLocale === "ar";
  const persistedMessages = usePersistedRoomMessages(roomId);
  const savedPhrases = useSavedPhrases();
  const savedKeys = new Set(
    savedPhrases.map((s) => buildSavedPhraseKey(s.sourceText, s.translatedText))
  );

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
  const [joinConfirmed, setJoinConfirmed] = useState(
    searchParams.get("confirmed") === "1"
  );
  const [showQR, setShowQR] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [earbudTestOpen, setEarbudTestOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [textChatInput, setTextChatInput] = useState("");
  const [sendingTextChat, setSendingTextChat] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const [replayingMessageId, setReplayingMessageId] = useState<string | null>(
    null
  );
  const [visibleMessageLimit, setVisibleMessageLimit] = useState(60);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

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
  const [iceState, setIceState] = useState<RTCIceConnectionState>("new");
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

  const [videoEnabled, setVideoEnabled] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("user");
  const [remoteVideoActive, setRemoteVideoActive] = useState(false);
  const [remoteVideoStream, setRemoteVideoStream] = useState<MediaStream | null>(null);
  const [showVideoSubtitles, setShowVideoSubtitles] = useState(true);

  const clientRef = useRef<GeminiLiveTranslatorClient | null>(null);
  const vadRef = useRef<VadManager | null>(null);
  const callManagerRef = useRef<WebRtcCallManager | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localVideoElRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoElRef = useRef<HTMLVideoElement | null>(null);
  const localVideoStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioUsingFallbackRef = useRef(false);
  const originalVoiceEnabledRef = useRef(true);
  const voiceCallDesiredRef = useRef(true);
  const videoDesiredRef = useRef(false);
  const callStateRef = useRef<CallConnectionState>("idle");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Audio relay batching refs
  const audioBatchRef = useRef<Int16Array[]>([]);
  const audioBatchSamplesRef = useRef(0);
  const audioBatchTurnIdRef = useRef<string | undefined>(undefined);
  const audioSampleRateRef = useRef(24000);
  const audioSeqRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranscriptSentRef = useRef(0);
  const lastReceivedAudioSeqRef = useRef(0);
  const lastReceivedSignalSeqRef = useRef(0);
  const initialAudioCursorSyncedRef = useRef(false);
  const initialSignalCursorSyncedRef = useRef(false);
  const lastSseMessageAtRef = useRef(0);
  const latestPartnerMessageIdRef = useRef<string | null>(null);
  const sseActiveRef = useRef(false);
  const pttActiveRef = useRef(false);
  const isStartingRef = useRef(false);
  const isRunningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const voiceNameRef = useRef(settings.voiceName);
  const captureModeRef = useRef<CaptureMode>(captureMode);
  const saveTranscriptsRef = useRef(settings.saveTranscripts);
  const sessionSyncRef = useRef<RoomLanguageSyncController | null>(null);

  useEffect(() => {
    captureModeRef.current = captureMode;
  }, [captureMode]);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    voiceNameRef.current = settings.voiceName;
  }, [settings.voiceName]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) {
      return;
    }
    const handleDeviceChange = () => {
      void listMicDevices()
        .then((res) => setMicDevices(res.devices))
        .catch(() => {});
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    return getStereoEngine().attachLifecycleRecovery((state) => {
      setAudioCtxState(state);
      if (state === "suspended") {
        setStatusError("Audio suspended by OS; tap screen or restart live audio to resume.");
      } else if (state === "running") {
        setStatusError(null);
      }
    });
  }, [isRunning]);

  useEffect(() => {
    saveTranscriptsRef.current = settings.saveTranscripts;
  }, [settings.saveTranscripts]);

  useEffect(() => {
    originalVoiceEnabledRef.current = originalVoiceEnabled;
  }, [originalVoiceEnabled]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    callManagerRef.current?.setRole(role);
  }, [role]);

  useEffect(() => {
    if (callState !== "connected") return;
    const timer = setInterval(() => {
      setCallElapsedSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [callState]);

  const stopLocalVideoStream = useCallback(() => {
    if (localVideoStreamRef.current) {
      for (const track of localVideoStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      }
      localVideoStreamRef.current = null;
    }
    if (localVideoElRef.current) {
      localVideoElRef.current.srcObject = null;
    }
    videoDesiredRef.current = false;
    setVideoEnabled(false);
  }, []);

  useEffect(() => {
    if (videoEnabled && localVideoElRef.current && localVideoStreamRef.current) {
      localVideoElRef.current.srcObject = localVideoStreamRef.current;
      void localVideoElRef.current.play().catch(() => {});
    }
  }, [videoEnabled, cameraFacing]);

  useEffect(() => {
    const stream = remoteVideoStream ?? remoteVideoStreamRef.current;
    const video = remoteVideoElRef.current;
    if (video && stream) {
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      void video.play().catch(() => {});
    }
  }, [remoteVideoStream, videoEnabled, remoteVideoActive]);

  const getOrCreateCallManager = useCallback(() => {
    if (callManagerRef.current) {
      callManagerRef.current.setRole(roleRef.current);
      return callManagerRef.current;
    }

    const manager = new WebRtcCallManager(roleRef.current, {
      onStateChange: (state, detail) => {
        setCallState(state);
        if (state === "idle" || state === "disconnected") {
          setCallElapsedSec(0);
          setIsVoiceDucked(false);
          setRemoteVoiceLevel(0);
          setRemoteVideoActive(false);
          remoteVideoStreamRef.current = null;
          setRemoteVideoStream(null);
        }
        if (state === "error" && detail) {
          setStatusError(detail);
        }
      },
      onIceStateChange: (nextIceState) => {
        setIceState(nextIceState);
        if (nextIceState === "failed") {
          setStatusError(
            "Direct peer connection blocked by network firewall (ICE failed); retrying call route while live translation continues."
          );
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
      onRemoteVideoStream: (stream) => {
        remoteVideoStreamRef.current = stream;
        setRemoteVideoStream(stream);
        if (remoteVideoElRef.current) {
          remoteVideoElRef.current.srcObject = stream;
          if (stream) {
            void remoteVideoElRef.current.play().catch(() => {});
          }
        }
      },
      onRemoteVideoActiveChange: (active) => {
        setRemoteVideoActive(active);
      },
      onRemoteEnded: () => {
        getStereoEngine().detachRemoteVoiceStream();
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = null;
        }
        remoteVideoStreamRef.current = null;
        setRemoteVideoStream(null);
        if (remoteVideoElRef.current) {
          remoteVideoElRef.current.srcObject = null;
        }
        setRemoteVideoActive(false);
        setRemoteVoiceLevel(0);
        setIsVoiceDucked(false);
        setCallElapsedSec(0);
      },
      onSignal: async (kind, payload) => {
        try {
          await fetch(`/api/rooms/${roomId}/relay`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ role: roleRef.current, kind, payload }),
          });
        } catch {
          // Non-fatal network blip; ICE/call-ready retry recovers
        }
      },
    });

    callManagerRef.current = manager;
    return manager;
  }, [roomId]);

  useEffect(() => {
    if (messages.length === 0) return;
    const el = scrollRef.current;
    if (el && isNearBottomRef.current) {
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
    const turnId = audioBatchTurnIdRef.current;
    const seq = ++audioSeqRef.current;
    audioBatchRef.current = [];
    audioBatchSamplesRef.current = 0;

    try {
      await fetch(`/api/rooms/${roomId}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          role: roleRef.current,
          kind: "audio",
          data: int16ToBase64(merged),
          sampleRate,
          ...(turnId ? { turnId } : {}),
          seq,
        }),
      });
    } catch {
      // Non-fatal network blip
    }
  }, [roomId]);

  const queueAudioForPartner = useCallback(
    (pcm16: Int16Array, sampleRate: number, turnId?: string) => {
      if (turnId && audioBatchTurnIdRef.current && audioBatchTurnIdRef.current !== turnId && audioBatchRef.current.length > 0) {
        void flushAudioRelay();
      }
      audioBatchTurnIdRef.current = turnId;
      audioSampleRateRef.current = sampleRate;
      audioBatchRef.current.push(pcm16);
      audioBatchSamplesRef.current += pcm16.length;

      if (audioBatchSamplesRef.current >= Math.round(sampleRate * 0.22)) {
        void flushAudioRelay();
      } else if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => {
          void flushAudioRelay();
        }, 150);
      }
    },
    [flushAudioRelay]
  );

  const syncMessagesFromServer = useCallback(
    (serverMsgs: RoomTranscriptItem[], activeRole: ParticipantRole) => {
      const latestPartner = [...serverMsgs]
        .reverse()
        .find((m) => m.sender !== activeRole);
      if (latestPartner) {
        latestPartnerMessageIdRef.current = latestPartner.id;
      }
      if (saveTranscriptsRef.current) {
        mergeAndSaveRoomMessages(roomId, serverMsgs);
      } else {
        setEphemeralMessages(serverMsgs);
      }
    },
    [roomId]
  );

  const upsertSingleMessage = useCallback(
    (item: RoomTranscriptItem, activeRole: ParticipantRole) => {
      if (item.sender !== activeRole) {
        latestPartnerMessageIdRef.current = item.id;
      }
      if (saveTranscriptsRef.current) {
        upsertPersistedRoomMessage(roomId, item);
      } else {
        setEphemeralMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === item.id);
          const next =
            idx >= 0
              ? prev.map((existing, i) => (i === idx ? item : existing))
              : [...prev, item];
          return next.sort((a, b) => a.timestamp - b.timestamp);
        });
      }
    },
    [roomId]
  );

  const stopAudioSession = useCallback(
    async (preserveErrorStatus = false) => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      audioBatchRef.current = [];
      audioBatchSamplesRef.current = 0;

      callManagerRef.current?.hangup(true);
      stopLocalVideoStream();
      remoteVideoStreamRef.current = null;
      setRemoteVideoStream(null);
      if (remoteVideoElRef.current) {
        remoteVideoElRef.current.srcObject = null;
      }
      setRemoteVideoActive(false);
      setIceState("new");
      getStereoEngine().detachRemoteVoiceStream();
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
      }

      if (vadRef.current) {
        await vadRef.current.destroy();
        vadRef.current = null;
      }
      isStartingRef.current = false;
      isRunningRef.current = false;
      sessionSyncRef.current?.teardownCurrentClient();
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      getStereoEngine().stopAll();
      setIsRunning(false);
      setIsMuted(false);
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      setPttActive(false);
      pttActiveRef.current = false;
      setInputLevel(0);
      setRemoteVoiceLevel(0);
      setIsVoiceDucked(false);
      setCallState("idle");
      setCallElapsedSec(0);
      if (!preserveErrorStatus) {
        setLiveStatus("disconnected");
      }
      syncAudioDiagnostics();
    },
    [stopLocalVideoStream, syncAudioDiagnostics]
  );

  // SSE + 1000ms fallback polling (preserved intact from Phase 3)
  useEffect(() => {
    if (!roomId) return;

    // Scrub URL fragment invite token immediately before any room HTTP request
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash && hash.includes("invite=")) {
        const hashParams = new URLSearchParams(hash.slice(1));
        const extracted = hashParams.get("invite")?.trim();
        if (extracted && extracted.length >= 8 && extracted.length <= 128) {
          scrubbedInviteRef.current = extracted;
        }
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search
        );
      }
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    sseActiveRef.current = false;

    const applyRoomSnapshot = (
      snap: PublicRoomSnapshot,
      activeRole: ParticipantRole
    ) => {
      setRoom(snap);
      syncMessagesFromServer(snap.messages, activeRole);
      setRoomError(null);
      setNeedsJoinAuth(false);
      setRoomSyncStatus("connected");
      if (snap.ended) {
        setRoomEnded(true);
        void stopAudioSession();
        return;
      }
      void sessionSyncRef.current?.syncWithRoomSnapshot(snap);
      if (!initialAudioCursorSyncedRef.current) {
        initialAudioCursorSyncedRef.current = true;
        if (snap.latestAudioSeq > lastReceivedAudioSeqRef.current) {
          lastReceivedAudioSeqRef.current = snap.latestAudioSeq;
        }
      }
      if (!initialSignalCursorSyncedRef.current) {
        initialSignalCursorSyncedRef.current = true;
        if (snap.latestSignalSeq > lastReceivedSignalSeqRef.current) {
          lastReceivedSignalSeqRef.current = snap.latestSignalSeq;
        }
      }
      if (activeRole === "host" && snap.guestConnected) {
        setShowQR(false);
      }
    };

    const startRealtimeStreams = (activeRole: ParticipantRole) => {
      if (cancelled) return;

      es = new EventSource(`/api/rooms/${roomId}/events`);
      es.onmessage = (ev) => {
        sseActiveRef.current = true;
        lastSseMessageAtRef.current = Date.now();
        setRoomSyncStatus("connected");
        const currentRole = roleRef.current || activeRole;
        try {
          const parsed = JSON.parse(ev.data) as RoomServerEvent & {
            error?: string;
          };
          if (parsed.type === "init") {
            applyRoomSnapshot(parsed.room, currentRole);
          } else if (parsed.type === "presence") {
            setRoom(parsed.room);
            if (currentRole === "host" && parsed.room.guestConnected) {
              setShowQR(false);
            }
          } else if (parsed.type === "lang_update") {
            setRoom(parsed.room);
            void sessionSyncRef.current?.syncWithRoomSnapshot(parsed.room);
          } else if (parsed.type === "transcript") {
            upsertSingleMessage(parsed.item, currentRole);
          } else if (parsed.type === "audio") {
            if (
              parsed.sender !== currentRole &&
              parsed.seq > lastReceivedAudioSeqRef.current
            ) {
              lastReceivedAudioSeqRef.current = parsed.seq;
              const pcm16 = base64ToInt16(parsed.data);
              if (pcm16.length > 0) {
                const targetTurnId = parsed.turnId || latestPartnerMessageIdRef.current;
                if (targetTurnId) {
                  appendTurnAudioChunk(
                    `room:${targetTurnId}`,
                    pcm16,
                    parsed.sampleRate
                  );
                }
                getStereoEngine().enqueuePcm16(pcm16, 0.0, parsed.sampleRate);
              }
            }
          } else if (parsed.type === "interrupted") {
            if (parsed.sender !== currentRole) {
              getStereoEngine().stopAll();
            }
          } else if (parsed.type === "webrtc_signal") {
            if (
              parsed.sender !== currentRole &&
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
          } else if (
            typeof (parsed as { error?: unknown }).error === "string" &&
            (parsed as { error: string }).error
          ) {
            setRoomSyncStatus("error");
            setRoomError((parsed as { error: string }).error);
          }
        } catch {
          // Ignore malformed SSE payload
        }
      };

      es.onerror = () => {
        sseActiveRef.current = false;
        if (!cancelled) {
          setRoomSyncStatus((prev) =>
            prev === "error" ? prev : "reconnecting"
          );
        }
      };

      pollTimer = setInterval(() => {
        const shouldPollWhileConnecting =
          callStateRef.current === "connecting" &&
          Date.now() - lastSseMessageAtRef.current > 1800;
        if (cancelled || (sseActiveRef.current && !shouldPollWhileConnecting)) {
          return;
        }
        const currentRole = roleRef.current || activeRole;
        void fetch(
          `/api/rooms/${roomId}?afterAudioSeq=${lastReceivedAudioSeqRef.current}&afterSignalSeq=${lastReceivedSignalSeqRef.current}`,
          { cache: "no-store", credentials: "same-origin" }
        )
          .then(async (res) => {
            if (cancelled) return;
            if (res.status === 410) {
              setRoomEnded(true);
              void stopAudioSession();
              return;
            }
            if (res.status === 401 || res.status === 403) {
              setScrubbedInviteToken(scrubbedInviteRef.current);
              setNeedsJoinAuth(true);
              return;
            }
            if (!res.ok) return;
            setRoomSyncStatus("connected");
            const data = (await res.json()) as {
              room?: PublicRoomSnapshot;
              audio?: RelayedAudioPacket[];
              signals?: RelayedSignalPacket[];
            };
            if (data.room) {
              setRoom(data.room);
              syncMessagesFromServer(data.room.messages, currentRole);
              if (data.room.ended) {
                setRoomEnded(true);
                void stopAudioSession();
                return;
              }
              void sessionSyncRef.current?.syncWithRoomSnapshot(data.room);
              if (currentRole === "host" && data.room.guestConnected) {
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
                    const targetTurnId = pkt.turnId || latestPartnerMessageIdRef.current;
                    if (targetTurnId) {
                      appendTurnAudioChunk(
                        `room:${targetTurnId}`,
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

    void fetch(`/api/rooms/${roomId}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timeoutId);
        if (cancelled) return;
        const data = (await res.json()) as {
          room?: PublicRoomSnapshot;
          role?: ParticipantRole;
          inviteToken?: string;
          passcode?: string;
          error?: string;
        };
        if (res.status === 410) {
          setRoomEnded(true);
          return;
        }
        if (res.status === 401 || res.status === 403) {
          setScrubbedInviteToken(scrubbedInviteRef.current);
          setNeedsJoinAuth(true);
          setJoinConfirmed(false);
          setRoomSyncStatus("connecting");
          return;
        }
        if (!res.ok || !data.room) {
          setRoomSyncStatus("error");
          setRoomError(data.error || "Room not found.");
          return;
        }

        const serverRole = data.role ?? "guest";
        setVerifiedRole(serverRole);
        roleRef.current = serverRole;
        callManagerRef.current?.setRole(serverRole);
        if (serverRole === "host") {
          setHostInviteToken(data.inviteToken ?? null);
          setHostPasscode(data.passcode ?? null);
          setJoinConfirmed(true);
          if (!data.room.guestConnected) {
            setShowQR(true);
          }
        }
        applyRoomSnapshot(data.room, serverRole);
        startRealtimeStreams(serverRole);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setRoomSyncStatus("error");
        setRoomError("Unable to reach room server.");
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (pollTimer) clearInterval(pollTimer);
      controller.abort();
      es?.close();
    };
  }, [
    roomId,
    retrySeed,
    stopAudioSession,
    getOrCreateCallManager,
    syncMessagesFromServer,
    upsertSingleMessage,
  ]);

  useEffect(() => {
    return () => {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      void stopAudioSession();
    };
  }, [stopAudioSession]);

  const getOrCreateSessionSyncController = useCallback(() => {
    if (sessionSyncRef.current) return sessionSyncRef.current;

    const controller = new RoomLanguageSyncController({
      getRole: () => roleRef.current,
      isSessionActive: () => isRunningRef.current || isStartingRef.current,
      isSpeaking: () => isSpeakingRef.current || pttActiveRef.current,
      createTranslator: (langs, callbackEpoch) => {
        const currentRole = roleRef.current;
        const myLang = langs.myLang;
        const partnerLang = langs.partnerLang;
        let activeHandle: SynchronizedTranslatorHandle | null = null;

        const isCurrent = () =>
          activeHandle !== null &&
          controller.isCurrentCallback(callbackEpoch, activeHandle);

        const translator = new GeminiLiveTranslatorClient({
          langACode: myLang.code,
          langALabel: myLang.label,
          langBCode: partnerLang.code,
          langBLabel: partnerLang.label,
          voiceName: voiceNameRef.current,
          speakerOverride: "A",
          callbacks: {
            onStatusChange: (s, detail) => {
              if (!activeHandle) return;
              controller.handleTranslatorStatus(
                callbackEpoch,
                activeHandle,
                s,
                detail
              );
            },
            onTranscriptUpdate: (turn) => {
              if (!isCurrent()) return;
              const now = Date.now();
              if (!turn.isFinal && now - lastTranscriptSentRef.current < 240) {
                return;
              }
              lastTranscriptSentRef.current = now;

              const item: RoomTranscriptItem = {
                id: `${currentRole}-${turn.id}`,
                sender: currentRole,
                sourceText: turn.sourceText,
                translatedText: turn.translatedText,
                sourceLang: myLang.code,
                targetLang: partnerLang.code,
                isFinal: turn.isFinal,
                timestamp: turn.timestamp,
              };

              upsertSingleMessage(item, currentRole);

              void fetch(`/api/rooms/${roomId}/relay`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                  role: currentRole,
                  kind: "transcript",
                  item,
                }),
              });

              if (turn.isFinal) {
                void flushAudioRelay();
              }
            },
            onAudioOutput: (pcm16, sampleRate, _channel, turnId) => {
              if (!isCurrent()) return;
              const roomTurnId = turnId ? `${currentRole}-${turnId}` : undefined;
              if (roomTurnId) {
                appendTurnAudioChunk(`room:${roomTurnId}`, pcm16, sampleRate);
              }
              queueAudioForPartner(pcm16, sampleRate, roomTurnId);
            },
            onInterrupted: () => {
              if (!isCurrent()) return;
              audioBatchRef.current = [];
              audioBatchSamplesRef.current = 0;
              void fetch(`/api/rooms/${roomId}/relay`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                  role: currentRole,
                  kind: "interrupted",
                }),
              });
            },
            onError: (msg) => {
              if (!isCurrent()) return;
              setStatusError(msg);
            },
          },
        });

        activeHandle = translator as unknown as SynchronizedTranslatorHandle;
        return translator;
      },
      onBeforeReplace: ({ previousClient, hadActiveSpeech }) => {
        if (hadActiveSpeech) {
          previousClient?.sendAudioStreamEnd();
          pttActiveRef.current = false;
          setPttActive(false);
          setIsSpeaking(false);
          isSpeakingRef.current = false;
        }
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        audioBatchRef.current = [];
        audioBatchSamplesRef.current = 0;
        getStereoEngine().stopAll();
      },
      onActiveClientChanged: (client) => {
        clientRef.current = client as GeminiLiveTranslatorClient | null;
      },
      onStatusChange: (status, detail) => {
        setLiveStatus(status);
        if (status === "reconnecting" || status === "connected") {
          setStatusError(null);
        } else if (status === "error") {
          if (detail) {
            setStatusError(detail);
          }
          if (isRunningRef.current || isStartingRef.current) {
            void stopAudioSession(true);
          }
        }
      },
      onFatalError: async (msg) => {
        setLiveStatus("error");
        setStatusError(msg);
        await stopAudioSession(true);
      },
    });

    sessionSyncRef.current = controller;
    return controller;
  }, [
    flushAudioRelay,
    queueAudioForPartner,
    roomId,
    stopAudioSession,
    upsertSingleMessage,
  ]);

  const startAudioSession = useCallback(
    async (unlockedCtx: AudioContext, currentRoom: PublicRoomSnapshot) => {
      if (isStartingRef.current || isRunningRef.current) return;
      isStartingRef.current = true;
      setStatusError(null);
      setLiveStatus("connecting");

      try {
        if (unlockedCtx.state === "suspended") {
          await unlockedCtx.resume();
        }
        syncAudioDiagnostics();

        const syncController = getOrCreateSessionSyncController();
        const { client, epoch: initialEpoch } =
          await syncController.beginFreshSession(currentRoom);

        const handleUnexpectedMicLoss = () => {
          setStatusError(
            "Microphone disconnected or preempted by another app. Check audio device and tap Start to resume."
          );
          void stopAudioSession(true);
        };

        const vad = new VadManager({
          onTrackEnded: handleUnexpectedMicLoss,
          onMicAcquired: (info) => {
            setSelectedMicId(info.deviceId);
            setActiveMicLabel(info.label);
            setIsBluetoothMicRisk(info.isBluetoothRisk);
            void callManagerRef.current?.replaceLocalStream(info.stream);
          },
          onInputLevel: (level) => setInputLevel(level),
          onSpeechStart: () => {
            if (captureModeRef.current === "vad") {
              isSpeakingRef.current = true;
              setIsSpeaking(true);
            }
          },
          onSpeechEnd: () => {
            if (captureModeRef.current === "vad") {
              isSpeakingRef.current = false;
              setIsSpeaking(false);
              clientRef.current?.sendAudioStreamEnd();
            }
          },
          onVADMisfire: () => {
            if (captureModeRef.current === "vad") {
              isSpeakingRef.current = false;
              setIsSpeaking(false);
            }
          },
          onAudioFrame: (pcm16) => {
            if (
              captureModeRef.current === "vad" &&
              syncController.isReadyForAudio()
            ) {
              clientRef.current?.sendPcm16Frame(pcm16);
            }
          },
          onRawFrame: (pcm16) => {
            if (
              captureModeRef.current === "ptt" &&
              pttActiveRef.current &&
              syncController.isReadyForAudio()
            ) {
              clientRef.current?.sendPcm16Frame(pcm16);
            }
          },
          onError: (msg) => setStatusError(msg),
        });

        vadRef.current = vad;

        // Parallelize Gemini session handshake with mic acquisition + Silero WASM initialization
        const initialConnectPromise = client.connect().catch((err) => {
          // If a language update superseded this initial handshake mid-flight, ignore stale rejection
          if (syncController.getEpoch() !== initialEpoch) {
            return;
          }
          throw err;
        });

        const [, micInfo] = await Promise.all([
          initialConnectPromise,
          (async () => {
            const info = await getMicManager().acquireMic(
              selectedMicId || undefined,
              { voiceCallAec: true, onTrackEnded: handleUnexpectedMicLoss }
            );
            setSelectedMicId(info.deviceId);
            setActiveMicLabel(info.label);
            setIsBluetoothMicRisk(info.isBluetoothRisk);
            getStereoEngine().unlockSync();
            syncAudioDiagnostics();
            void listMicDevices().then((res) => setMicDevices(res.devices));
            await vad.start({
              stream: info.stream,
              preferredDeviceId: info.deviceId || undefined,
              audioContext: unlockedCtx,
              sensitivity: settings.vadSensitivity,
              voiceCallAec: true,
            });
            return info;
          })(),
        ]);

        // Abort cleanly if user stopped/errored while startup was in flight
        if (!isStartingRef.current || !syncController.getActiveClient()) {
          await vad.destroy();
          if (vadRef.current === vad) {
            vadRef.current = null;
          }
          return;
        }

        // Sync once more in case a room update arrived just as startup finished
        const latestSyncedRoom = syncController.getLatestRoom();
        if (latestSyncedRoom) {
          const latestPair = resolveAuthoritativeRoomLanguages(
            roleRef.current,
            latestSyncedRoom
          );
          if (latestPair.pairKey !== syncController.getActivePairKey()) {
            void syncController.syncWithRoomSnapshot(latestSyncedRoom);
          }
        }

        getStereoEngine().unlockSync();
        syncAudioDiagnostics();
        isRunningRef.current = true;
        setIsRunning(true);
        setIsMuted(false);

        if (voiceCallDesiredRef.current) {
          const callMgr = getOrCreateCallManager();
          try {
            await callMgr.startCall(
              micInfo.stream,
              false,
              localVideoStreamRef.current?.getVideoTracks()[0] ?? null
            );
          } catch {
            // Live Gemini translation remains active independently even if WebRTC handshake lags
          }
          getStereoEngine().unlockSync();
          syncAudioDiagnostics();
        }
      } catch (err) {
        setLiveStatus("error");
        setStatusError(
          err instanceof Error ? err.message : "Failed to start room audio."
        );
        await stopAudioSession(true);
      } finally {
        isStartingRef.current = false;
      }
    },
    [
      getOrCreateCallManager,
      getOrCreateSessionSyncController,
      selectedMicId,
      settings.vadSensitivity,
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
    if (isStartingRef.current) return;
    voiceCallDesiredRef.current = withVoiceCall;
    const ctx = getStereoEngine().unlockSync();
    syncAudioDiagnostics();
    void startAudioSession(ctx, room);
  };

  const handleToggleStart = () => {
    handleStartLive(true);
  };

  const getSharedLiveMicStream = async (): Promise<MediaStream> => {
    const activeStream = getMicManager().getActiveMic()?.stream;
    if (
      activeStream &&
      activeStream.getAudioTracks().some((t) => t.readyState === "live")
    ) {
      return activeStream;
    }
    const micInfo = await getMicManager().acquireMic(
      selectedMicId || undefined,
      { voiceCallAec: true }
    );
    setSelectedMicId(micInfo.deviceId);
    setActiveMicLabel(micInfo.label);
    setIsBluetoothMicRisk(micInfo.isBluetoothRisk);
    return micInfo.stream;
  };

  const handleToggleVoiceCall = async () => {
    if (!isRunning) return;
    triggerHaptic(settings.hapticsEnabled, 10);
    getStereoEngine().unlockSync();
    syncAudioDiagnostics();
    const callMgr = getOrCreateCallManager();
    if (callState !== "idle" && callState !== "disconnected") {
      callMgr.hangup(true);
      stopLocalVideoStream();
      getStereoEngine().detachRemoteVoiceStream();
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
      }
      setCallElapsedSec(0);
      setIsVoiceDucked(false);
      setRemoteVoiceLevel(0);
      setIceState("new");
      return;
    }
    const videoTrack = localVideoStreamRef.current?.getVideoTracks()[0] ?? null;
    const micStream = await getSharedLiveMicStream();
    await callMgr.startCall(micStream, isMuted, videoTrack);
    getStereoEngine().unlockSync();
  };

  const acquireCameraTrack = async (
    facing: "user" | "environment"
  ): Promise<MediaStreamTrack> => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      throw new Error("Camera access requires HTTPS and a supported browser.");
    }
    if (localVideoStreamRef.current) {
      for (const t of localVideoStreamRef.current.getTracks()) {
        try {
          t.stop();
        } catch {
          // Ignore
        }
      }
      localVideoStreamRef.current = null;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      throw new Error("No camera video track available.");
    }
    localVideoStreamRef.current = stream;
    if (localVideoElRef.current) {
      localVideoElRef.current.srcObject = stream;
      void localVideoElRef.current.play().catch(() => {});
    }
    return track;
  };

  const handleToggleVideo = async () => {
    triggerHaptic(settings.hapticsEnabled, 10);
    // Unlock AudioContext synchronously before awaiting camera permission so iOS/Android keep the gesture token
    const ctx = getStereoEngine().unlockSync();
    syncAudioDiagnostics();
    if (videoEnabled) {
      stopLocalVideoStream();
      await callManagerRef.current?.setLocalVideoTrack(null);
      return;
    }
    try {
      const track = await acquireCameraTrack(cameraFacing);
      videoDesiredRef.current = true;
      setVideoEnabled(true);

      if (!isRunning) {
        if (!room || isStartingRef.current) return;
        voiceCallDesiredRef.current = true;
        void startAudioSession(ctx, room);
        return;
      }

      const callMgr = getOrCreateCallManager();
      if (callState === "idle" || callState === "disconnected") {
        const micStream = await getSharedLiveMicStream();
        await callMgr.startCall(micStream, isMuted, track);
        getStereoEngine().unlockSync();
      } else {
        await callMgr.setLocalVideoTrack(track);
      }
    } catch (err) {
      stopLocalVideoStream();
      setStatusError(
        err instanceof Error
          ? err.message
          : isArabicUi
            ? "تعذر تشغيل الكاميرا."
            : "Could not access camera."
      );
    }
  };

  const handleFlipCamera = async () => {
    if (!videoEnabled) return;
    triggerHaptic(settings.hapticsEnabled, 10);
    getStereoEngine().unlockSync();
    const nextFacing: "user" | "environment" =
      cameraFacing === "user" ? "environment" : "user";
    try {
      const track = await acquireCameraTrack(nextFacing);
      setCameraFacing(nextFacing);
      await callManagerRef.current?.setLocalVideoTrack(track);
    } catch (err) {
      setStatusError(
        err instanceof Error
          ? err.message
          : isArabicUi
            ? "تعذر تبديل الكاميرا."
            : "Could not switch camera."
      );
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
          voiceCallAec: true,
        });
      }
      engine.unlockSync();
    } else {
      if (isSpeaking) {
        clientRef.current?.sendAudioStreamEnd();
      }
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
    if (captureMode !== mode && isSpeaking) {
      pttActiveRef.current = false;
      setPttActive(false);
      setIsSpeaking(false);
      clientRef.current?.sendAudioStreamEnd();
    }
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
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as { room: PublicRoomSnapshot };
      setRoom(data.room);
      getOrCreateSessionSyncController();
      await sessionSyncRef.current?.syncWithRoomSnapshot(data.room);
    }
  };

  const handleSelectMic = async (deviceId: string) => {
    const engine = getStereoEngine();
    const ctx = engine.unlockSync();
    syncAudioDiagnostics();
    setSelectedMicId(deviceId);
    if (vadRef.current && isRunning && !isMuted) {
      await vadRef.current.pause();
      const micInfo = await getMicManager().acquireMic(
        deviceId || undefined,
        {
          voiceCallAec: true,
          onTrackEnded: () => {
            setStatusError("Microphone disconnected. Tap Start to reconnect.");
            void stopAudioSession(true);
          },
        }
      );
      setActiveMicLabel(micInfo.label);
      setIsBluetoothMicRisk(micInfo.isBluetoothRisk);
      await callManagerRef.current?.replaceLocalStream(micInfo.stream);
      vadRef.current.setPreferredDeviceId(micInfo.deviceId || undefined);
      await vadRef.current.start({
        stream: micInfo.stream,
        preferredDeviceId: micInfo.deviceId || undefined,
        audioContext: ctx,
        sensitivity: settings.vadSensitivity,
        voiceCallAec: true,
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
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedToast(false), 1800);
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
      await fetch(`/api/rooms/${roomId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
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

  const handleSendTextChat = async (
    myLangCode: string,
    partnerLangCode: string
  ) => {
    const cleanText = textChatInput.trim();
    if (!cleanText || sendingTextChat) return;

    triggerHaptic(settings.hapticsEnabled, 8);
    setSendingTextChat(true);
    setStatusError(null);

    try {
      const res = await fetch("/api/translate-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          text: cleanText,
          sourceLang: myLangCode,
          targetLang: partnerLangCode,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        translatedText?: string;
        error?: string;
      };
      if (!res.ok || !json.translatedText) {
        throw new Error(
          json.error ||
            (isArabicUi
              ? "تعذر ترجمة الرسالة النصية."
              : "Could not translate message.")
        );
      }

      const item = createRoomTextItem({
        sender: role,
        sourceText: cleanText,
        translatedText: json.translatedText,
        sourceLang: myLangCode,
        targetLang: partnerLangCode,
      });

      if (settings.saveTranscripts) {
        upsertPersistedRoomMessage(roomId, item);
      } else {
        setEphemeralMessages((prev) => [...prev, item]);
      }

      const relayRes = await fetch(`/api/rooms/${roomId}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          role,
          kind: "transcript",
          item,
        }),
      });
      if (!relayRes.ok) {
        throw new Error(
          isArabicUi
            ? "تعذر إرسال النص إلى الشريك."
            : "Could not deliver message to partner."
        );
      }

      setTextChatInput("");
    } catch (err) {
      setStatusError(
        err instanceof Error
          ? err.message
          : isArabicUi
            ? "تعذر إرسال الرسالة."
            : "Failed to send message."
      );
    } finally {
      setSendingTextChat(false);
    }
  };

  useEffect(() => {
    if (!confirmEndOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !endingRoom) setConfirmEndOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmEndOpen, endingRoom]);

  const getLangName = (code: string, fallback: string) => {
    if (code === "ar") return "العربية";
    return isArabicUi ? (LANGUAGE_ARABIC_NAMES[code] ?? fallback) : fallback;
  };

  const handleDirectGuestJoin = async () => {
    if (joiningRoom) return;
    if (!scrubbedInviteToken && joinPasscodeInput.trim().length < 4) {
      setJoinAuthError(
        isArabicUi
          ? "أدخل رمز الدخول المكون من 6 أحرف للمتابعة."
          : "Enter the 6-character room passcode to continue."
      );
      return;
    }

    triggerHaptic(settings.hapticsEnabled, 12);
    getStereoEngine().unlockSync();
    syncAudioDiagnostics();
    setJoiningRoom(true);
    setJoinAuthError(null);

    try {
      const res = await fetch(`/api/rooms/${roomId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          ...(scrubbedInviteToken ? { inviteToken: scrubbedInviteToken } : {}),
          ...(joinPasscodeInput.trim()
            ? { passcode: joinPasscodeInput.trim() }
            : {}),
        }),
      });
      const data = (await res.json()) as {
        room?: PublicRoomSnapshot;
        role?: ParticipantRole;
        error?: string;
      };
      if (!res.ok || !data.room) {
        setJoinAuthError(
          data.error ||
            (isArabicUi
              ? "تعذر التحقق من صلاحية الانضمام للغرفة."
              : "Could not verify room invite or passcode.")
        );
        setJoiningRoom(false);
        return;
      }

      if (
        joinLangChoice &&
        joinLangChoice !== data.room.guestLangCode &&
        (data.role ?? "guest") === "guest"
      ) {
        await fetch(`/api/rooms/${roomId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ guestLang: joinLangChoice }),
        }).catch(() => {});
      }

      const joinedRole = data.role ?? "guest";
      setVerifiedRole(joinedRole);
      roleRef.current = joinedRole;
      callManagerRef.current?.setRole(joinedRole);
      setRoom(data.room);
      setNeedsJoinAuth(false);
      setJoinConfirmed(true);
      setJoiningRoom(false);
      setRetrySeed((s) => s + 1);
    } catch {
      setJoinAuthError(
        isArabicUi
          ? "تعذر الاتصال بالخادم للانضمام للغرفة."
          : "Unable to reach server to join room."
      );
      setJoiningRoom(false);
    }
  };

  if (needsJoinAuth && !roomEnded) {
    return (
      <main
        dir={isArabicUi ? "rtl" : "ltr"}
        className="flex min-h-dvh w-full items-end sm:items-center justify-center bg-[#F5F3ED] p-0 sm:p-4 text-[#242A26]"
      >
        <div
          className="w-full max-w-md rounded-t-[28px] sm:rounded-[28px] border border-[#E6E5DE] bg-white text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.25)] p-5 space-y-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="guest-auth-join-title"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1
                id="guest-auth-join-title"
                className="text-base font-bold text-[#242A26]"
              >
                {isArabicUi ? "الانضمام إلى غرفة الترجمة" : "Join Translation Room"}
              </h1>
              <p className="text-xs text-[#777F79]">
                {scrubbedInviteToken
                  ? isArabicUi
                    ? "تم التحقق من رابط الدعوة الخاص — اضغط دخول الغرفة للبدء"
                    : "Private QR invite detected — choose your language and join"
                  : isArabicUi
                    ? "أدخل رمز الدخول الخاص بالغرفة (PIN) للمتابعة"
                    : "Enter the room passcode shown on your partner's screen"}
              </p>
            </div>
            <span
              dir="ltr"
              className="shrink-0 rounded-full bg-[#DCE8DD] px-2.5 py-1 font-mono text-[11px] font-bold text-[#214536]"
            >
              {roomId}
            </span>
          </div>

          <div className="rounded-2xl border border-[#E6E5DE] bg-[#F5F3ED] p-4 space-y-3">
            {!scrubbedInviteToken && (
              <div className="space-y-1.5">
                <label
                  htmlFor="direct-join-passcode"
                  className="block text-xs font-semibold text-[#315F4A]"
                >
                  {isArabicUi ? "رمز الدخول (6 أحرف)" : "Room Passcode (PIN)"}
                </label>
                <input
                  id="direct-join-passcode"
                  type="text"
                  dir="ltr"
                  value={joinPasscodeInput}
                  onChange={(e) => {
                    setJoinAuthError(null);
                    setJoinPasscodeInput(
                      e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
                    );
                  }}
                  placeholder="XXXXXX"
                  maxLength={10}
                  className="min-h-[44px] w-full rounded-xl border border-[#E6E5DE] bg-white px-3.5 py-2 font-mono text-sm font-bold uppercase tracking-[0.18em] text-[#242A26] outline-none focus:border-[#315F4A]"
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="direct-join-lang"
                className="text-xs font-semibold text-[#315F4A]"
              >
                {isArabicUi ? "لغتك المحكية" : "Your Spoken Language"}
              </label>
              <select
                id="direct-join-lang"
                value={joinLangChoice}
                onChange={(e) => setJoinLangChoice(e.target.value)}
                className="min-h-[44px] rounded-xl border border-[#E6E5DE] bg-white px-3 py-1.5 text-xs font-semibold text-[#242A26] outline-none focus:border-[#315F4A]"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label} ({l.native})
                  </option>
                ))}
              </select>
            </div>

            {joinAuthError && (
              <p
                role="alert"
                className="rounded-xl border border-[#C76A67]/30 bg-[#C76A67]/10 px-3 py-2 text-xs font-medium text-[#9e3f3c]"
              >
                {joinAuthError}
              </p>
            )}
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
              disabled={joiningRoom}
              onClick={() => void handleDirectGuestJoin()}
              className="min-h-[46px] rounded-full bg-[#315F4A] px-4 text-xs font-semibold text-white transition hover:bg-[#214536] active:scale-[0.98] disabled:opacity-60"
            >
              {joiningRoom
                ? isArabicUi
                  ? "جاري الدخول..."
                  : "Joining..."
                : isArabicUi
                  ? "دخول الغرفة"
                  : "Confirm & Join"}
            </button>
          </div>
        </div>
      </main>
    );
  }

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

  const isTranslatingTurn = messages.some(
    (m) => m.sender === role && !m.isFinal
  );

  const nonEmptyMessages = messages.filter(
    (m) => m.sourceText.trim().length > 0 || m.translatedText.trim().length > 0
  );
  const hiddenMessageCount = Math.max(
    0,
    nonEmptyMessages.length - visibleMessageLimit
  );
  const visibleMessages =
    hiddenMessageCount > 0
      ? nonEmptyMessages.slice(-visibleMessageLimit)
      : nonEmptyMessages;

  const handleTranscriptScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 80;
    isNearBottomRef.current = near;
    setShowJumpToLatest(!near);
  };

  const handleJumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = true;
    el.scrollTop = el.scrollHeight;
    setShowJumpToLatest(false);
  };

  const latestSubtitle =
    visibleMessages.length > 0
      ? visibleMessages[visibleMessages.length - 1]
      : null;

  return (
    <div
      dir={isArabicUi ? "rtl" : "ltr"}
      className="mx-auto flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-[#F5F3ED] text-[#242A26] sm:border-x sm:border-[#E2DFD6]"
    >
      {/* Top NOVA Room Header */}
      <header className="border-b border-[#E2DFD6] bg-white px-3.5 py-2.5 space-y-2 nova-soft-shadow">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Link
              href="/mode-b"
              aria-label={isArabicUi ? "العودة لقائمة الغرف" : "Back to rooms"}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-3 text-xs font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]/60"
            >
              <ArrowLeftIcon
                className={`w-3.5 h-3.5 ${isArabicUi ? "rotate-180" : ""}`}
              />
              <span className="hidden min-[360px]:inline">
                {isArabicUi ? "الغرف" : "Rooms"}
              </span>
            </Link>

            <span
              dir="ltr"
              className="inline-flex min-h-[36px] max-w-[132px] truncate items-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 font-mono text-[11px] font-bold text-[#214536]"
            >
              {room.id}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0">
            {/* Presence + Sync Status Pill */}
            <span
              role="status"
              aria-live="polite"
              className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold ${
                roomSyncStatus === "reconnecting"
                  ? "border-[#A87131]/40 bg-[#E8D8BF] text-[#242A26]"
                  : partnerConnected
                    ? "border-[#A8BDA9] bg-[#DCE8DD] text-[#214536]"
                    : "border-[#C58B62]/45 bg-[#E8D8BF]/75 text-[#242A26]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  roomSyncStatus === "reconnecting"
                    ? "bg-[#A87131] animate-ping"
                    : partnerConnected
                      ? "bg-[#3E6E53]"
                      : "bg-[#A86D43] animate-ping"
                }`}
              />
              <span>
                {roomSyncStatus === "reconnecting"
                  ? isArabicUi
                    ? "إعادة المزامنة..."
                    : "Reconnecting..."
                  : partnerConnected
                    ? isArabicUi
                      ? "الشريك متصل"
                      : "Partner joined"
                    : isArabicUi
                      ? "بانتظار الشريك"
                      : "Waiting for partner"}
              </span>
            </span>

            {messages.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setSummaryOpen(true)}
                  aria-label={isArabicUi ? "تلخيص المحادثة" : "Summarize conversation"}
                  className="inline-flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-1 rounded-full border border-[#A8BDA9] bg-[#DCE8DD]/70 px-2.5 text-xs font-semibold text-[#214536] hover:bg-[#DCE8DD]"
                >
                  <SparklesIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {isArabicUi ? "ملخص" : "Summarize"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyTranscript()}
                  aria-label={isArabicUi ? "نسخ المحادثة" : "Copy transcript"}
                  className="inline-flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-1 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 text-xs font-semibold text-[#315F4A] hover:bg-[#DCE8DD]"
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
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#565E58] hover:bg-[#C76A67]/15 hover:text-[#9B3B38]"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </>
            )}

            {role === "host" && (
              <>
                <button
                  type="button"
                  onClick={() => setShowQR((v) => !v)}
                  aria-label={showQR ? "Hide QR invite" : "Show QR invite"}
                  className={`inline-flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-1 rounded-full border px-3 text-xs font-semibold transition ${
                    showQR
                      ? "border-[#315F4A] bg-[#DCE8DD] text-[#214536]"
                      : "border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]/60"
                  }`}
                >
                  <QrCodeIcon className="w-4 h-4" />
                  <span>{isArabicUi ? "QR" : showQR ? "Hide" : "Invite"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmEndOpen(true)}
                  aria-label={isArabicUi ? "إنهاء الغرفة للجميع" : "End room for everyone"}
                  className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-[#B54F4C]/40 bg-[#C76A67]/12 px-3 text-xs font-semibold text-[#9B3B38] transition hover:bg-[#C76A67]/20"
                >
                  {isArabicUi ? "إنهاء" : "End"}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={isArabicUi ? "الإعدادات" : "Open settings"}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition ${
                isBluetoothMicRisk
                  ? "border-[#A87131] bg-[#E8D8BF] text-[#242A26]"
                  : "border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]"
              }`}
            >
              <SettingsGearIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Language Strip */}
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#E2DFD6] bg-[#F5F3ED] px-3 py-1 text-xs">
          <div className="relative flex min-h-[44px] items-center gap-1.5 min-w-0">
            <LanguageFlag code={myLang.code} size={18} />
            <span className="text-[#565E58] font-medium">
              {isArabicUi ? "أنت:" : "You:"}
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-[#315F4A] truncate">
              {getLangName(myLang.code, myLang.label)}
              <ChevronDownIcon className="w-3 h-3 shrink-0" />
            </span>
            <select
              aria-label={isArabicUi ? "لغتك المحكية" : "Your spoken language"}
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

          <span className="text-[#565E58] font-semibold" aria-hidden="true">↔</span>

          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[#565E58] font-medium">
              {isArabicUi ? "الشريك:" : "Partner:"}
            </span>
            <LanguageFlag code={partnerLang.code} size={18} />
            <span className="font-semibold text-[#A86D43] truncate">
              {getLangName(partnerLang.code, partnerLang.label)}
            </span>
          </div>
        </div>
      </header>

      {/* Mode B WebRTC Video Feed + Live Bilingual Subtitles Overlay */}
      {(videoEnabled || remoteVideoActive || remoteVideoStream !== null) && (
        <section
          aria-label={isArabicUi ? "مكالمة الفيديو والترجمة الفورية" : "Video call and live subtitles"}
          className="relative mx-3.5 mt-2.5 h-56 sm:h-72 shrink-0 overflow-hidden rounded-[22px] border border-[#315F4A]/35 bg-[#14261E] text-white shadow-[0_12px_28px_-8px_rgba(20,38,30,0.45)]"
        >
          {/* Remote full-width video (muted because StereoEngine handles Smart Audio Ducking) */}
          <video
            ref={remoteVideoElRef}
            playsInline
            autoPlay
            muted
            onLoadedMetadata={() => void remoteVideoElRef.current?.play().catch(() => {})}
            className={`h-full w-full object-cover transition-opacity ${
              remoteVideoActive || remoteVideoStream !== null ? "opacity-100" : "opacity-0"
            }`}
          />

          {!remoteVideoActive && remoteVideoStream === null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center">
              <VideoOffCamIcon className="w-7 h-7 text-[#A8BDA9]" />
              <p className="text-xs font-semibold text-[#DCE8DD]">
                {isArabicUi
                  ? "كاميرا الشريك مغلقة حالياً"
                  : "Partner camera is currently off"}
              </p>
            </div>
          )}

          {/* Top-start Video Controls: Live Subtitles CC + Camera Flip */}
          <div className="absolute top-2.5 start-2.5 z-10 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowVideoSubtitles((s) => !s)}
              aria-label={
                isArabicUi ? "إظهار أو إخفاء الترجمة على الفيديو" : "Toggle live video subtitles"
              }
              className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full px-3 text-xs font-bold backdrop-blur-xs transition ${
                showVideoSubtitles
                  ? "bg-[#315F4A]/90 text-white"
                  : "bg-[#242A26]/70 text-[#DCE8DD]"
              }`}
            >
              CC
            </button>

            {videoEnabled && (
              <button
                type="button"
                onClick={() => void handleFlipCamera()}
                aria-label={
                  isArabicUi ? "تبديل الكاميرا الأمامية والخلفية" : "Flip front or rear camera"
                }
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#242A26]/75 text-white backdrop-blur-xs transition hover:bg-[#315F4A]"
              >
                <CameraFlipIcon className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Local PiP Camera Preview (muted) */}
          {videoEnabled && (
            <div className="absolute top-2.5 end-2.5 z-10 h-24 w-[68px] sm:h-28 sm:w-20 overflow-hidden rounded-xl border-2 border-white/80 bg-[#242A26] shadow-lg">
              <video
                ref={localVideoElRef}
                playsInline
                autoPlay
                muted
                className={`h-full w-full object-cover ${
                  cameraFacing === "user" ? "-scale-x-100" : ""
                }`}
              />
            </div>
          )}

          {/* Live Bilingual Subtitles Overlay */}
          {showVideoSubtitles && latestSubtitle && (
            <div className="pointer-events-none absolute inset-x-2.5 bottom-2.5 z-10 rounded-2xl border border-white/15 bg-[#14261E]/85 px-3.5 py-2 backdrop-blur-xs space-y-0.5">
              <p
                dir={myLang.rtl ? "rtl" : "ltr"}
                className="text-xs sm:text-sm font-bold leading-snug text-white line-clamp-2"
              >
                {latestSubtitle.sender === role
                  ? latestSubtitle.sourceText || latestSubtitle.translatedText
                  : latestSubtitle.translatedText || latestSubtitle.sourceText}
              </p>
              {(latestSubtitle.sender === role
                ? latestSubtitle.translatedText
                : latestSubtitle.sourceText) && (
                <p
                  dir={partnerLang.rtl ? "rtl" : "ltr"}
                  className="text-[11px] font-medium text-[#DCE8DD] line-clamp-1"
                >
                  {latestSubtitle.sender === role
                    ? latestSubtitle.translatedText
                    : latestSubtitle.sourceText}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Scrollable Live Chat Transcript (+ QR Invite inside scroll stage so small phones never crush content) */}
      <div
        ref={scrollRef}
        onScroll={handleTranscriptScroll}
        className="relative flex flex-1 flex-col overflow-y-auto px-3.5 sm:px-4 py-3.5 space-y-3 overscroll-contain"
      >
        {showQR && role === "host" && (
          <div className="shrink-0">
            <RoomQRCode
              roomId={room.id}
              inviteToken={hostInviteToken}
              passcode={hostPasscode}
              compact
            />
          </div>
        )}

        {visibleMessages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center px-2 py-2">
            <div className="max-w-sm rounded-[24px] border border-[#E2DFD6] bg-white p-4 sm:p-5 space-y-2 nova-card-shadow">
              <p className="text-sm font-semibold text-[#242A26]">
                {partnerConnected
                  ? isArabicUi
                    ? "انضم شريكك! اضغط «بدء المكالمة» بالأسفل وتحدّث بطبيعتك."
                    : "Your partner is ready! Tap Start Live Call below and speak."
                  : isArabicUi
                    ? "شارك رمز QR أعلاه مع شريكك، أو اضغط «بدء المكالمة» للاستعداد."
                    : "Ask your partner to scan the QR invite above, then tap Start Live Call."}
              </p>
              <p className="text-xs leading-relaxed text-[#565E58]">
                {isArabicUi
                  ? `تتحدث بـ ${getLangName(myLang.code, myLang.label)} وتسمع ترجمة شريكك إلى ${getLangName(myLang.code, myLang.label)}.`
                  : `You speak ${myLang.label} and hear your partner translated into ${myLang.label}.`}
              </p>
            </div>
          </div>
        ) : (
          <>
            {hiddenMessageCount > 0 && (
              <div className="flex justify-center pb-1">
                <button
                  type="button"
                  onClick={() => setVisibleMessageLimit((n) => n + 60)}
                  className="min-h-[44px] rounded-full border border-[#E2DFD6] bg-white px-4 text-xs font-semibold text-[#315F4A] nova-soft-shadow transition hover:bg-[#DCE8DD]/55"
                >
                  {isArabicUi
                    ? `عرض الرسائل الأقدم (+${hiddenMessageCount})`
                    : `Show earlier messages (+${hiddenMessageCount})`}
                </button>
              </div>
            )}
            {visibleMessages.map((item) => {
              const isMine = item.sender === role;
              const mainText = isMine
                ? item.sourceText || item.translatedText
                : item.translatedText || item.sourceText;
              const subText = isMine
                ? item.sourceText
                  ? item.translatedText
                  : ""
                : item.translatedText
                  ? item.sourceText
                  : "";
              const mainDir = myLang.rtl ? "rtl" : "ltr";
              const subDir = partnerLang.rtl ? "rtl" : "ltr";
              const isReplaying = replayingMessageId === item.id;

              return (
                <div
                  key={item.id}
                  className={`max-w-[90%] rounded-2xl px-4 py-3 nova-soft-shadow ${
                    !item.isFinal ? "border border-dashed" : "border"
                  } ${
                    isMine
                      ? "self-end border-[#A8BDA9] bg-[#DCE8DD]/65"
                      : "self-start border-[#E2DFD6] bg-white"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        isMine ? "text-[#214536]" : "text-[#A86D43]"
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
                        <span className="rounded-full bg-[#DCE8DD] px-2 py-0.5 text-[10px] font-semibold text-[#214536] animate-pulse">
                          {isArabicUi ? "يُترجم الآن..." : "translating..."}
                        </span>
                      )}
                      {item.isFinal && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic(settings.hapticsEnabled, 8);
                              toggleSavedPhrase({
                                sourceText: item.sourceText,
                                translatedText: item.translatedText,
                                sourceLang: item.sourceLang,
                                targetLang: item.targetLang,
                                modeLabel: isArabicUi ? "الوضع B" : "Mode B",
                              });
                            }}
                            aria-label={isArabicUi ? "حفظ العبارة" : "Save phrase"}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition active:scale-95 ${
                              savedKeys.has(
                                buildSavedPhraseKey(
                                  item.sourceText,
                                  item.translatedText
                                )
                              )
                                ? "border-[#C58B62] bg-[#E8D8BF] text-[#A86D43]"
                                : "border-[#E2DFD6] bg-[#F5F3ED] text-[#565E58] hover:text-[#A86D43]"
                            }`}
                          >
                            <StarIcon
                              className="w-3.5 h-3.5"
                              filled={savedKeys.has(
                                buildSavedPhraseKey(
                                  item.sourceText,
                                  item.translatedText
                                )
                              )}
                            />
                          </button>
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
                              isArabicUi
                                ? "إعادة تشغيل الصوت"
                                : "Replay translation audio"
                            }
                            className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold transition active:scale-95 ${
                              isReplaying
                                ? "border-[#315F4A] bg-[#315F4A] text-white"
                                : "border-[#E2DFD6] bg-[#F5F3ED] text-[#315F4A] hover:bg-[#DCE8DD]"
                            }`}
                          >
                            <SpeakerPlayIcon className="w-3.5 h-3.5" />
                            <span>{isArabicUi ? "إعادة" : "Play"}</span>
                          </button>
                        </>
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
                    <p dir={subDir} className="mt-1 text-xs text-[#565E58]">
                      {subText}
                    </p>
                  )}
                </div>
              );
            })}
          </>
        )}

        {showJumpToLatest && visibleMessages.length > 0 && (
          <div className="sticky bottom-1 flex justify-center pointer-events-none">
            <button
              type="button"
              onClick={handleJumpToLatest}
              className="pointer-events-auto min-h-[36px] rounded-full bg-[#214536] px-3.5 text-[11px] font-semibold text-white shadow-md transition hover:bg-[#315F4A]"
            >
              {isArabicUi ? "الأحدث ↓" : "Latest ↓"}
            </button>
          </div>
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

      {/* Compact Translated Text Chat Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSendTextChat(myLang.code, partnerLang.code);
        }}
        className="flex items-center gap-2 border-t border-[#E2DFD6] bg-[#F5F3ED]/90 px-3.5 py-2"
      >
        <input
          type="text"
          value={textChatInput}
          onChange={(e) => setTextChatInput(e.target.value)}
          disabled={sendingTextChat}
          maxLength={2000}
          placeholder={
            isArabicUi
              ? `اكتب رسالة أو عنواناً بـ ${getLangName(myLang.code, myLang.label)}...`
              : `Type an address, number, or message in ${myLang.label}...`
          }
          aria-label={isArabicUi ? "إرسال رسالة نصية مترجمة" : "Send translated text message"}
          className="min-h-[44px] flex-1 rounded-full border border-[#E2DFD6] bg-white px-4 text-xs sm:text-sm text-[#242A26] placeholder:text-[#777F79] outline-none focus:border-[#315F4A]"
        />
        <button
          type="submit"
          disabled={sendingTextChat || !textChatInput.trim()}
          aria-label={isArabicUi ? "ترجمة وإرسال" : "Translate and send"}
          className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-full bg-[#315F4A] px-3.5 text-xs font-semibold text-white transition hover:bg-[#214536] active:scale-95 disabled:opacity-45"
        >
          <SendArrowIcon className="w-4 h-4" />
          <span className="hidden sm:inline">
            {sendingTextChat
              ? isArabicUi
                ? "يرسل..."
                : "Sending"
              : isArabicUi
                ? "إرسال"
                : "Send"}
          </span>
        </button>
      </form>

      {/* Live Voice Call & Translation Control Bar */}
      <footer className="border-t border-[#E2DFD6] bg-white px-3.5 py-2.5 space-y-2 shadow-[0_-4px_20px_-8px_rgba(33,69,54,0.1)]">
        <RecoveryBanner
          isOnline={isOnline}
          errorMessage={statusError}
          onRetry={!isRunning ? handleToggleStart : undefined}
          onDismiss={() => setStatusError(null)}
          isArabicUi={isArabicUi}
          compact
        />

        {/* Status / Timer / Audio Meter Row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                liveStatus === "error"
                  ? "border-[#B54F4C]/40 bg-[#C76A67]/12 text-[#9B3B38]"
                  : isRunning && (partnerOutputLevel > 0.04 || isSpeaking)
                    ? "border-[#315F4A] bg-[#315F4A] text-white"
                    : callState === "connected"
                      ? "border-[#A8BDA9] bg-[#DCE8DD] text-[#214536]"
                      : callState === "connecting" || callState === "reconnecting" || liveStatus === "connecting" || liveStatus === "reconnecting"
                        ? "border-[#A87131]/40 bg-[#E8D8BF]/85 text-[#242A26]"
                        : isRunning
                          ? "border-[#A8BDA9] bg-[#DCE8DD]/75 text-[#214536]"
                          : "border-[#E2DFD6] bg-[#F5F3ED] text-[#565E58]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  liveStatus === "error"
                    ? "bg-[#B54F4C]"
                    : isRunning && (partnerOutputLevel > 0.04 || isSpeaking)
                      ? "bg-white animate-ping"
                      : callState === "connected"
                        ? "bg-[#3E6E53]"
                        : callState === "connecting" || callState === "reconnecting" || liveStatus === "connecting" || liveStatus === "reconnecting"
                          ? "bg-[#A87131] animate-ping"
                          : isRunning
                            ? "bg-[#315F4A] animate-pulse"
                            : "bg-[#A8BDA9]"
                }`}
              />
              <span>
                {liveStatus === "error"
                  ? isArabicUi
                    ? "تعذر التوصيل"
                    : "Connection issue"
                  : liveStatus === "connecting"
                    ? isArabicUi
                      ? "جاري تهيئة الصوت..."
                      : "Connecting..."
                    : liveStatus === "reconnecting" || callState === "reconnecting"
                      ? isArabicUi
                        ? "جاري إعادة التوصيل..."
                        : "Reconnecting..."
                      : callState === "connecting"
                        ? iceState === "checking"
                          ? isArabicUi
                            ? "جاري فحص مسار الاتصال..."
                            : "Checking connection..."
                          : isArabicUi
                            ? "جاري ربط المكالمة..."
                            : "Connecting call..."
                        : isRunning && isMuted
                          ? isArabicUi
                            ? "الميكروفون مكتوم"
                            : "Mic muted"
                          : isRunning && partnerOutputLevel > 0.04
                            ? isArabicUi
                              ? "ينطق الترجمة"
                              : "Playing translation"
                            : isRunning && isSpeaking
                              ? isArabicUi
                                ? "يسمع صوتك..."
                                : "Hearing voice..."
                              : isRunning && isTranslatingTurn
                                ? isArabicUi
                                  ? "جاري الترجمة..."
                                  : "Translating..."
                                : callState === "connected"
                                  ? isArabicUi
                                    ? "مكالمة مباشرة"
                                    : "Call active"
                                  : isRunning
                                    ? isArabicUi
                                      ? "يستمع الآن"
                                      : "Listening"
                                    : isArabicUi
                                      ? "جاهز للبدء"
                                      : "Ready"}
              </span>
            </span>

            {(callState === "connected" || callElapsedSec > 0) && (
              <span
                dir="ltr"
                className="rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#214536] tabular-nums"
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

        {/* Listening Style + Voice Call / Balance Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            className="inline-flex min-h-[44px] items-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] p-0.5"
            role="group"
            aria-label={isArabicUi ? "طريقة الاستماع" : "Listening style"}
          >
            <button
              type="button"
              onClick={() => handleSetCaptureMode("vad")}
              className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-[11px] font-semibold transition ${
                captureMode === "vad"
                  ? "bg-[#214536] text-white"
                  : "text-[#565E58] hover:text-[#242A26]"
              }`}
            >
              {isArabicUi ? "حر اليدين" : "Hands-free"}
            </button>
            <button
              type="button"
              onClick={() => handleSetCaptureMode("ptt")}
              className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-[11px] font-semibold transition ${
                captureMode === "ptt"
                  ? "bg-[#214536] text-white"
                  : "text-[#565E58] hover:text-[#242A26]"
              }`}
            >
              {isArabicUi ? "اضغط للتحدث" : "Hold to talk"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {isRunning && (
              <button
                type="button"
                onClick={() => void handleToggleVoiceCall()}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition active:scale-[0.98] ${
                  callState !== "idle" && callState !== "disconnected"
                    ? "border-[#315F4A] bg-[#DCE8DD] text-[#214536]"
                    : "border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]/60"
                }`}
              >
                <PhoneCallIcon className="w-3.5 h-3.5" />
                <span>
                  {callState !== "idle" && callState !== "disconnected"
                    ? isArabicUi
                      ? "الصوت المباشر مفعّل"
                      : "Live Voice On"
                    : isArabicUi
                      ? "تشغيل المكالمة"
                      : "Turn On Voice"}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleToggleVideo()}
              aria-label={
                videoEnabled
                  ? isArabicUi
                    ? "إيقاف الفيديو"
                    : "Turn off video"
                  : isArabicUi
                    ? "تشغيل الفيديو"
                    : "Turn on video"
              }
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition active:scale-[0.98] ${
                videoEnabled
                  ? "border-[#315F4A] bg-[#214536] text-white"
                  : "border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]/60"
              }`}
            >
              {videoEnabled ? (
                <VideoCamIcon className="w-3.5 h-3.5" />
              ) : (
                <VideoOffCamIcon className="w-3.5 h-3.5 text-[#565E58]" />
              )}
              <span>
                {videoEnabled
                  ? isArabicUi
                    ? "فيديو مفعّل"
                    : "Video On"
                  : isArabicUi
                    ? "فيديو"
                    : "Video"}
              </span>
            </button>

            {videoEnabled && (
              <button
                type="button"
                onClick={() => void handleFlipCamera()}
                aria-label={
                  isArabicUi ? "تبديل الكاميرا" : "Flip camera"
                }
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]/60"
              >
                <CameraFlipIcon className="w-4 h-4 text-[#315F4A]" />
              </button>
            )}

            <button
              type="button"
              onClick={handleToggleOriginalVoice}
              aria-label={
                originalVoiceEnabled
                  ? isArabicUi
                    ? "سماع صوت الشريك مع الترجمة"
                    : "Hear partner voice lowered during translation"
                  : isArabicUi
                    ? "سماع صوت الترجمة فقط"
                    : "Hear translated voice only"
              }
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition active:scale-[0.98] ${
                originalVoiceEnabled
                  ? isVoiceDucked
                    ? "border-[#315F4A] bg-[#DCE8DD]/80 text-[#214536]"
                    : "border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]/50"
                  : "border-[#A86D43]/45 bg-[#E8D8BF] text-[#242A26]"
              }`}
            >
              {originalVoiceEnabled ? (
                <SpeakerPlayIcon className="w-3.5 h-3.5 text-[#315F4A]" />
              ) : (
                <VolumeMutedIcon className="w-3.5 h-3.5 text-[#A86D43]" />
              )}
              <span>
                {originalVoiceEnabled
                  ? isVoiceDucked
                    ? isArabicUi
                      ? "خفض الصوت تلقائيًا"
                      : "Voice Auto-Lowered"
                    : isArabicUi
                      ? "الصوت + الترجمة"
                      : "Voice + Translation"
                  : isArabicUi
                    ? "الترجمة فقط"
                    : "Translation Only"}
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
                className="inline-flex min-h-[48px] flex-1 min-w-[150px] items-center justify-center gap-2 rounded-full bg-[#315F4A] px-5 text-xs sm:text-sm font-semibold text-white shadow-[0_6px_16px_-4px_rgba(33,69,54,0.38)] transition hover:bg-[#214536] active:scale-[0.98]"
              >
                <PhoneCallIcon className="w-4 h-4" />
                <span>
                  {isArabicUi ? "بدء المكالمة المترجمة" : "Start Live Call"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleStartLive(false)}
                className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-4 text-xs font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]/60 active:scale-[0.98]"
              >
                {isArabicUi ? "ترجمة فقط" : "Translation Only"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleToggleMute()}
                className={`inline-flex min-h-[48px] flex-1 min-w-[116px] items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition active:scale-[0.98] ${
                  isMuted
                    ? "bg-[#E8D8BF] text-[#242A26] border border-[#A87131]/40"
                    : "border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]"
                }`}
              >
                {isMuted ? (
                  <MicIcon className="w-4 h-4 text-[#315F4A]" />
                ) : (
                  <MicOffIcon className="w-4 h-4 text-[#565E58]" />
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
                        ? "كتم"
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
                className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-full border border-[#B54F4C]/40 bg-[#C76A67]/12 px-4 text-xs font-semibold text-[#9B3B38] transition hover:bg-[#C76A67]/20 active:scale-[0.98]"
              >
                <PhoneOffIcon className="w-4 h-4" />
                <span>{isArabicUi ? "إنهاء" : "End"}</span>
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
          onClick={(e) => {
            if (e.target === e.currentTarget && !endingRoom) {
              setConfirmEndOpen(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-t-[28px] sm:rounded-[28px] border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.25)] p-5 space-y-4">
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
                <p className="mt-1 text-xs leading-relaxed text-[#565E58]">
                  {isArabicUi
                    ? "سيتم فصل الهاتفين وإغلاق رابط الدعوة لهذه الغرفة."
                    : "This disconnects both phones and permanently closes this room invite."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmEndOpen(false)}
                aria-label={isArabicUi ? "إلغاء" : "Cancel"}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-white text-[#242A26]"
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

      <ConversationSummaryModal
        isOpen={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        turns={messages.map((m) => ({
          speakerLabel:
            m.sender === role
              ? `You (${myLang.label} → ${partnerLang.label})`
              : `Partner (${partnerLang.label} → ${myLang.label})`,
          sourceText: m.sourceText,
          translatedText: m.translatedText,
        }))}
        langALabel={myLang.label}
        langBLabel={partnerLang.label}
        isArabicUi={isArabicUi}
      />
    </div>
  );
}
