"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AudioSettingsDrawer from "@/components/AudioSettingsDrawer";
import AudioVisualizer from "@/components/AudioVisualizer";
import ConversationSummaryModal from "@/components/nova/ConversationSummaryModal";
import LanguageFlag from "@/components/nova/LanguageFlag";
import MoreLanguagesModal from "@/components/nova/MoreLanguagesModal";
import {
  ArrowLeftIcon,
  CopyIcon,
  HeadphonesListenIcon,
  MicIcon,
  MicOffIcon,
  SettingsGearIcon,
  SparklesIcon,
  SpeakerPlayIcon,
  StarIcon,
  TrashIcon,
  VolumeMutedIcon,
} from "@/components/nova/NovaIcons";
import RecoveryBanner from "@/components/nova/RecoveryBanner";
import {
  GeminiLiveTranslatorClient,
  type LiveConnectionStatus,
  type LiveTranscriptTurn,
} from "@/lib/ai/geminiLiveClient";
import {
  getMicManager,
  listMicDevices,
  type ClassifiedMicDevice,
} from "@/lib/audio/micManager";
import { appendTurnAudioChunk, clearTurnAudioCache, replayTurnAudio } from "@/lib/audio/replayHelper";
import { getStereoEngine } from "@/lib/audio/stereoEngine";
import { VadManager } from "@/lib/audio/vadManager";
import {
  buildSavedPhraseKey,
  toggleSavedPhrase,
  useSavedPhrases,
} from "@/lib/favoritesStore";
import { useIsOnline } from "@/lib/hooks/useNetworkStatus";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { LANGUAGE_ARABIC_NAMES } from "@/lib/i18n";
import {
  findLanguage,
  formatTranscriptForExport,
} from "@/lib/languages";
import {
  triggerHaptic,
  updateNovaSettings,
  useNovaSettings,
} from "@/lib/settingsStore";

type SubtitleSize = "sm" | "md" | "lg";

