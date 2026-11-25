"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AudioSettingsDrawer from "@/components/AudioSettingsDrawer";
import AudioVisualizer from "@/components/AudioVisualizer";
import EarbudTestModal from "@/components/EarbudTestModal";
import LanguageFlag from "@/components/nova/LanguageFlag";
import RecoveryBanner from "@/components/nova/RecoveryBanner";
import {
  ArrowLeftIcon,
  CopyIcon,
  HorizontalSwapIcon,
  MicIcon,
  MicOffIcon,
  SettingsGearIcon,
  SpeakerPlayIcon,
  TrashIcon,
} from "@/components/nova/NovaIcons";
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
  onDismissError?: () => void;
}

function StatusBadge({
  status,
  isMuted,
  isSpeaking,
  isArabicUi,
}: {
  status: LiveConnectionStatus;
  isMuted: boolean;
  isSpeaking: boolean;
  isArabicUi: boolean;
}) {
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C76A67]/40 bg-[#C76A67]/15 px-2.5 py-1 text-[11px] font-semibold text-[#C76A67]">
        <span className="h-2 w-2 rounded-full bg-[#C76A67]" />
        {isArabicUi ? "خطأ" : "Error"}
      </span>
    );
  }
  if (status === "connecting" || status === "reconnecting") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C28B47]/40 bg-[#E8D8BF]/70 px-2.5 py-1 text-[11px] font-semibold text-[#242A26]">
        <span className="h-2 w-2 rounded-full bg-[#C28B47] animate-ping" />
        {status === "reconnecting"
          ? isArabicUi
            ? "إعادة اتصال"
            : "Reconnecting"
          : isArabicUi
            ? "جاري الاتصال"
            : "Connecting"}
      </span>
    );
  }
  if (status === "connected" && isMuted) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-2.5 py-1 text-[11px] font-semibold text-[#777F79]">
        <span className="h-2 w-2 rounded-full bg-[#777F79]" />
        {isArabicUi ? "مكتوم" : "Muted"}
      </span>
    );
  }
  if (status === "connected") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
          isSpeaking
            ? "border-[#315F4A] bg-[#315F4A] text-white"
            : "border-[#A8BDA9] bg-[#DCE8DD] text-[#214536]"
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            isSpeaking ? "bg-white animate-ping" : "bg-[#4C8062] animate-pulse"
          }`}
        />
        {isSpeaking
          ? isArabicUi
            ? "يستمع..."
            : "Translating"
          : isArabicUi
            ? "مباشر"
            : "Live"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-2.5 py-1 text-[11px] font-semibold text-[#777F79]">
      <span className="h-2 w-2 rounded-full bg-[#A8BDA9]" />
      {isArabicUi ? "جاهز" : "Ready"}
    </span>
  );
}

function TranscriptPane({
  perspective,
  ownerLang,
  otherLang,
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

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [turns]);

  const isOutputActive = outputLevel > 0.04;
  const ownerDisplay = isArabicUi
    ? (LANGUAGE_ARABIC_NAMES[ownerLang.code] ?? ownerLang.label)
    : ownerLang.label;
  const otherDisplay = isArabicUi
    ? (LANGUAGE_ARABIC_NAMES[otherLang.code] ?? otherLang.label)
    : otherLang.label;

  return (
    <section
      className={`relative flex flex-1 min-h-0 flex-col justify-between px-3.5 py-2.5 transition-colors ${
        accent === "forest" ? "bg-[#F5F3ED]" : "bg-[#EFECE3]"
      } ${rotated ? "rotate-180" : ""}`}
    >
      {/* Header Strip inside rotated/upright container */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E6E5DE]">
        <div className="flex items-center gap-2 min-w-0">
          <LanguageFlag code={ownerLang.code} size={22} />
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold truncate ${
              accent === "forest"
                ? "bg-[#315F4A] text-white"
                : "bg-[#C58B62] text-white"
            }`}
          >
            {isArabicUi
              ? `المتحدث ${perspective} · ${ownerDisplay}`
              : `Person ${perspective} · ${ownerDisplay}`}
          </span>
          {/* Keep physical pan/earbud label strictly LTR */}
          <span
            dir="ltr"
            className="truncate rounded-full border border-[#E6E5DE] bg-white px-2 py-0.5 font-mono text-[10px] font-medium text-[#777F79]"
          >
            {earbudLabel}
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
        className="flex flex-col flex-1 overflow-y-auto py-2.5 space-y-2.5 overscroll-contain"
      >
        {turns.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center px-4">
            <div className="max-w-xs rounded-2xl border border-[#E6E5DE] bg-white/80 px-4 py-3 nova-soft-shadow">
              <p className="text-xs leading-relaxed text-[#777F79]">
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
                    . ستظهر الترجمة هنا وتُسمع في{" "}
                    <span dir="ltr" className="font-semibold text-[#315F4A]">
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
                    <span dir="ltr" className="font-semibold text-[#315F4A]">
                      {earbudLabel}
                    </span>
                    .
                  </>
                )}
              </p>
            </div>
          </div>
        ) : (
          turns.map((turn) => {
            const isIncomingTranslation = turn.speaker !== perspective;
            const otherPerspective = perspective === "A" ? "B" : "A";
            const mainText = isIncomingTranslation
              ? turn.translatedText || "..."
              : turn.sourceText || "...";
            const subText = isIncomingTranslation
              ? turn.sourceText
              : turn.translatedText;
            const mainDir = ownerLang.rtl ? "rtl" : "ltr";
            const subDir = otherLang.rtl ? "rtl" : "ltr";
            const isReplaying = replayingTurnKey === `${perspective}-${turn.id}`;

            return (
              <div
                key={turn.id}
                className={`max-w-[90%] rounded-2xl border px-3.5 py-2.5 nova-soft-shadow ${
                  isIncomingTranslation
                    ? accent === "forest"
                      ? "self-start border-[#A8BDA9] bg-[#DCE8DD]/65"
                      : "self-start border-[#C58B62]/45 bg-[#E8D8BF]/65"
                    : "self-end border-[#E6E5DE] bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#777F79]">
                    {isIncomingTranslation
                      ? isArabicUi
                        ? `المتحدث ${otherPerspective} → ${ownerDisplay}`
                        : `Person ${otherPerspective} → ${earbudLabel}`
                      : isArabicUi
                        ? `أنت (${ownerDisplay})`
                        : `You (${ownerDisplay})`}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {!turn.isFinal && (
                      <span className="text-[10px] font-semibold text-[#315F4A] animate-pulse">
                        {isArabicUi ? "مباشر" : "live"}
                      </span>
                    )}
                    {turn.isFinal && (
                      <button
                        type="button"
                        onClick={() => onReplayTurn(turn, perspective)}
                        aria-label={
                          isArabicUi ? "إعادة تشغيل الصوت" : "Replay turn audio"
                        }
                        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border px-2.5 text-[10px] font-semibold transition active:scale-95 ${
                          isReplaying
                            ? "border-[#315F4A] bg-[#315F4A] text-white"
                            : "border-[#E6E5DE] bg-[#F5F3ED] text-[#315F4A] hover:bg-[#DCE8DD]"
                        }`}
                      >
                        <SpeakerPlayIcon className="w-3.5 h-3.5" />
                        <span>{isArabicUi ? "إعادة" : "Play"}</span>
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
  onDismissError,
}: SplitTranscriptProps) {
  const settings = useNovaSettings();
  const isOnline = useIsOnline();
  const isArabicUi = settings.uiLocale === "ar";

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [earbudTestOpen, setEarbudTestOpen] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  // Physical Left (-1.0) and Right (+1.0) earbud channel names are never RTL-reversed
  const personAEarbud = swapChannels ? "Right (-1→+1 R)" : "Left (-1.0 L)";
  const personBEarbud = swapChannels ? "Left (-1.0 L)" : "Right (+1.0 R)";
  const personAOutLevel = swapChannels
    ? outputLevels.right
    : outputLevels.left;
  const personBOutLevel = swapChannels
    ? outputLevels.left
    : outputLevels.right;

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
      setTimeout(() => setCopiedToast(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div
      dir={isArabicUi ? "rtl" : "ltr"}
      className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#F5F3ED] text-[#242A26]"
    >
      {/* Top Half: ONLY Person B's container is rotated 180deg */}
      <TranscriptPane
        perspective="B"
        ownerLang={langB}
        otherLang={langA}
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
      <div className="z-20 border-y border-[#E6E5DE] bg-white px-3 py-2.5 shadow-[0_4px_20px_-6px_rgba(33,69,54,0.14)] space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <Link
              href="/"
              aria-label={isArabicUi ? "العودة للرئيسية" : "Back to Home"}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-3 text-xs font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]/60"
            >
              <ArrowLeftIcon
                className={`w-3.5 h-3.5 ${isArabicUi ? "rotate-180" : ""}`}
              />
              <span>{isArabicUi ? "الرئيسية" : "Home"}</span>
            </Link>

            <StatusBadge
              status={status}
              isMuted={isMuted}
              isSpeaking={isSpeaking}
              isArabicUi={isArabicUi}
            />
          </div>

          <div className="flex items-center gap-1.5">
            {/* Bidirectional Auto Default + Manual Direction Overrides (keeps LTR code pair readable) */}
            <div
              dir="ltr"
              className="inline-flex min-h-[44px] items-center rounded-full border border-[#E6E5DE] bg-[#F5F3ED] p-0.5"
              role="group"
              aria-label="Translation direction mode"
            >
              <button
                type="button"
                onClick={() => onSetSpeakerOverride("auto")}
                className={`min-h-[44px] min-w-[44px] rounded-full px-2.5 text-[11px] font-semibold transition ${
                  speakerOverride === "auto"
                    ? "bg-[#214536] text-white"
                    : "text-[#777F79] hover:text-[#242A26]"
                }`}
              >
                Auto
              </button>
              <button
                type="button"
                onClick={() => onSetSpeakerOverride("A")}
                className={`min-h-[44px] min-w-[44px] rounded-full px-2 text-[10px] font-semibold transition ${
                  speakerOverride === "A"
                    ? "bg-[#315F4A] text-white"
                    : "text-[#777F79] hover:text-[#242A26]"
                }`}
              >
                {codeA}→{codeB}
              </button>
              <button
                type="button"
                onClick={() => onSetSpeakerOverride("B")}
                className={`min-h-[44px] min-w-[44px] rounded-full px-2 text-[10px] font-semibold transition ${
                  speakerOverride === "B"
                    ? "bg-[#C58B62] text-white"
                    : "text-[#777F79] hover:text-[#242A26]"
                }`}
              >
                {codeB}→{codeA}
              </button>
            </div>

            {/* Physical Left <-> Right Channel Swap */}
            <button
              type="button"
              dir="ltr"
              onClick={onSwapChannels}
              title="Swap Left and Right earbud channels"
              aria-label="Swap Left and Right earbud channels"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-2.5 text-[11px] font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]"
            >
              <HorizontalSwapIcon className="w-3.5 h-3.5 text-[#315F4A]" />
              <span>L/R</span>
            </button>

            {turns.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => void handleCopyTranscript()}
                  aria-label={isArabicUi ? "نسخ النص" : "Copy transcript"}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-2.5 text-[11px] font-semibold text-[#315F4A] transition hover:bg-[#DCE8DD]"
                >
                  <CopyIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {copiedToast ? "✓" : isArabicUi ? "نسخ" : "Copy"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onClearTurns}
                  aria-label={isArabicUi ? "مسح المحادثة" : "Clear transcript"}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-[#E6E5DE] bg-[#F5F3ED] text-[#777F79] transition hover:bg-[#C76A67]/15 hover:text-[#C76A67]"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </>
            )}

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

        {/* Primary Session Controls + Auto-VAD / Push-to-Talk */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex min-h-[44px] items-center rounded-full border border-[#E6E5DE] bg-[#F5F3ED] p-0.5">
            <button
              type="button"
              onClick={() => onSetCaptureMode("vad")}
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
              onClick={() => onSetCaptureMode("ptt")}
              className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-[11px] font-semibold transition ${
                captureMode === "ptt"
                  ? "bg-[#214536] text-white"
                  : "text-[#777F79] hover:text-[#242A26]"
              }`}
            >
              {isArabicUi ? "اضغط للتحدث" : "Push-to-Talk"}
            </button>
          </div>

          <button
            type="button"
            onClick={onStartStop}
            className={`min-h-[44px] flex-1 min-w-[136px] rounded-full px-4 text-xs font-semibold transition active:scale-[0.98] ${
              isRunning
                ? "border border-[#C76A67]/40 bg-[#C76A67]/12 text-[#C76A67] hover:bg-[#C76A67]/20"
                : "bg-[#315F4A] text-white shadow-[0_6px_16px_-4px_rgba(33,69,54,0.38)] hover:bg-[#214536]"
            }`}
          >
            {isRunning
              ? isArabicUi
                ? "إنهاء الجلسة"
                : "End Session"
              : isArabicUi
                ? "ابدأ الترجمة الفورية"
                : "Start Live Translation"}
          </button>

          {isRunning && captureMode === "vad" && (
            <button
              type="button"
              onClick={onToggleMute}
              className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition active:scale-[0.98] ${
                isMuted
                  ? "bg-[#E8D8BF] text-[#242A26] border border-[#C28B47]/40"
                  : "border border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]"
              }`}
            >
              {isMuted ? (
                <MicIcon className="w-3.5 h-3.5 text-[#315F4A]" />
              ) : (
                <MicOffIcon className="w-3.5 h-3.5 text-[#777F79]" />
              )}
              <span>
                {isMuted
                  ? isArabicUi
                    ? "تشغيل الميكروفون"
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
              className={`inline-flex min-h-[44px] flex-1 min-w-[140px] select-none items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition ${
                pttActive
                  ? "bg-[#214536] text-white"
                  : "border border-[#315F4A]/40 bg-[#DCE8DD] text-[#214536]"
              }`}
            >
              <MicIcon className="w-3.5 h-3.5" />
              <span>
                {pttActive
                  ? isArabicUi
                    ? "جارٍ الاستماع... اترك للإرسال"
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
          <div className="rounded-xl border border-[#C28B47]/35 bg-[#E8D8BF]/45 px-3 py-1.5 text-[11px] font-medium truncate text-[#242A26]">
            {isArabicUi
              ? "ميكروفون البلوتوث نشط — افتح الإعدادات لاختيار ميكروفون الهاتف المدمج"
              : "Bluetooth headset mic active — open Settings to switch to Built-in mic"}
          </div>
        )}
      </div>

      {/* Bottom Half: Upright for Person A */}
      <TranscriptPane
        perspective="A"
        ownerLang={langA}
        otherLang={langB}
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
    </div>
  );
}
