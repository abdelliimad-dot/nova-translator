"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AudioSettingsDrawer from "@/components/AudioSettingsDrawer";
import AudioVisualizer from "@/components/AudioVisualizer";
import ConversationSummaryModal from "@/components/nova/ConversationSummaryModal";
import EarbudTestModal from "@/components/EarbudTestModal";
import LanguageFlag from "@/components/nova/LanguageFlag";
import MoreLanguagesModal from "@/components/nova/MoreLanguagesModal";
import RecoveryBanner from "@/components/nova/RecoveryBanner";
import {
  ArrowLeftIcon,
  CopyIcon,
  HorizontalSwapIcon,
  MicIcon,
  MicOffIcon,
  SettingsGearIcon,
  SparklesIcon,
  SpeakerPlayIcon,
  StarIcon,
  TrashIcon,
} from "@/components/nova/NovaIcons";
import {
  buildSavedPhraseKey,
  toggleSavedPhrase,
  useSavedPhrases,
} from "@/lib/favoritesStore";
import { useIsOnline } from "@/lib/hooks/useNetworkStatus";
import type {
  LiveConnectionStatus,
  LiveTranscriptTurn,
  SpeakerOverride,
} from "@/lib/ai/geminiLiveClient";
import type { ClassifiedMicDevice } from "@/lib/audio/micManager";
import type { ChannelLevels } from "@/lib/audio/stereoEngine";
import { LANGUAGE_ARABIC_NAMES } from "@/lib/i18n";
import {
  formatTranscriptForExport,
  type SupportedLanguage,
} from "@/lib/languages";
import { useNovaSettings } from "@/lib/settingsStore";

export type ModeACaptureMode = "vad" | "ptt";

interface SplitTranscriptProps {
  langA: SupportedLanguage;
  langB: SupportedLanguage;
  turns: LiveTranscriptTurn[];
  swapChannels: boolean;
  status: LiveConnectionStatus;
  errorMessage: string | null;
  isRunning: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  captureMode: ModeACaptureMode;
  pttActive: boolean;
  inputLevel: number;
  outputLevels: ChannelLevels;
  speakerOverride: SpeakerOverride;
  sessionElapsedSec?: number;
  activeMicLabel: string | null;
  isBluetoothMicRisk: boolean;
  micDevices: ClassifiedMicDevice[];
  selectedMicId: string;
  audioCtxState: AudioContextState | "uninitialized";
  audioChannelCount: number;
  chunkCount: number;
  lastPanChannel: "left" | "right" | null;
  audioDebugNotice: string | null;
  wakeLockActive: boolean;
  replayingTurnKey?: string | null;
  onSelectMic: (deviceId: string) => void;
  onStartStop: () => void;
  onToggleMute: () => void;
  onSetCaptureMode: (mode: ModeACaptureMode) => void;
  onPttDown: () => void;
  onPttUp: () => void;
  onSwapChannels: () => void;
  onSetSpeakerOverride: (override: SpeakerOverride) => void;
  onBeepTest: () => void;
  onClearTurns: () => void;
  onReplayTurn: (turn: LiveTranscriptTurn, perspective: "A" | "B") => void;
  onChangeLanguagePair?: (nextA: string, nextB: string) => void;
  onDismissError?: () => void;
}

