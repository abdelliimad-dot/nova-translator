"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SplitTranscript, {
  type ModeACaptureMode,
} from "@/components/SplitTranscript";
import {
  GeminiLiveTranslatorClient,
  type LiveConnectionStatus,
  type LiveTranscriptTurn,
  type SpeakerOverride,
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
import {
  channelToPan,
  getStereoEngine,
  type AudioChannel,
  type ChannelLevels,
} from "@/lib/audio/stereoEngine";
import { VadManager } from "@/lib/audio/vadManager";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { findLanguage } from "@/lib/languages";
import {
  triggerHaptic,
  updateNovaSettings,
  useNovaSettings,
} from "@/lib/settingsStore";
import {
  clearPersistedModeATurns,
  upsertPersistedModeATurn,
  usePersistedModeATurns,
} from "@/lib/transcriptStore";

export default function ModeAClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const langA = findLanguage(searchParams.get("langA") ?? "ar");
  const langB = findLanguage(searchParams.get("langB") ?? "en");

  const settings = useNovaSettings();
  const persistedTurns = usePersistedModeATurns(langA.code, langB.code);

  const [status, setStatus] = useState<LiveConnectionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [sessionElapsedSec, setSessionElapsedSec] = useState(0);
  const [pttActive, setPttActive] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevels, setOutputLevels] = useState<ChannelLevels>({
    left: 0,
    right: 0,
  });
  const [swapChannels, setSwapChannels] = useState(false);
  const [speakerOverride, setSpeakerOverride] = useState<SpeakerOverride>(
    settings.autoDetect ? "auto" : "A"
  );
  const [prevAutoDetect, setPrevAutoDetect] = useState(settings.autoDetect);
  if (prevAutoDetect !== settings.autoDetect) {
    setPrevAutoDetect(settings.autoDetect);
    setSpeakerOverride(settings.autoDetect ? "auto" : "A");
  }
  const [ephemeralTurns, setEphemeralTurns] = useState<LiveTranscriptTurn[]>(
    []
  );
  const [replayingTurnKey, setReplayingTurnKey] = useState<string | null>(null);

  const [micDevices, setMicDevices] = useState<ClassifiedMicDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [activeMicLabel, setActiveMicLabel] = useState<string | null>(null);
  const [isBluetoothMicRisk, setIsBluetoothMicRisk] = useState(false);

  // Audio telemetry for Settings Drawer
  const [audioCtxState, setAudioCtxState] = useState<
    AudioContextState | "uninitialized"
  >("uninitialized");
  const [audioChannelCount, setAudioChannelCount] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [lastPanChannel, setLastPanChannel] = useState<
    "left" | "right" | null
  >(null);
  const [audioDebugNotice, setAudioDebugNotice] = useState<string | null>(null);

  const wakeLockActive = useWakeLock(isRunning && settings.wakeLockEnabled);

  const clientRef = useRef<GeminiLiveTranslatorClient | null>(null);
  const vadRef = useRef<VadManager | null>(null);
  const rafRef = useRef<number | null>(null);
  const captureModeRef = useRef<ModeACaptureMode>(settings.captureMode);
  const pttActiveRef = useRef(false);
  const isStartingRef = useRef(false);
  const isRunningRef = useRef(false);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const captureMode = settings.captureMode;
  const turns = settings.saveTranscripts ? persistedTurns : ephemeralTurns;

  useEffect(() => {
    captureModeRef.current = captureMode;
  }, [captureMode]);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      setSessionElapsedSec((sec) => sec + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  // Listen for audio hardware connect/disconnect events cleanly
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

  // Auto-resume suspended AudioContext on visibility return while live
  useEffect(() => {
    if (!isRunning) return;
    return getStereoEngine().attachLifecycleRecovery((state) => {
      setAudioCtxState(state);
      if (state === "suspended") {
        setAudioDebugNotice("Audio playback suspended by OS; tap screen or Start to resume.");
      } else if (state === "running") {
        setAudioDebugNotice(null);
      }
    });
  }, [isRunning]);

  // Keep active Gemini Live client synced when speakerOverride changes
  useEffect(() => {
    clientRef.current?.setSpeakerOverride(speakerOverride);
  }, [speakerOverride]);

  const syncAudioDiagnostics = useCallback(() => {
    const diag = getStereoEngine().getDiagnostics();
    setAudioCtxState(diag.contextState);
    setAudioChannelCount(diag.channelCount);
  }, []);

  const refreshMics = useCallback(async () => {
    try {
      const res = await listMicDevices();
      setMicDevices(res.devices);
    } catch {
      // Ignore before permission
    }
  }, []);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    let active = true;
    const tick = () => {
      if (!active) return;
      const engine = getStereoEngine();
      const diag = engine.getDiagnostics();
      setOutputLevels(engine.getChannelLevels());
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
      setOutputLevels({ left: 0, right: 0 });
    };
  }, [isRunning]);

  const stopSession = useCallback(
    async (preserveErrorStatus = false) => {
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
      if (!preserveErrorStatus) {
        setStatus("disconnected");
      }
      syncAudioDiagnostics();
    },
    [syncAudioDiagnostics]
  );

  useEffect(() => {
    return () => {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
      void vadRef.current?.destroy();
      clientRef.current?.disconnect();
      getStereoEngine().stopAll();
    };
  }, []);

  const startSession = useCallback(
    async (unlockedCtx: AudioContext, explicitMicId?: string) => {
      if (isStartingRef.current || isRunningRef.current) return;
      isStartingRef.current = true;
      setErrorMessage(null);
      setAudioDebugNotice(null);
      setChunkCount(0);
      setSessionElapsedSec(0);
      setLastPanChannel(null);
      setStatus("connecting");

      const engine = getStereoEngine();
      try {
        if (unlockedCtx.state === "suspended") {
          await unlockedCtx.resume();
        }
        syncAudioDiagnostics();

        const client = new GeminiLiveTranslatorClient({
          langACode: langA.code,
          langALabel: langA.label,
          langBCode: langB.code,
          langBLabel: langB.label,
          voiceName: settings.voiceName,
          speakerOverride,
          swapChannels,
          callbacks: {
            onStatusChange: (nextStatus) => {
              setStatus(nextStatus);
              if (nextStatus === "error" && isRunningRef.current) {
                void stopSession(true);
              }
            },
            onTranscriptUpdate: (turn) => {
              if (turn.isFinal && turn.hasAudio === false && turn.translatedText) {
                setAudioDebugNotice(
                  "Short turn completed with text transcription only (no audio returned by model)."
                );
              }
              if (settings.saveTranscripts) {
                upsertPersistedModeATurn(langA.code, langB.code, turn);
              } else {
                setEphemeralTurns((prev) => {
                  const idx = prev.findIndex((t) => t.id === turn.id);
                  if (idx >= 0) {
                    const copy = [...prev];
                    copy[idx] = turn;
                    return copy;
                  }
                  return [...prev, turn];
                });
              }
            },
            onAudioOutput: (pcm16, sampleRate, channel, turnId) => {
              setChunkCount((n) => n + 1);
              setLastPanChannel(channel);
              if (turnId) {
                appendTurnAudioChunk(`modea:${turnId}`, pcm16, sampleRate);
              }
              try {
                const pan = channelToPan(channel);
                engine.enqueuePcm16(pcm16, pan, sampleRate);
              } catch (err) {
                const msg =
                  err instanceof Error ? err.message : "Audio playback failed";
                setAudioDebugNotice(`enqueuePcm16 error: ${msg}`);
              }
              syncAudioDiagnostics();
            },
            onChannelResolved: (channel) => {
              engine.setLiveStreamChannel(channelToPan(channel));
              setLastPanChannel(channel);
            },
            onDebugNotice: (notice) => {
              setAudioDebugNotice(notice);
            },
            onInterrupted: () => {
              engine.stopAll();
            },
            onError: (msg) => {
              setErrorMessage(msg);
            },
          },
        });

        clientRef.current = client;

        const handleUnexpectedMicLoss = () => {
          setErrorMessage(
            "Microphone disconnected or preempted by another app. Check your audio device and tap Start to resume."
          );
          void stopSession(true);
        };

        const vad = new VadManager({
          onMicAcquired: (info) => {
            setActiveMicLabel(info.label);
            setSelectedMicId(info.deviceId);
            setIsBluetoothMicRisk(info.isBluetoothRisk);
            engine.unlockSync();
            syncAudioDiagnostics();
            void refreshMics();
          },
          onTrackEnded: handleUnexpectedMicLoss,
          onInputLevel: (level) => {
            setInputLevel(level);
          },
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
            if (captureModeRef.current === "vad") {
              client.sendPcm16Frame(pcm16);
            }
          },
          onRawFrame: (pcm16) => {
            if (captureModeRef.current === "ptt" && pttActiveRef.current) {
              client.sendPcm16Frame(pcm16);
            }
          },
          onError: (msg) => {
            setErrorMessage(msg);
          },
        });

        vadRef.current = vad;

        // Parallelize Gemini token+WS handshake with mic acquisition & Silero WASM warmup
        await Promise.all([
          client.connect(),
          (async () => {
            const micInfo = await getMicManager().acquireMic(
              explicitMicId ?? (selectedMicId || undefined),
              { onTrackEnded: handleUnexpectedMicLoss }
            );
            setActiveMicLabel(micInfo.label);
            setSelectedMicId(micInfo.deviceId);
            setIsBluetoothMicRisk(micInfo.isBluetoothRisk);
            engine.unlockSync();
            syncAudioDiagnostics();
            void refreshMics();
            await vad.start({
              stream: micInfo.stream,
              preferredDeviceId: micInfo.deviceId || undefined,
              audioContext: unlockedCtx,
              sensitivity: settings.vadSensitivity,
            });
          })(),
        ]);

        engine.unlockSync();
        syncAudioDiagnostics();
        setIsRunning(true);
        setIsMuted(false);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to start live translation.";
        setErrorMessage(msg);
        await stopSession(true);
      } finally {
        isStartingRef.current = false;
      }
    },
    [
      langA.code,
      langA.label,
      langB.code,
      langB.label,
      refreshMics,
      selectedMicId,
      settings.saveTranscripts,
      settings.vadSensitivity,
      settings.voiceName,
      speakerOverride,
      stopSession,
      swapChannels,
      syncAudioDiagnostics,
    ]
  );

  const handleStartStop = () => {
    triggerHaptic(settings.hapticsEnabled, 12);
    if (isRunning) {
      void stopSession();
      return;
    }
    if (isStartingRef.current) return;
    const ctx = getStereoEngine().unlockSync();
    syncAudioDiagnostics();
    void startSession(ctx);
  };

  const handleToggleMute = async () => {
    triggerHaptic(settings.hapticsEnabled, 10);
    const engine = getStereoEngine();
    const ctx = engine.unlockSync();
    syncAudioDiagnostics();

    if (!vadRef.current || !isRunning) return;
    if (isMuted) {
      setIsMuted(false);
      await vadRef.current.start({
        preferredDeviceId: selectedMicId || undefined,
        audioContext: ctx,
        sensitivity: settings.vadSensitivity,
      });
      engine.unlockSync();
      syncAudioDiagnostics();
    } else {
      if (isSpeaking) {
        clientRef.current?.sendAudioStreamEnd();
      }
      setIsMuted(true);
      setIsSpeaking(false);
      setInputLevel(0);
      await vadRef.current.pause();
      engine.stopAll();
    }
  };

  const handleSetCaptureMode = (mode: ModeACaptureMode) => {
    triggerHaptic(settings.hapticsEnabled, 8);
    if (captureMode !== mode && isSpeaking) {
      pttActiveRef.current = false;
      setPttActive(false);
      setIsSpeaking(false);
      clientRef.current?.sendAudioStreamEnd();
    }
    updateNovaSettings({ captureMode: mode });
  };

  const handleChangeLanguagePair = async (nextA: string, nextB: string) => {
    triggerHaptic(settings.hapticsEnabled, 10);
    const resolvedA = findLanguage(nextA).code;
    const resolvedB = findLanguage(nextB === resolvedA ? langA.code : nextB).code;
    updateNovaSettings({
      preferredLangA: resolvedA,
      preferredLangB: resolvedB,
    });
    if (isRunning) {
      await stopSession();
    }
    router.replace(
      `/mode-a?langA=${encodeURIComponent(resolvedA)}&langB=${encodeURIComponent(resolvedB)}`
    );
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

  const handleSwapChannels = () => {
    triggerHaptic(settings.hapticsEnabled, 10);
    getStereoEngine().unlockSync();
    syncAudioDiagnostics();
    setSwapChannels((prev) => {
      const next = !prev;
      clientRef.current?.setSwapChannels(next);
      return next;
    });
  };

  const handleSetSpeakerOverride = (next: SpeakerOverride) => {
    triggerHaptic(settings.hapticsEnabled, 8);
    getStereoEngine().unlockSync();
    syncAudioDiagnostics();
    setSpeakerOverride(next);
    clientRef.current?.setSpeakerOverride(next);
  };

  const handleSelectMic = async (deviceId: string) => {
    const engine = getStereoEngine();
    const ctx = engine.unlockSync();
    syncAudioDiagnostics();

    setSelectedMicId(deviceId);
    if (vadRef.current && isRunning && !isMuted) {
      await vadRef.current.pause();
      const micInfo = await getMicManager().acquireMic(deviceId || undefined, {
        onTrackEnded: () => {
          setErrorMessage(
            "Microphone disconnected or preempted. Tap Start to reconnect."
          );
          void stopSession();
        },
      });
      setActiveMicLabel(micInfo.label);
      setIsBluetoothMicRisk(micInfo.isBluetoothRisk);
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

  const handleBeepTest = () => {
    const engine = getStereoEngine();
    engine.playBeepTestSequence((channel) => {
      setLastPanChannel(channel);
      syncAudioDiagnostics();
    });
  };

  const handleClearTurns = () => {
    triggerHaptic(settings.hapticsEnabled, 10);
    clearTurnAudioCache("modea:");
    clearPersistedModeATurns(langA.code, langB.code);
    setEphemeralTurns([]);
  };

  const handleReplayTurn = (
    turn: LiveTranscriptTurn,
    perspective: "A" | "B"
  ) => {
    triggerHaptic(settings.hapticsEnabled, 8);
    // Physical Left (-1.0) / Right (+1.0) channel assignment is strictly invariant under RTL.
    const listenerChannel: AudioChannel =
      perspective === "A"
        ? swapChannels
          ? "right"
          : "left"
        : swapChannels
          ? "left"
          : "right";

    const isIncomingTranslation = turn.speaker !== perspective;
    const ownerLang = perspective === "A" ? langA : langB;
    const textToSpeak = isIncomingTranslation
      ? turn.translatedText || turn.sourceText
      : turn.sourceText || turn.translatedText;

    const replayId = isIncomingTranslation ? `modea:${turn.id}` : `tts:${turn.id}:${perspective}`;
    replayTurnAudio({
      turnId: replayId,
      text: textToSpeak,
      langCode: ownerLang.code,
      channel: listenerChannel,
    });

    const indicatorKey = `${perspective}-${turn.id}`;
    setReplayingTurnKey(indicatorKey);
    if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    replayTimerRef.current = setTimeout(() => {
      setReplayingTurnKey(null);
    }, 1400);
  };

  return (
    <SplitTranscript
      langA={langA}
      langB={langB}
      turns={turns}
      swapChannels={swapChannels}
      status={status}
      errorMessage={errorMessage}
      isRunning={isRunning}
      isMuted={isMuted}
      isSpeaking={isSpeaking}
      captureMode={captureMode}
      pttActive={pttActive}
      inputLevel={inputLevel}
      outputLevels={outputLevels}
      speakerOverride={speakerOverride}
      sessionElapsedSec={sessionElapsedSec}
      activeMicLabel={activeMicLabel}
      isBluetoothMicRisk={isBluetoothMicRisk}
      micDevices={micDevices}
      selectedMicId={selectedMicId}
      audioCtxState={audioCtxState}
      audioChannelCount={audioChannelCount}
      chunkCount={chunkCount}
      lastPanChannel={lastPanChannel}
      audioDebugNotice={audioDebugNotice}
      wakeLockActive={wakeLockActive}
      replayingTurnKey={replayingTurnKey}
      onSelectMic={(id) => void handleSelectMic(id)}
      onStartStop={handleStartStop}
      onToggleMute={() => void handleToggleMute()}
      onSetCaptureMode={handleSetCaptureMode}
      onPttDown={handlePttDown}
      onPttUp={handlePttUp}
      onSwapChannels={handleSwapChannels}
      onSetSpeakerOverride={handleSetSpeakerOverride}
      onBeepTest={handleBeepTest}
      onClearTurns={handleClearTurns}
      onReplayTurn={handleReplayTurn}
      onChangeLanguagePair={(nextA, nextB) => void handleChangeLanguagePair(nextA, nextB)}
      onDismissError={() => setErrorMessage(null)}
    />
  );
}