export default function LiveListenClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const speakerLang = findLanguage(searchParams.get("from") ?? "en");
  const targetLang = findLanguage(searchParams.get("to") ?? "ar-dz");

  const settings = useNovaSettings();
  const isRtl = settings.uiLocale === "ar";
  const isOnline = useIsOnline();
  const savedPhrases = useSavedPhrases();
  const savedKeys = new Set(
    savedPhrases.map((s) => buildSavedPhraseKey(s.sourceText, s.translatedText))
  );

  const [status, setStatus] = useState<LiveConnectionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioOutputEnabled, setAudioOutputEnabled] = useState(true);
  const [subtitleSize, setSubtitleSize] = useState<SubtitleSize>("md");
  const [turns, setTurns] = useState<LiveTranscriptTurn[]>([]);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);

  const [micDevices, setMicDevices] = useState<ClassifiedMicDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [activeMicLabel, setActiveMicLabel] = useState<string | null>(null);
  const [isBluetoothMicRisk, setIsBluetoothMicRisk] = useState(false);
  const [audioCtxState, setAudioCtxState] = useState<
    AudioContextState | "uninitialized"
  >("uninitialized");
  const [audioChannelCount, setAudioChannelCount] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [audioDebugNotice, setAudioDebugNotice] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [languageModalOpen, setLanguageModalOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const wakeLockActive = useWakeLock(isRunning && settings.wakeLockEnabled);

  const clientRef = useRef<GeminiLiveTranslatorClient | null>(null);
  const vadRef = useRef<VadManager | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  const audioOutputRef = useRef(audioOutputEnabled);
  const isRunningRef = useRef(false);
  const isStartingRef = useRef(false);

  useEffect(() => {
    audioOutputRef.current = audioOutputEnabled;
    if (!audioOutputEnabled) {
      getStereoEngine().stopAll();
    }
  }, [audioOutputEnabled]);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || turns.length === 0) return;
    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [turns]);

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
    if (!isRunning) return;
    let active = true;
    const tick = () => {
      if (!active) return;
      const engine = getStereoEngine();
      const levels = engine.getChannelLevels();
      setOutputLevel(Math.max(levels.left, levels.right));
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
      setOutputLevel(0);
    };
  }, [isRunning]);

  const stopSession = useCallback(
    async (preserveError = false) => {
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
      setInputLevel(0);
      setOutputLevel(0);
      if (!preserveError) setStatus("disconnected");
      syncAudioDiagnostics();
    },
    [syncAudioDiagnostics]
  );

  useEffect(() => {
    return () => {
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
      setStatus("connecting");

      const engine = getStereoEngine();
      try {
        if (unlockedCtx.state === "suspended") {
          await unlockedCtx.resume();
        }
        syncAudioDiagnostics();

        // Strictly one-way interpreter: Speaker ("A") -> Listener Subtitles/Audio ("B")
        const client = new GeminiLiveTranslatorClient({
          langACode: speakerLang.code,
          langALabel: speakerLang.label,
          langBCode: targetLang.code,
          langBLabel: targetLang.label,
          voiceName: settings.voiceName,
          speakerOverride: "A",
          swapChannels: false,
          callbacks: {
            onStatusChange: (next) => {
              setStatus(next);
              if (next === "error" && isRunningRef.current) {
                void stopSession(true);
              }
            },
            onTranscriptUpdate: (turn) => {
              setTurns((prev) => {
                const idx = prev.findIndex((t) => t.id === turn.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = turn;
                  return copy;
                }
                return [...prev, turn];
              });
            },
            onAudioOutput: (pcm16, sampleRate, _channel, turnId) => {
              setChunkCount((n) => n + 1);
              if (turnId) {
                appendTurnAudioChunk(`listen:${turnId}`, pcm16, sampleRate);
              }
              if (audioOutputRef.current) {
                try {
                  engine.enqueuePcm16(pcm16, "both", sampleRate);
                } catch (err) {
                  setAudioDebugNotice(
                    err instanceof Error ? err.message : "Audio playback failed"
                  );
                }
              }
              syncAudioDiagnostics();
            },
            onDebugNotice: (notice) => setAudioDebugNotice(notice),
            onInterrupted: () => engine.stopAll(),
            onError: (msg) => setErrorMessage(msg),
          },
        });

        clientRef.current = client;

        const handleMicLoss = () => {
          setErrorMessage(
            "Microphone disconnected or preempted. Tap Start to resume listening."
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
          onTrackEnded: handleMicLoss,
          onInputLevel: (level) => setInputLevel(level),
          onSpeechStart: () => setIsSpeaking(true),
          onSpeechEnd: () => {
            setIsSpeaking(false);
            client.sendAudioStreamEnd();
          },
          onVADMisfire: () => setIsSpeaking(false),
          onAudioFrame: (pcm16) => client.sendPcm16Frame(pcm16),
          onError: (msg) => setErrorMessage(msg),
        });

        vadRef.current = vad;

        await Promise.all([
          client.connect(),
          (async () => {
            const micInfo = await getMicManager().acquireMic(
              explicitMicId ?? (selectedMicId || undefined),
              { onTrackEnded: handleMicLoss }
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
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to start Live Listen."
        );
        await stopSession(true);
      } finally {
        isStartingRef.current = false;
      }
    },
    [
      refreshMics,
      selectedMicId,
      settings.vadSensitivity,
      settings.voiceName,
      speakerLang.code,
      speakerLang.label,
      stopSession,
      syncAudioDiagnostics,
      targetLang.code,
      targetLang.label,
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
    if (!vadRef.current || !isRunning) return;

    if (isMuted) {
      setIsMuted(false);
      await vadRef.current.start({
        preferredDeviceId: selectedMicId || undefined,
        audioContext: ctx,
        sensitivity: settings.vadSensitivity,
      });
    } else {
      if (isSpeaking) clientRef.current?.sendAudioStreamEnd();
      setIsMuted(true);
      setIsSpeaking(false);
      setInputLevel(0);
      await vadRef.current.pause();
      engine.stopAll();
    }
  };

  const handleChangeLanguages = async (nextFrom: string, nextTo: string) => {
    const resolvedFrom = findLanguage(nextFrom).code;
    const resolvedTo = findLanguage(
      nextTo === resolvedFrom ? speakerLang.code : nextTo
    ).code;
    updateNovaSettings({
      preferredLangA: resolvedTo,
      preferredLangB: resolvedFrom,
    });
    if (isRunning) await stopSession();
    router.replace(
      `/listen?from=${encodeURIComponent(resolvedFrom)}&to=${encodeURIComponent(resolvedTo)}`
    );
  };

  const handleCopy = async () => {
    const text = formatTranscriptForExport(
      turns.map((t) => ({
        speakerLabel: `${speakerLang.label} → ${targetLang.label}`,
        sourceText: t.sourceText,
        translatedText: t.translatedText,
      }))
    );
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore
    }
  };

  const getLangName = (code: string, fallback: string) => {
    if (code === "ar") return isRtl ? "العربية" : "Arabic";
    if (code === "ar-dz") return isRtl ? "الدارجة الجزائرية" : "Algerian Darija";
    return isRtl ? (LANGUAGE_ARABIC_NAMES[code] ?? fallback) : fallback;
  };

  const subtitleClass =
    subtitleSize === "lg"
      ? "text-xl sm:text-2xl font-bold leading-snug"
      : subtitleSize === "md"
        ? "text-base sm:text-lg font-bold leading-snug"
        : "text-sm font-semibold leading-snug";

  const visibleTurns = turns.filter(
    (t) => t.sourceText.trim().length > 0 || t.translatedText.trim().length > 0
  );

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="mx-auto flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-[#F5F3ED] text-[#242A26] sm:border-x sm:border-[#E2DFD6]"
    >
      {/* Top Bar */}
      <header className="border-b border-[#E2DFD6] bg-white px-3.5 py-2.5 space-y-2 nova-soft-shadow">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-3 text-xs font-semibold text-[#242A26] hover:bg-[#DCE8DD]/60"
            >
              <ArrowLeftIcon className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`} />
              <span>{isRtl ? "الرئيسية" : "Home"}</span>
            </Link>

            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#DCE8DD] px-3 py-1 text-xs font-bold text-[#214536]">
              <HeadphonesListenIcon className="w-3.5 h-3.5" />
              <span>{isRtl ? "الاستماع الفوري" : "Live Listen"}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {turns.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setSummaryOpen(true)}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-[#A8BDA9] bg-[#DCE8DD]/70 px-3 text-xs font-semibold text-[#214536]"
                >
                  <SparklesIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {isRtl ? "ملخص" : "Summarize"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  aria-label={isRtl ? "نسخ النص" : "Copy subtitles"}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#315F4A]"
                >
                  <CopyIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearTurnAudioCache("listen:");
                    setTurns([]);
                  }}
                  aria-label={isRtl ? "مسح" : "Clear subtitles"}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#565E58] hover:text-[#9B3B38]"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={isRtl ? "الإعدادات" : "Settings"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26]"
            >
              <SettingsGearIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Direction + Text Size Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setLanguageModalOpen(true)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-3.5 text-xs font-semibold text-[#242A26] hover:bg-[#DCE8DD]/55"
          >
            <LanguageFlag code={speakerLang.code} size={18} />
            <span>{getLangName(speakerLang.code, speakerLang.label)}</span>
            <span className="text-[#315F4A]">→</span>
            <LanguageFlag code={targetLang.code} size={18} />
            <span className="text-[#214536]">
              {getLangName(targetLang.code, targetLang.label)}
            </span>
          </button>

          <div
            className="inline-flex min-h-[44px] items-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] p-0.5"
            role="group"
            aria-label={isRtl ? "حجم خط الترجمة" : "Subtitle size"}
          >
            {(["sm", "md", "lg"] as SubtitleSize[]).map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => setSubtitleSize(sz)}
                className={`min-h-[40px] min-w-[40px] rounded-full px-2.5 text-xs font-bold uppercase ${
                  subtitleSize === sz
                    ? "bg-[#214536] text-white"
                    : "text-[#565E58]"
                }`}
              >
                {sz === "sm" ? "A-" : sz === "md" ? "A" : "A+"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Scrolling Live Subtitles Feed */}
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          isNearBottomRef.current = near;
          setShowJumpToLatest(!near);
        }}
        className="relative flex-1 overflow-y-auto px-4 py-4 space-y-3"
      >
        {visibleTurns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div className="max-w-sm rounded-[24px] border border-[#E2DFD6] bg-white p-5 space-y-2 nova-card-shadow">
              <p className="text-sm font-bold text-[#242A26]">
                {isRtl
                  ? "ترجمة مستمرة للمحاضرات والجولات والفيديوهات"
                  : "Continuous Subtitles & Audio Interpreter"}
              </p>
              <p className="text-xs leading-relaxed text-[#565E58]">
                {isRtl
                  ? `وجّه الهاتف نحو المتحدث بـ ${getLangName(speakerLang.code, speakerLang.label)} واقرأ أو اسمع الترجمة الفورية بـ ${getLangName(targetLang.code, targetLang.label)}.`
                  : `Listen continuously to ${speakerLang.label} speech from lectures, tours, or videos and get live ${targetLang.label} subtitles + optional audio.`}
              </p>
            </div>
          </div>
        ) : (
          visibleTurns.map((turn) => {
            const mainText = turn.translatedText || turn.sourceText;
            const subText = turn.translatedText ? turn.sourceText : "";
            const isStarred = savedKeys.has(
              buildSavedPhraseKey(turn.sourceText, turn.translatedText)
            );

            return (
              <div
                key={turn.id}
                className={`rounded-2xl border bg-white p-4 space-y-1.5 nova-soft-shadow ${
                  turn.isFinal ? "border-[#E2DFD6]" : "border-dashed border-[#315F4A]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#315F4A]">
                    {turn.isFinal
                      ? targetLang.label
                      : isRtl
                        ? "مباشر..."
                        : "Live..."}
                  </span>
                  {turn.isFinal && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic(settings.hapticsEnabled, 8);
                          toggleSavedPhrase({
                            sourceText: turn.sourceText,
                            translatedText: turn.translatedText,
                            sourceLang: speakerLang.code,
                            targetLang: targetLang.code,
                            modeLabel: isRtl ? "الاستماع الفوري" : "Live Listen",
                          });
                        }}
                        aria-label={isRtl ? "حفظ العبارة" : "Save phrase"}
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${
                          isStarred
                            ? "border-[#C58B62] bg-[#E8D8BF] text-[#A86D43]"
                            : "border-[#E2DFD6] bg-[#F5F3ED] text-[#565E58] hover:text-[#A86D43]"
                        }`}
                      >
                        <StarIcon className="w-4 h-4" filled={isStarred} />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          replayTurnAudio({
                            turnId: `listen:${turn.id}`,
                            text: mainText,
                            langCode: targetLang.code,
                            channel: "both",
                          })
                        }
                        aria-label={isRtl ? "إعادة تشغيل" : "Play audio"}
                        className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 text-xs font-semibold text-[#315F4A]"
                      >
                        <SpeakerPlayIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <p
                  dir={targetLang.rtl ? "rtl" : "ltr"}
                  className={`${subtitleClass} text-[#242A26]`}
                >
                  {mainText}
                </p>
                {subText && (
                  <p
                    dir={speakerLang.rtl ? "rtl" : "ltr"}
                    className="text-xs text-[#565E58]"
                  >
                    {subText}
                  </p>
                )}
              </div>
            );
          })
        )}

        {showJumpToLatest && visibleTurns.length > 0 && (
          <div className="sticky bottom-2 flex justify-center">
            <button
              type="button"
              onClick={() => {
                const el = scrollRef.current;
                if (!el) return;
                isNearBottomRef.current = true;
                el.scrollTop = el.scrollHeight;
                setShowJumpToLatest(false);
              }}
              className="min-h-[38px] rounded-full bg-[#214536] px-4 text-xs font-semibold text-white shadow-md"
            >
              {isRtl ? "الأحدث ↓" : "Latest ↓"}
            </button>
          </div>
        )}
      </div>

      {/* Footer Control Bar */}
      <footer className="border-t border-[#E2DFD6] bg-white px-4 py-3 space-y-2.5">
        <RecoveryBanner
          isOnline={isOnline}
          errorMessage={errorMessage}
          onRetry={!isRunning ? handleStartStop : undefined}
          onDismiss={() => setErrorMessage(null)}
          isArabicUi={isRtl}
          compact
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-3 py-1 text-[11px] font-semibold text-[#214536]">
            <span
              className={`h-2 w-2 rounded-full ${
                status === "connected"
                  ? "bg-[#4C8062] animate-pulse"
                  : status === "connecting"
                    ? "bg-[#A87131] animate-ping"
                    : "bg-[#A8BDA9]"
              }`}
            />
            <span>
              {status === "connected"
                ? isSpeaking
                  ? isRtl
                    ? "يستمع للمتحدث..."
                    : "Hearing speaker..."
                  : isMuted
                    ? isRtl
                      ? "مكتوم"
                      : "Muted"
                    : isRtl
                      ? "ترجمة مستمرة"
                      : "Listening continuously"
                : status === "connecting"
                  ? isRtl
                    ? "جاري الاتصال..."
                    : "Connecting..."
                  : copied
                    ? isRtl
                      ? "تم النسخ!"
                      : "Copied!"
                    : isRtl
                      ? "جاهز"
                      : "Ready"}
            </span>
          </span>

          <div className="flex items-center gap-2">
            <AudioVisualizer
              level={Math.max(inputLevel, outputLevel)}
              active={isSpeaking || outputLevel > 0.04}
              accent="forest"
              compact
            />

            <button
              type="button"
              onClick={() => setAudioOutputEnabled((v) => !v)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition ${
                audioOutputEnabled
                  ? "border-[#315F4A] bg-[#DCE8DD] text-[#214536]"
                  : "border-[#E2DFD6] bg-[#F5F3ED] text-[#565E58]"
              }`}
            >
              {audioOutputEnabled ? (
                <SpeakerPlayIcon className="w-3.5 h-3.5" />
              ) : (
                <VolumeMutedIcon className="w-3.5 h-3.5" />
              )}
              <span>
                {audioOutputEnabled
                  ? isRtl
                    ? "الصوت مفعّل"
                    : "Audio On"
                  : isRtl
                    ? "نصوص فقط"
                    : "Subtitles Only"}
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleStartStop}
            className={`min-h-[48px] flex-1 rounded-full px-5 text-xs sm:text-sm font-semibold transition active:scale-[0.98] ${
              isRunning
                ? "border border-[#B54F4C]/40 bg-[#C76A67]/12 text-[#9B3B38]"
                : "bg-[#315F4A] text-white shadow-[0_6px_16px_-4px_rgba(33,69,54,0.34)] hover:bg-[#214536]"
            }`}
          >
            {isRunning
              ? isRtl
                ? "إيقاف الاستماع"
                : "Stop Listening"
              : isRtl
                ? "بدء الاستماع المستمر"
                : "Start Live Listen"}
          </button>

          {isRunning && (
            <button
              type="button"
              onClick={() => void handleToggleMute()}
              className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-4 text-xs font-semibold text-[#242A26]"
            >
              {isMuted ? (
                <MicIcon className="w-4 h-4 text-[#315F4A]" />
              ) : (
                <MicOffIcon className="w-4 h-4 text-[#565E58]" />
              )}
              <span>{isMuted ? (isRtl ? "استئناف" : "Resume") : isRtl ? "كتم" : "Mute"}</span>
            </button>
          )}
        </div>
      </footer>

      <AudioSettingsDrawer
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        micDevices={micDevices}
        selectedMicId={selectedMicId}
        activeMicLabel={activeMicLabel}
        isBluetoothMicRisk={isBluetoothMicRisk}
        onSelectMic={setSelectedMicId}
        audioCtxState={audioCtxState}
        audioChannelCount={audioChannelCount}
        chunkCount={chunkCount}
        audioDebugNotice={audioDebugNotice}
        wakeLockActive={wakeLockActive}
        hideEarbudControls
        transcriptCount={turns.length}
        onExportTranscript={handleCopy}
        onClearTranscripts={() => setTurns([])}
      />

      <MoreLanguagesModal
        isOpen={languageModalOpen}
        onClose={() => setLanguageModalOpen(false)}
        langA={speakerLang.code}
        langB={targetLang.code}
        onChangePair={(a, b) => void handleChangeLanguages(a, b)}
        uiLocale={settings.uiLocale}
      />

      <ConversationSummaryModal
        isOpen={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        turns={visibleTurns.map((t) => ({
          speakerLabel: `${speakerLang.label} → ${targetLang.label}`,
          sourceText: t.sourceText,
          translatedText: t.translatedText,
        }))}
        langALabel={speakerLang.label}
        langBLabel={targetLang.label}
        isArabicUi={isRtl}
      />
    </div>
  );
}