function StatusBadge({
  status,
  isMuted,
  isSpeaking,
  isTranslating,
  isPlayingOutput,
  isArabicUi,
}: {
  status: LiveConnectionStatus;
  isMuted: boolean;
  isSpeaking: boolean;
  isTranslating: boolean;
  isPlayingOutput: boolean;
  isArabicUi: boolean;
}) {
  if (status === "error") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#B54F4C]/40 bg-[#C76A67]/12 px-2.5 py-1 text-[11px] font-semibold text-[#9B3B38]"
      >
        <span className="h-2 w-2 rounded-full bg-[#B54F4C]" aria-hidden="true" />
        {isArabicUi ? "خطأ اتصال" : "Connection issue"}
      </span>
    );
  }
  if (status === "connecting" || status === "reconnecting") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#A87131]/35 bg-[#E8D8BF]/85 px-2.5 py-1 text-[11px] font-semibold text-[#242A26]"
      >
        <span
          className="h-2 w-2 rounded-full bg-[#A87131] animate-ping"
          aria-hidden="true"
        />
        {status === "reconnecting"
          ? isArabicUi
            ? "إعادة الاتصال..."
            : "Reconnecting..."
          : isArabicUi
            ? "جاري التوصيل..."
            : "Connecting..."}
      </span>
    );
  }
  if (status === "connected" && isMuted) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 py-1 text-[11px] font-semibold text-[#565E58]"
      >
        <span className="h-2 w-2 rounded-full bg-[#565E58]" aria-hidden="true" />
        {isArabicUi ? "الميكروفون مكتوم" : "Mic muted"}
      </span>
    );
  }
  if (status === "connected" && isPlayingOutput) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#315F4A] bg-[#315F4A] px-2.5 py-1 text-[11px] font-semibold text-white"
      >
        <span
          className="h-2 w-2 rounded-full bg-white animate-pulse"
          aria-hidden="true"
        />
        {isArabicUi ? "ينطق الترجمة" : "Speaking translation"}
      </span>
    );
  }
  if (status === "connected" && isSpeaking) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#315F4A] bg-[#214536] px-2.5 py-1 text-[11px] font-semibold text-white"
      >
        <span
          className="h-2 w-2 rounded-full bg-[#DCE8DD] animate-ping"
          aria-hidden="true"
        />
        {isArabicUi ? "يسمع صوتك..." : "Hearing voice..."}
      </span>
    );
  }
  if (status === "connected" && isTranslating) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#A87131]/35 bg-[#E8D8BF]/85 px-2.5 py-1 text-[11px] font-semibold text-[#242A26]"
      >
        <span
          className="h-2 w-2 rounded-full bg-[#A87131] animate-pulse"
          aria-hidden="true"
        />
        {isArabicUi ? "جاري الترجمة..." : "Translating..."}
      </span>
    );
  }
  if (status === "connected") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#A8BDA9] bg-[#DCE8DD] px-2.5 py-1 text-[11px] font-semibold text-[#214536]"
      >
        <span
          className="h-2 w-2 rounded-full bg-[#3E6E53] animate-pulse"
          aria-hidden="true"
        />
        {isArabicUi ? "يستمع الآن" : "Listening"}
      </span>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 py-1 text-[11px] font-semibold text-[#565E58]"
    >
      <span className="h-2 w-2 rounded-full bg-[#A8BDA9]" aria-hidden="true" />
      {isArabicUi ? "جاهز" : "Ready"}
    </span>
  );
}

const VISIBLE_WINDOW_STEP = 60;

function formatElapsedTime(totalSec: number): string {
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function TranscriptPane({
  perspective,
  ownerLang,
  otherLang,
  earTag,
  earbudLabel,
  accent,
  outputLevel,
  turns,
  rotated,
  isSpeaking,
  inputLevel,
  isArabicUi,
  replayingTurnKey,
  onReplayTurn,
}: {
  perspective: "A" | "B";
  ownerLang: SupportedLanguage;
  otherLang: SupportedLanguage;
  earTag: "L" | "R";
  earbudLabel: string;
  accent: "forest" | "sand";
  outputLevel: number;
  turns: LiveTranscriptTurn[];
  rotated?: boolean;
  isSpeaking: boolean;
  inputLevel: number;
  isArabicUi: boolean;
  replayingTurnKey?: string | null;
  onReplayTurn: (turn: LiveTranscriptTurn, perspective: "A" | "B") => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const [visibleLimit, setVisibleLimit] = useState(VISIBLE_WINDOW_STEP);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const savedPhrases = useSavedPhrases();
  const savedKeys = new Set(
    savedPhrases.map((s) => buildSavedPhraseKey(s.sourceText, s.translatedText))
  );

  const visibleTurns = turns.filter(
    (t) => t.sourceText.trim().length > 0 || t.translatedText.trim().length > 0
  );
  const hiddenCount = Math.max(0, visibleTurns.length - visibleLimit);
  const renderedTurns =
    hiddenCount > 0 ? visibleTurns.slice(-visibleLimit) : visibleTurns;

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 80;
    isNearBottomRef.current = near;
    setShowJumpToLatest(!near);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || visibleTurns.length === 0) return;
    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleTurns.length, turns]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = true;
    el.scrollTop = el.scrollHeight;
    setShowJumpToLatest(false);
  };

  const isOutputActive = outputLevel > 0.04;
  const ownerDisplay =
    ownerLang.code === "ar"
      ? "العربية"
      : isArabicUi
        ? (LANGUAGE_ARABIC_NAMES[ownerLang.code] ?? ownerLang.label)
        : ownerLang.label;
  const otherDisplay =
    otherLang.code === "ar"
      ? "العربية"
      : isArabicUi
        ? (LANGUAGE_ARABIC_NAMES[otherLang.code] ?? otherLang.label)
        : otherLang.label;

  return (
    <section
      aria-label={
        isArabicUi
          ? `لوحة المتحدث ${perspective}: ${ownerDisplay}`
          : `Person ${perspective} view: ${ownerDisplay}`
      }
      className={`relative flex flex-1 min-h-0 flex-col justify-between px-3.5 py-2 transition-colors ${
        accent === "forest" ? "bg-[#F5F3ED]" : "bg-[#EFECE3]"
      } ${rotated ? "rotate-180" : ""}`}
    >
      {/* Header Strip inside rotated/upright container */}
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[#E2DFD6]">
        <div className="flex items-center gap-1.5 min-w-0">
          <LanguageFlag code={ownerLang.code} size={20} />
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold truncate ${
              accent === "forest"
                ? "bg-[#315F4A] text-white"
                : "bg-[#A86D43] text-white"
            }`}
          >
            {isArabicUi
              ? `الشخص ${perspective} · ${ownerDisplay}`
              : `Person ${perspective} · ${ownerDisplay}`}
          </span>
          <span className="inline-flex items-center gap-1 truncate rounded-full border border-[#E2DFD6] bg-white px-2 py-0.5 text-[11px] font-medium text-[#565E58]">
            <span
              dir="ltr"
              className="font-mono text-[10px] font-bold text-[#315F4A]"
            >
              {earTag}
            </span>
            <span className="truncate">{earbudLabel}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <AudioVisualizer
            level={Math.max(outputLevel, isSpeaking ? inputLevel * 0.7 : 0)}
            active={isOutputActive || isSpeaking}
            accent={accent}
            compact
          />
        </div>
      </div>

      {/* Scrolling Live Transcript */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex flex-col flex-1 overflow-y-auto py-2 space-y-2 overscroll-contain"
      >
        {renderedTurns.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center px-3">
            <div className="max-w-xs rounded-2xl border border-[#E2DFD6] bg-white/85 px-4 py-3 nova-soft-shadow">
              <p className="text-xs leading-relaxed text-[#565E58]">
                {isArabicUi ? (
                  <>
                    تحدّث بـ{" "}
                    <span className="font-semibold text-[#242A26]">
                      {ownerDisplay}
                    </span>{" "}
                    أو{" "}
                    <span className="font-semibold text-[#242A26]">
                      {otherDisplay}
                    </span>
                    . سيظهر الكلام هنا ويُسمع في{" "}
                    <span className="font-semibold text-[#315F4A]">
                      {earbudLabel}
                    </span>
                    .
                  </>
                ) : (
                  <>
                    Speak in{" "}
                    <span className="font-semibold text-[#242A26]">
                      {ownerDisplay}
                    </span>{" "}
                    or{" "}
                    <span className="font-semibold text-[#242A26]">
                      {otherDisplay}
                    </span>
                    . Translations for Person {perspective} appear here and play
                    in{" "}
                    <span className="font-semibold text-[#315F4A]">
                      {earbudLabel}
                    </span>
                    .
                  </>
                )}
              </p>
            </div>
          </div>
        ) : (
          <>
            {hiddenCount > 0 && (
              <div className="flex justify-center pb-1">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleLimit((n) => n + VISIBLE_WINDOW_STEP)
                  }
                  className="min-h-[44px] rounded-full border border-[#E2DFD6] bg-white px-4 text-xs font-semibold text-[#315F4A] nova-soft-shadow transition hover:bg-[#DCE8DD]/55"
                >
                  {isArabicUi
                    ? `عرض الرسائل الأقدم (+${hiddenCount})`
                    : `Show earlier messages (+${hiddenCount})`}
                </button>
              </div>
            )}
            {renderedTurns.map((turn) => {
              const isIncomingTranslation = turn.speaker !== perspective;
              const otherPerspective = perspective === "A" ? "B" : "A";
              const mainText = isIncomingTranslation
                ? turn.translatedText || turn.sourceText
                : turn.sourceText || turn.translatedText;
              const subText = isIncomingTranslation
                ? turn.translatedText
                  ? turn.sourceText
                  : ""
                : turn.sourceText
                  ? turn.translatedText
                  : "";
              const mainDir = ownerLang.rtl ? "rtl" : "ltr";
              const subDir = otherLang.rtl ? "rtl" : "ltr";
              const isReplaying = replayingTurnKey === `${perspective}-${turn.id}`;

              return (
                <div
                  key={turn.id}
                  className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 nova-soft-shadow ${
                    !turn.isFinal ? "border border-dashed" : "border"
                  } ${
                    isIncomingTranslation
                      ? accent === "forest"
                        ? "self-start border-[#A8BDA9] bg-[#DCE8DD]/65"
                        : "self-start border-[#C58B62]/45 bg-[#E8D8BF]/70"
                      : "self-end border-[#E2DFD6] bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#565E58]">
                      {isIncomingTranslation
                        ? isArabicUi
                          ? `من الشخص ${otherPerspective} (${otherDisplay})`
                          : `From Person ${otherPerspective} → ${ownerDisplay}`
                        : isArabicUi
                          ? `أنت (${ownerDisplay})`
                          : `You spoke (${ownerDisplay})`}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {!turn.isFinal && (
                        <span className="rounded-full bg-[#DCE8DD] px-2 py-0.5 text-[10px] font-semibold text-[#214536] animate-pulse">
                          {isArabicUi ? "يُترجم الآن..." : "translating..."}
                        </span>
                      )}
                      {turn.isFinal && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const codeA =
                                perspective === "A"
                                  ? ownerLang.code
                                  : otherLang.code;
                              const codeB =
                                perspective === "A"
                                  ? otherLang.code
                                  : ownerLang.code;
                              toggleSavedPhrase({
                                sourceText: turn.sourceText,
                                translatedText: turn.translatedText,
                                sourceLang:
                                  turn.speaker === "A" ? codeA : codeB,
                                targetLang:
                                  turn.speaker === "A" ? codeB : codeA,
                                modeLabel: isArabicUi ? "السماعتان" : "Mode A",
                              });
                            }}
                            aria-label={isArabicUi ? "حفظ العبارة" : "Save phrase"}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition active:scale-95 ${
                              savedKeys.has(
                                buildSavedPhraseKey(
                                  turn.sourceText,
                                  turn.translatedText
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
                                  turn.sourceText,
                                  turn.translatedText
                                )
                              )}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => onReplayTurn(turn, perspective)}
                            aria-label={
                              isArabicUi
                                ? `إعادة تشغيل في ${earbudLabel}`
                                : `Play again in ${earbudLabel}`
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

        {showJumpToLatest && visibleTurns.length > 0 && (
          <div className="sticky bottom-1 flex justify-center pointer-events-none">
            <button
              type="button"
              onClick={jumpToLatest}
              className="pointer-events-auto min-h-[36px] rounded-full bg-[#214536] px-3.5 text-[11px] font-semibold text-white shadow-md transition hover:bg-[#315F4A]"
            >
              {isArabicUi ? "الأحدث ↓" : "Latest ↓"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export default function SplitTranscript({
  langA,
  langB,
  turns,
  swapChannels,
  status,
  errorMessage,
  isRunning,
  isMuted,
  isSpeaking,
  captureMode,
  pttActive,
  inputLevel,
  outputLevels,
  speakerOverride,
  sessionElapsedSec = 0,
  activeMicLabel,
  isBluetoothMicRisk,
  micDevices,
  selectedMicId,
  audioCtxState,
  audioChannelCount,
  chunkCount,
  lastPanChannel,
  audioDebugNotice,
  wakeLockActive,
  replayingTurnKey,
  onSelectMic,
  onStartStop,
  onToggleMute,
  onSetCaptureMode,
  onPttDown,
  onPttUp,
  onSwapChannels,
  onSetSpeakerOverride,
  onBeepTest,
  onClearTurns,
  onReplayTurn,
  onChangeLanguagePair,
  onDismissError,
}: SplitTranscriptProps) {
  const settings = useNovaSettings();
  const isOnline = useIsOnline();
  const isArabicUi = settings.uiLocale === "ar";

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [earbudTestOpen, setEarbudTestOpen] = useState(false);
  const [languageModalOpen, setLanguageModalOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // Physical Left (-1.0) and Right (+1.0) channel assignment stays physically accurate
  const personAEarTag: "L" | "R" = swapChannels ? "R" : "L";
  const personBEarTag: "L" | "R" = swapChannels ? "L" : "R";
  const leftText = isArabicUi ? "الأذن اليسرى" : "Left ear";
  const rightText = isArabicUi ? "الأذن اليمنى" : "Right ear";
  const personAEarbud = swapChannels ? rightText : leftText;
  const personBEarbud = swapChannels ? leftText : rightText;

  const personAOutLevel = swapChannels
    ? outputLevels.right
    : outputLevels.left;
  const personBOutLevel = swapChannels
    ? outputLevels.left
    : outputLevels.right;

  const isPlayingOutput =
    outputLevels.left > 0.04 || outputLevels.right > 0.04;
  const isTranslating = turns.some((t) => !t.isFinal);

  const codeA = langA.code.toUpperCase();
  const codeB = langB.code.toUpperCase();

  const handleCopyTranscript = async () => {
    if (turns.length === 0) return;
    const text = formatTranscriptForExport(
      turns.map((t) => ({
        speakerLabel:
          t.speaker === "A"
            ? `Person A (${langA.label} → ${langB.label})`
            : `Person B (${langB.label} → ${langA.label})`,
        sourceText: t.sourceText,
        translatedText: t.translatedText,
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

  return (
    <div
      dir={isArabicUi ? "rtl" : "ltr"}
      className="mx-auto flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-[#F5F3ED] text-[#242A26] sm:border-x sm:border-[#E2DFD6]"
    >
      {/* Top Half: Rotated 180deg for Person B sitting across */}
      <TranscriptPane
        perspective="B"
        ownerLang={langB}
        otherLang={langA}
        earTag={personBEarTag}
        earbudLabel={personBEarbud}
        accent="sand"
        outputLevel={personBOutLevel}
        turns={turns}
        rotated
        isSpeaking={isSpeaking}
        inputLevel={inputLevel}
        isArabicUi={isArabicUi}
        replayingTurnKey={replayingTurnKey}
        onReplayTurn={onReplayTurn}
      />

      {/* Center Face-to-Face Control Bar (NEVER rotated) */}
      <div className="z-20 border-y border-[#E2DFD6] bg-white px-3 py-2 shadow-[0_4px_20px_-6px_rgba(33,69,54,0.14)] space-y-2">
        {/* Top utility row */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <Link
              href="/"
              aria-label={isArabicUi ? "العودة للرئيسية" : "Back to Home"}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-3 text-xs font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]/60"
            >
              <ArrowLeftIcon
                className={`w-3.5 h-3.5 ${isArabicUi ? "rotate-180" : ""}`}
              />
              <span className="hidden min-[360px]:inline">
                {isArabicUi ? "الرئيسية" : "Home"}
              </span>
            </Link>

            <StatusBadge
              status={status}
              isMuted={isMuted}
              isSpeaking={isSpeaking}
              isTranslating={isTranslating}
              isPlayingOutput={isPlayingOutput}
              isArabicUi={isArabicUi}
            />

            {(isRunning || sessionElapsedSec > 0) && (
              <span
                dir="ltr"
                className="rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#214536] tabular-nums"
              >
                {formatElapsedTime(sessionElapsedSec)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {onChangeLanguagePair && (
              <button
                type="button"
                dir="ltr"
                onClick={() => setLanguageModalOpen(true)}
                aria-label={
                  isArabicUi ? "تغيير اللغتين" : "Change languages"
                }
                className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 text-[11px] font-semibold text-[#315F4A] transition hover:bg-[#DCE8DD]"
              >
                {codeA} ↔ {codeB}
              </button>
            )}

            {/* Swap Left / Right Earbud Channels */}
            <button
              type="button"
              onClick={onSwapChannels}
              aria-label={
                isArabicUi
                  ? "تبديل السماعة اليسرى واليمنى"
                  : "Swap left and right earbuds"
              }
              className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 text-[11px] font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]"
            >
              <HorizontalSwapIcon className="w-3.5 h-3.5 text-[#315F4A]" />
              <span>{isArabicUi ? "السماعتان" : "Swap ears"}</span>
            </button>

            {turns.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setSummaryOpen(true)}
                  aria-label={isArabicUi ? "تلخيص المحادثة" : "Summarize conversation"}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-[#A8BDA9] bg-[#DCE8DD]/70 px-2.5 text-[11px] font-semibold text-[#214536] transition hover:bg-[#DCE8DD]"
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
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 text-[11px] font-semibold text-[#315F4A] transition hover:bg-[#DCE8DD]"
                >
                  <CopyIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {copiedToast ? "✓" : isArabicUi ? "نسخ" : "Copy"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onClearTurns}
                  aria-label={isArabicUi ? "مسح السجل" : "Clear transcript"}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#565E58] transition hover:bg-[#C76A67]/15 hover:text-[#9B3B38]"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={isArabicUi ? "الإعدادات" : "Open settings"}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${
                isBluetoothMicRisk
                  ? "border-[#A87131] bg-[#E8D8BF] text-[#242A26]"
                  : "border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]"
              }`}
            >
              <SettingsGearIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Direction + Listening Style Row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            dir="ltr"
            className="inline-flex min-h-[44px] items-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] p-0.5"
            role="group"
            aria-label={
              isArabicUi ? "اتجاه الترجمة" : "Who is speaking direction"
            }
          >
            <button
              type="button"
              onClick={() => onSetSpeakerOverride("auto")}
              aria-label={
                isArabicUi
                  ? "تلقائي بالاتجاهين"
                  : "Auto-detect either speaker"
              }
              className={`min-h-[44px] min-w-[44px] rounded-full px-2.5 text-[11px] font-semibold transition ${
                speakerOverride === "auto"
                  ? "bg-[#214536] text-white"
                  : "text-[#565E58] hover:text-[#242A26]"
              }`}
            >
              {isArabicUi ? "تلقائي" : "Auto"}
            </button>
            <button
              type="button"
              onClick={() => onSetSpeakerOverride("A")}
              aria-label={`Translate ${langA.label} to ${langB.label}`}
              className={`min-h-[44px] min-w-[44px] rounded-full px-2 text-[11px] font-semibold transition ${
                speakerOverride === "A"
                  ? "bg-[#315F4A] text-white"
                  : "text-[#565E58] hover:text-[#242A26]"
              }`}
            >
              {codeA}→{codeB}
            </button>
            <button
              type="button"
              onClick={() => onSetSpeakerOverride("B")}
              aria-label={`Translate ${langB.label} to ${langA.label}`}
              className={`min-h-[44px] min-w-[44px] rounded-full px-2 text-[11px] font-semibold transition ${
                speakerOverride === "B"
                  ? "bg-[#A86D43] text-white"
                  : "text-[#565E58] hover:text-[#242A26]"
              }`}
            >
              {codeB}→{codeA}
            </button>
          </div>

          <div
            className="inline-flex min-h-[44px] items-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] p-0.5"
            role="group"
            aria-label={isArabicUi ? "طريقة الاستماع" : "Listening style"}
          >
            <button
              type="button"
              onClick={() => onSetCaptureMode("vad")}
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
              onClick={() => onSetCaptureMode("ptt")}
              className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-[11px] font-semibold transition ${
                captureMode === "ptt"
                  ? "bg-[#214536] text-white"
                  : "text-[#565E58] hover:text-[#242A26]"
              }`}
            >
              {isArabicUi ? "اضغط للتحدث" : "Hold to talk"}
            </button>
          </div>
        </div>

        {/* Primary Action Row */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onStartStop}
            className={`min-h-[46px] flex-1 min-w-[140px] rounded-full px-4 text-xs sm:text-sm font-semibold transition active:scale-[0.98] ${
              isRunning
                ? "border border-[#B54F4C]/40 bg-[#C76A67]/12 text-[#9B3B38] hover:bg-[#C76A67]/20"
                : "bg-[#315F4A] text-white shadow-[0_6px_16px_-4px_rgba(33,69,54,0.38)] hover:bg-[#214536]"
            }`}
          >
            {isRunning
              ? isArabicUi
                ? "إنهاء المحادثة"
                : "End Conversation"
              : isArabicUi
                ? "ابدأ الترجمة الفورية"
                : "Start Translation"}
          </button>

          {isRunning && captureMode === "vad" && (
            <button
              type="button"
              onClick={onToggleMute}
              className={`inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition active:scale-[0.98] ${
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
                    ? "استئناف"
                    : "Resume Mic"
                  : isArabicUi
                    ? "كتم"
                    : "Mute"}
              </span>
            </button>
          )}

          {isRunning && captureMode === "ptt" && (
            <button
              type="button"
              onPointerDown={onPttDown}
              onPointerUp={onPttUp}
              onPointerCancel={onPttUp}
              onPointerLeave={onPttUp}
              className={`inline-flex min-h-[46px] flex-1 min-w-[140px] select-none items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition ${
                pttActive
                  ? "bg-[#214536] text-white"
                  : "border border-[#315F4A]/40 bg-[#DCE8DD] text-[#214536]"
              }`}
            >
              <MicIcon className="w-4 h-4" />
              <span>
                {pttActive
                  ? isArabicUi
                    ? "يستمع... اترك للإرسال"
                    : "Listening... Release"
                  : isArabicUi
                    ? "اضغط مطولًا للتحدث"
                    : "Hold to Speak"}
              </span>
            </button>
          )}
        </div>

        <RecoveryBanner
          isOnline={isOnline}
          errorMessage={errorMessage}
          onRetry={!isRunning ? onStartStop : undefined}
          onDismiss={onDismissError}
          isArabicUi={isArabicUi}
          compact
        />

        {isBluetoothMicRisk && !errorMessage && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[#A87131]/35 bg-[#E8D8BF]/50 px-3 py-1.5 text-[11px] font-medium text-[#242A26]">
            <span className="truncate">
              {isArabicUi
                ? "ميكروفون البلوتوث نشط — يُنصح بميكروفون الهاتف لفصل الأذنين"
                : "Bluetooth mic active — switch to Phone Mic in Settings to keep stereo ears separate"}
            </span>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="shrink-0 font-semibold text-[#214536] underline"
            >
              {isArabicUi ? "ضبط" : "Fix"}
            </button>
          </div>
        )}
      </div>

      {/* Bottom Half: Upright for Person A */}
      <TranscriptPane
        perspective="A"
        ownerLang={langA}
        otherLang={langB}
        earTag={personAEarTag}
        earbudLabel={personAEarbud}
        accent="forest"
        outputLevel={personAOutLevel}
        turns={turns}
        isSpeaking={isSpeaking}
        inputLevel={inputLevel}
        isArabicUi={isArabicUi}
        replayingTurnKey={replayingTurnKey}
        onReplayTurn={onReplayTurn}
      />

      {/* Drawers & Modals (NEVER rotated) */}
      <AudioSettingsDrawer
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        micDevices={micDevices}
        selectedMicId={selectedMicId}
        activeMicLabel={activeMicLabel}
        isBluetoothMicRisk={isBluetoothMicRisk}
        onSelectMic={onSelectMic}
        audioCtxState={audioCtxState}
        audioChannelCount={audioChannelCount}
        chunkCount={chunkCount}
        lastPanChannel={lastPanChannel}
        audioDebugNotice={audioDebugNotice}
        wakeLockActive={wakeLockActive}
        onBeepTest={onBeepTest}
        onOpenEarbudTest={() => setEarbudTestOpen(true)}
        transcriptCount={turns.length}
        onExportTranscript={handleCopyTranscript}
        onClearTranscripts={onClearTurns}
      />

      <EarbudTestModal
        isOpen={earbudTestOpen}
        onClose={() => setEarbudTestOpen(false)}
        langALabel={langA.label}
        langBLabel={langB.label}
      />

      {onChangeLanguagePair && (
        <MoreLanguagesModal
          isOpen={languageModalOpen}
          onClose={() => setLanguageModalOpen(false)}
          langA={langA.code}
          langB={langB.code}
          onChangePair={onChangeLanguagePair}
          uiLocale={settings.uiLocale}
        />
      )}

      <ConversationSummaryModal
        isOpen={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        turns={turns.map((t) => ({
          speakerLabel:
            t.speaker === "A"
              ? `Person A (${langA.label} → ${langB.label})`
              : `Person B (${langB.label} → ${langA.label})`,
          sourceText: t.sourceText,
          translatedText: t.translatedText,
        }))}
        langALabel={langA.label}
        langBLabel={langB.label}
        isArabicUi={isArabicUi}
      />
    </div>
  );
}
