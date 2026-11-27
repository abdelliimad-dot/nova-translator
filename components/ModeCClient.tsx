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
  MicIcon,
  MicOffIcon,
  SettingsGearIcon,
  SparklesIcon,
  SpeakerPlayIcon,
  StarIcon,
  TrashIcon,
} from "@/components/nova/NovaIcons";
import RecoveryBanner from "@/components/nova/RecoveryBanner";
import {
  GeminiLiveTranslatorClient,
  type LiveConnectionStatus,
  type LiveTranscriptTurn,
} from "@/lib/ai/geminiLiveClient";
import {
  buildSavedPhraseKey,
  toggleSavedPhrase,
  useSavedPhrases,
} from "@/lib/favoritesStore";
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
import { useIsOnline } from "@/lib/hooks/useNetworkStatus";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { LANGUAGE_ARABIC_NAMES } from "@/lib/i18n";
import {
  findLanguage,
  formatTranscriptForExport,
  type SupportedLanguage,
} from "@/lib/languages";
import {
  triggerHaptic,
  updateNovaSettings,
  useNovaSettings,
} from "@/lib/settingsStore";
import {
  clearPersistedModeCTurns,
  upsertPersistedModeCTurn,
  usePersistedModeCTurns,
} from "@/lib/transcriptStore";

type SpeakingStyle = "tap" | "auto";
type SpeakerPhase =
  | "idle"
  | "connecting"
  | "listening"
  | "translating"
  | "speaking";

const ANTI_ECHO_COOLDOWN_MS = 350;
const VISIBLE_WINDOW_STEP = 60;

function formatElapsedTime(sec: number): string {
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function getLangDisplayName(
  lang: SupportedLanguage,
  isArabicUi: boolean
): string {
  if (lang.code === "ar") return "العربية";
  if (isArabicUi) return LANGUAGE_ARABIC_NAMES[lang.code] ?? lang.label;
  return lang.label;
}

function SpeakerStatePill({
  status,
  phase,
  activeTurnOwner,
  isMuted,
  isCooldown,
  isArabicUi,
}: {
  status: LiveConnectionStatus;
  phase: SpeakerPhase;
  activeTurnOwner: "A" | "B" | null;
  isMuted: boolean;
  isCooldown: boolean;
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

  if (phase === "connecting" || status === "connecting" || status === "reconnecting") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#A87131]/35 bg-[#E8D8BF]/85 px-2.5 py-1 text-[11px] font-semibold text-[#242A26]"
      >
        <span className="h-2 w-2 rounded-full bg-[#A87131] animate-ping" aria-hidden="true" />
        {isArabicUi ? "جاري الاتصال..." : "Connecting..."}
      </span>
    );
  }

  if (phase === "speaking") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#C58B62]/45 bg-[#E8D8BF] px-2.5 py-1 text-[11px] font-semibold text-[#242A26]"
      >
        <span className="h-2 w-2 rounded-full bg-[#A86D43] animate-pulse" aria-hidden="true" />
        {isCooldown
          ? isArabicUi
            ? "تهدئة المكبر..."
            : "Speaker cooldown..."
          : isArabicUi
            ? "يتحدث عبر مكبر الصوت..."
            : "Speaking on Speaker..."}
      </span>
    );
  }

  if (phase === "translating") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#315F4A]/35 bg-[#DCE8DD] px-2.5 py-1 text-[11px] font-semibold text-[#214536]"
      >
        <span className="h-2 w-2 rounded-full bg-[#315F4A] animate-ping" aria-hidden="true" />
        {isArabicUi ? "جاري الترجمة..." : "Translating..."}
      </span>
    );
  }

  if (isMuted) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 py-1 text-[11px] font-semibold text-[#565E58]"
      >
        <span className="h-2 w-2 rounded-full bg-[#777F79]" aria-hidden="true" />
        {isArabicUi ? "الميكروفون مكتوم" : "Mic muted"}
      </span>
    );
  }

  if (phase === "listening") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#4C8062]/45 bg-[#DCE8DD] px-2.5 py-1 text-[11px] font-semibold text-[#214536]"
      >
        <span className="h-2 w-2 rounded-full bg-[#4C8062] animate-pulse" aria-hidden="true" />
        {activeTurnOwner
          ? isArabicUi
            ? `يستمع للشخص ${activeTurnOwner}...`
            : `Listening (Person ${activeTurnOwner})...`
          : isArabicUi
            ? "يستمع الآن..."
            : "Listening..."}
      </span>
    );
  }

  if (status === "connected") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#4C8062]/35 bg-[#DCE8DD]/65 px-2.5 py-1 text-[11px] font-semibold text-[#214536]"
      >
        <span className="h-2 w-2 rounded-full bg-[#4C8062]" aria-hidden="true" />
        {isArabicUi ? "جاهز — اضغط للتحدث" : "Ready — Tap to speak"}
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 py-1 text-[11px] font-medium text-[#565E58]"
    >
      <span className="h-2 w-2 rounded-full bg-[#A8BDA9]" aria-hidden="true" />
      {isArabicUi ? "اضغط بدء أو الميكروفون" : "Tap Start or Mic"}
    </span>
  );
}

interface SpeakerPaneProps {
  perspective: "A" | "B";
  ownerLang: SupportedLanguage;
  otherLang: SupportedLanguage;
  accent: "forest" | "sand";
  rotated?: boolean;
  turns: LiveTranscriptTurn[];
  speakingStyle: SpeakingStyle;
  isRunning: boolean;
  isStarting: boolean;
  isSpeakerLocked: boolean;
  activeTapTurn: "A" | "B" | null;
  phase: SpeakerPhase;
  inputLevel: number;
  outputLevel: number;
  isArabicUi: boolean;
  replayingTurnKey: string | null;
  onTapSpeak: (person: "A" | "B") => void;
  onReplayTurn: (turn: LiveTranscriptTurn, perspective: "A" | "B") => void;
}

function SpeakerPane({
  perspective,
  ownerLang,
  otherLang,
  accent,
  rotated = false,
  turns,
  speakingStyle,
  isRunning,
  isStarting,
  isSpeakerLocked,
  activeTapTurn,
  phase,
  inputLevel,
  outputLevel,
  isArabicUi,
  replayingTurnKey,
  onTapSpeak,
  onReplayTurn,
}: SpeakerPaneProps) {
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

  const ownerDisplay = getLangDisplayName(ownerLang, isArabicUi);
  const otherDisplay = getLangDisplayName(otherLang, isArabicUi);
  const isMyTapActive = activeTapTurn === perspective;
  const isOtherTapActive =
    activeTapTurn !== null && activeTapTurn !== perspective;
  const isAudioOut = outputLevel > 0.04 || phase === "speaking";

  const tapButtonDisabled =
    isStarting || isSpeakerLocked || isOtherTapActive;

  const getTapLabel = () => {
    if (isSpeakerLocked) {
      return isArabicUi ? "مكبر الصوت يتحدث..." : "Speaking on Speaker...";
    }
    if (isMyTapActive) {
      return isArabicUi ? "يستمع... اضغط للإرسال" : "Listening... Tap when done";
    }
    if (isOtherTapActive) {
      return isArabicUi
        ? `الشخص ${activeTapTurn} يتحدث الآن...`
        : `Person ${activeTapTurn} is speaking...`;
    }
    if (phase === "translating" && !isRunning) {
      return isArabicUi ? "جاري التحضير..." : "Preparing...";
    }
    return isArabicUi
      ? `اضغط للتحدث بـ ${ownerDisplay}`
      : `Tap to Speak ${ownerDisplay}`;
  };

  return (
    <section
      aria-label={
        isArabicUi
          ? `لوحة الشخص ${perspective}: ${ownerDisplay}`
          : `Person ${perspective} view: ${ownerDisplay}`
      }
      className={`relative flex flex-1 min-h-0 flex-col justify-between px-3.5 py-2 transition-colors ${
        accent === "forest" ? "bg-[#F5F3ED]" : "bg-[#EFECE3]"
      } ${rotated ? "rotate-180" : ""}`}
    >
      {/* Pane Header (No L/R earbud badges) */}
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
            <SpeakerPlayIcon className="w-3 h-3 shrink-0 text-[#315F4A]" />
            <span className="truncate">
              {isArabicUi ? "مكبر الصوت" : "Speaker"}
            </span>
          </span>
        </div>

        <AudioVisualizer
          level={Math.max(
            outputLevel,
            isMyTapActive || (speakingStyle === "auto" && phase === "listening")
              ? inputLevel
              : 0
          )}
          active={isAudioOut || isMyTapActive || (speakingStyle === "auto" && phase === "listening")}
          accent={accent}
          compact
        />
      </div>

      {/* Live Transcript Scroll Area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex flex-col flex-1 overflow-y-auto py-2 space-y-2 overscroll-contain"
      >
        {renderedTurns.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center px-3">
            <div className="max-w-xs rounded-2xl border border-[#E2DFD6] bg-white/85 px-4 py-2.5 nova-soft-shadow">
              <p className="text-xs leading-relaxed text-[#565E58]">
                {speakingStyle === "tap" ? (
                  isArabicUi ? (
                    <>
                      اضغط زر الميكروفون أدناه وتحدث بـ{" "}
                      <span className="font-semibold text-[#242A26]">
                        {ownerDisplay}
                      </span>{" "}
                      ليخرج الصوت المترجم عبر مكبر الهاتف.
                    </>
                  ) : (
                    <>
                      Tap your mic button to speak{" "}
                      <span className="font-semibold text-[#242A26]">
                        {ownerDisplay}
                      </span>{" "}
                      — translation plays aloud from the phone speaker.
                    </>
                  )
                ) : isArabicUi ? (
                  <>
                    تحدّث بـ{" "}
                    <span className="font-semibold text-[#242A26]">
                      {ownerDisplay}
                    </span>{" "}
                    أو{" "}
                    <span className="font-semibold text-[#242A26]">
                      {otherDisplay}
                    </span>
                    . سيتوقف الميكروفون تلقائيًا أثناء نطق مكبر الصوت.
                  </>
                ) : (
                  <>
                    Speak{" "}
                    <span className="font-semibold text-[#242A26]">
                      {ownerDisplay}
                    </span>{" "}
                    or{" "}
                    <span className="font-semibold text-[#242A26]">
                      {otherDisplay}
                    </span>
                    . The mic automatically pauses while the speaker talks.
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
              const isReplaying =
                replayingTurnKey === `${perspective}-${turn.id}`;

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
                          {isArabicUi ? "يُترجم..." : "translating..."}
                        </span>
                      )}
                      {turn.isFinal && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const codeA = perspective === "A" ? ownerLang.code : otherLang.code;
                              const codeB = perspective === "A" ? otherLang.code : ownerLang.code;
                              toggleSavedPhrase({
                                sourceText: turn.sourceText,
                                translatedText: turn.translatedText,
                                sourceLang: turn.speaker === "A" ? codeA : codeB,
                                targetLang: turn.speaker === "A" ? codeB : codeA,
                                modeLabel: isArabicUi ? "مكبر الصوت" : "Mode C",
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
                                ? "إعادة تشغيل عبر مكبر الصوت"
                                : "Play again on phone speaker"
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
              onClick={() => {
                const el = scrollRef.current;
                if (!el) return;
                isNearBottomRef.current = true;
                el.scrollTop = el.scrollHeight;
                setShowJumpToLatest(false);
              }}
              className="pointer-events-auto min-h-[36px] rounded-full bg-[#214536] px-3.5 text-[11px] font-semibold text-white shadow-md transition hover:bg-[#315F4A]"
            >
              {isArabicUi ? "الأحدث ↓" : "Latest ↓"}
            </button>
          </div>
        )}
      </div>

      {/* Dual Tap-to-Speak >= 56px Action Button */}
      {speakingStyle === "tap" && (
        <div className="pt-1.5 shrink-0">
          <button
            type="button"
            disabled={tapButtonDisabled}
            onClick={() => onTapSpeak(perspective)}
            className={`flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl px-4 text-sm font-bold transition active:scale-[0.98] disabled:opacity-55 ${
              isMyTapActive
                ? "bg-[#214536] text-white ring-4 ring-[#4C8062]/30 shadow-[0_10px_22px_-6px_rgba(33,69,54,0.45)]"
                : accent === "forest"
                  ? "bg-[#315F4A] text-white shadow-[0_6px_16px_-4px_rgba(33,69,54,0.34)] hover:bg-[#214536]"
                  : "bg-[#A86D43] text-white shadow-[0_6px_16px_-4px_rgba(168,109,67,0.34)] hover:bg-[#8E5934]"
            }`}
          >
            <MicIcon
              className={`w-5 h-5 shrink-0 ${isMyTapActive ? "animate-pulse" : ""}`}
            />
            <span className="truncate">{getTapLabel()}</span>
          </button>
        </div>
      )}
    </section>
  );
}

export default function ModeCClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const langA = findLanguage(searchParams.get("langA") ?? "ar");
  const langB = findLanguage(searchParams.get("langB") ?? "en");

  const settings = useNovaSettings();
  const isRtl = settings.uiLocale === "ar";
  const isOnline = useIsOnline();
  const persistedTurns = usePersistedModeCTurns(langA.code, langB.code);

  const [speakingStyle, setSpeakingStyle] = useState<SpeakingStyle>("tap");
  const [status, setStatus] = useState<LiveConnectionStatus>("idle");
  const [speakerPhase, setSpeakerPhase] = useState<SpeakerPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerPlaying, setIsSpeakerPlaying] = useState(false);
  const [isCooldown, setIsCooldown] = useState(false);
  const [activeTapTurn, setActiveTapTurn] = useState<"A" | "B" | null>(null);
  const [sessionElapsedSec, setSessionElapsedSec] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [ephemeralTurns, setEphemeralTurns] = useState<LiveTranscriptTurn[]>(
    []
  );
  const [replayingTurnKey, setReplayingTurnKey] = useState<string | null>(null);

  const [micDevices, setMicDevices] = useState<ClassifiedMicDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
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
  const [copiedToast, setCopiedToast] = useState(false);

  const wakeLockActive = useWakeLock(isRunning && settings.wakeLockEnabled);

  const clientRef = useRef<GeminiLiveTranslatorClient | null>(null);
  const vadRef = useRef<VadManager | null>(null);
  const rafRef = useRef<number | null>(null);
  const speakingStyleRef = useRef<SpeakingStyle>(speakingStyle);
  const isRunningRef = useRef(false);
  const isStartingRef = useRef(false);
  const isMutedRef = useRef(false);
  const isSpeakerGatedRef = useRef(false);
  const activeTapTurnRef = useRef<"A" | "B" | null>(null);
  const pendingTapTurnRef = useRef<"A" | "B" | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsReplayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  const turns = settings.saveTranscripts ? persistedTurns : ephemeralTurns;
  const isSpeakerLocked = isSpeakerPlaying || isCooldown;

  useEffect(() => {
    speakingStyleRef.current = speakingStyle;
  }, [speakingStyle]);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    activeTapTurnRef.current = activeTapTurn;
  }, [activeTapTurn]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      setSessionElapsedSec((sec) => sec + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

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

  const setHardwareTrackEnabled = useCallback((enabled: boolean) => {
    const activeMic = getMicManager().getActiveMic();
    if (!activeMic) return;
    for (const track of activeMic.stream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }, []);

  const clearCooldownTimer = useCallback(() => {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
  }, []);

  /**
   * Strict Half-Duplex Anti-Echo Guard:
   * Immediately gates mic frames + pauses VAD whenever speaker audio plays.
   */
  const engageEchoGuard = useCallback(() => {
    clearCooldownTimer();
    isSpeakerGatedRef.current = true;
    vadRef.current?.setGated(true);
    setHardwareTrackEnabled(false);
    setInputLevel(0);
    if (activeTapTurnRef.current !== null) {
      activeTapTurnRef.current = null;
      setActiveTapTurn(null);
    }
    setSpeakerPhase("speaking");
  }, [clearCooldownTimer, setHardwareTrackEnabled]);

  const scheduleEchoGuardRelease = useCallback(() => {
    clearCooldownTimer();
    setIsCooldown(true);
    setSpeakerPhase("speaking");
    cooldownTimerRef.current = setTimeout(() => {
      cooldownTimerRef.current = null;
      if (getStereoEngine().isPlaybackActive()) {
        return;
      }
      isSpeakerGatedRef.current = false;
      setIsCooldown(false);

      if (!isRunningRef.current || isMutedRef.current) {
        setHardwareTrackEnabled(false);
        vadRef.current?.setGated(true);
        setSpeakerPhase(isRunningRef.current ? "idle" : "idle");
        return;
      }

      if (speakingStyleRef.current === "auto") {
        setHardwareTrackEnabled(true);
        vadRef.current?.setGated(false);
        setSpeakerPhase("listening");
      } else {
        // Dual Tap-to-Speak stays gated between manual speaker taps
        setHardwareTrackEnabled(false);
        vadRef.current?.setGated(true);
        setSpeakerPhase("idle");
      }
    }, ANTI_ECHO_COOLDOWN_MS);
  }, [clearCooldownTimer, setHardwareTrackEnabled]);

  // Monitor live speaker playback transitions from StereoEngine
  useEffect(() => {
    const engine = getStereoEngine();
    return engine.onPlaybackStateChange((playing) => {
      if (playing) {
        setIsSpeakerPlaying(true);
        setIsCooldown(false);
        engageEchoGuard();
      } else {
        setIsSpeakerPlaying(false);
        if (isRunningRef.current || isSpeakerGatedRef.current) {
          scheduleEchoGuardRelease();
        }
      }
    });
  }, [engageEchoGuard, scheduleEchoGuardRelease]);

  // Listen for mic hardware changes
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.addEventListener
    ) {
      return;
    }
    const handleDeviceChange = () => {
      void listMicDevices()
        .then((res) => setMicDevices(res.devices))
        .catch(() => {});
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange
      );
    };
  }, []);

  // Auto-resume AudioContext when returning to foreground
  useEffect(() => {
    if (!isRunning) return;
    return getStereoEngine().attachLifecycleRecovery((state) => {
      setAudioCtxState(state);
      if (state === "suspended") {
        setAudioDebugNotice(
          "Audio playback suspended by OS; tap Start or Mic to resume."
        );
      } else if (state === "running") {
        setAudioDebugNotice(null);
      }
    });
  }, [isRunning]);

  // Real-time output level meter while session runs
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
    async (preserveErrorStatus = false) => {
      clearCooldownTimer();
      if (ttsReplayIntervalRef.current) {
        clearInterval(ttsReplayIntervalRef.current);
        ttsReplayIntervalRef.current = null;
      }
      isSpeakerGatedRef.current = false;
      activeTapTurnRef.current = null;
      pendingTapTurnRef.current = null;
      setActiveTapTurn(null);
      setIsSpeakerPlaying(false);
      setIsCooldown(false);
      setIsMuted(false);

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
      setInputLevel(0);
      setOutputLevel(0);
      setSpeakerPhase("idle");
      if (!preserveErrorStatus) {
        setStatus("disconnected");
      }
      syncAudioDiagnostics();
    },
    [clearCooldownTimer, syncAudioDiagnostics]
  );

  useEffect(() => {
    return () => {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      if (ttsReplayIntervalRef.current) {
        clearInterval(ttsReplayIntervalRef.current);
      }
      void vadRef.current?.destroy();
      clientRef.current?.disconnect();
      getStereoEngine().stopAll();
    };
  }, []);

  const activateTapTurn = useCallback(
    (person: "A" | "B") => {
      if (isSpeakerGatedRef.current || getStereoEngine().isPlaybackActive()) {
        return;
      }
      getStereoEngine().unlockSync();
      clientRef.current?.setSpeakerOverride(person);
      setIsMuted(false);
      isMutedRef.current = false;
      activeTapTurnRef.current = person;
      setActiveTapTurn(person);
      setHardwareTrackEnabled(true);
      vadRef.current?.setGated(false);
      setSpeakerPhase("listening");
      syncAudioDiagnostics();
    },
    [setHardwareTrackEnabled, syncAudioDiagnostics]
  );

  const finishActiveTapTurn = useCallback(() => {
    if (activeTapTurnRef.current === null) return;
    activeTapTurnRef.current = null;
    setActiveTapTurn(null);
    setHardwareTrackEnabled(false);
    vadRef.current?.setGated(true);
    setInputLevel(0);
    setSpeakerPhase("translating");
    clientRef.current?.sendAudioStreamEnd();
  }, [setHardwareTrackEnabled]);

  const startSession = useCallback(
    async (
      unlockedCtx: AudioContext,
      explicitMicId?: string,
      initialTapPerson?: "A" | "B"
    ) => {
      if (isStartingRef.current || isRunningRef.current) return;
      isStartingRef.current = true;
      setIsStarting(true);
      pendingTapTurnRef.current = initialTapPerson ?? null;
      setErrorMessage(null);
      setAudioDebugNotice(null);
      setChunkCount(0);
      setSessionElapsedSec(0);
      setStatus("connecting");
      setSpeakerPhase("connecting");

      const engine = getStereoEngine();
      try {
        if (unlockedCtx.state === "suspended") {
          await unlockedCtx.resume();
        }
        syncAudioDiagnostics();

        const initialOverride = initialTapPerson
          ? initialTapPerson
          : speakingStyleRef.current === "auto"
            ? "auto"
            : "A";

        const client = new GeminiLiveTranslatorClient({
          langACode: langA.code,
          langALabel: langA.label,
          langBCode: langB.code,
          langBLabel: langB.label,
          voiceName: settings.voiceName,
          speakerOverride: initialOverride,
          swapChannels: false,
          callbacks: {
            onStatusChange: (nextStatus) => {
              setStatus(nextStatus);
              if (nextStatus === "error" && isRunningRef.current) {
                void stopSession(true);
              }
            },
            onTranscriptUpdate: (turn) => {
              if (
                turn.isFinal &&
                turn.hasAudio === false &&
                turn.translatedText
              ) {
                setAudioDebugNotice(
                  "Turn completed with text only (no speaker audio returned)."
                );
                if (!getStereoEngine().isPlaybackActive()) {
                  setSpeakerPhase(
                    speakingStyleRef.current === "auto" && !isMutedRef.current
                      ? "listening"
                      : "idle"
                  );
                }
              }
              if (settings.saveTranscripts) {
                upsertPersistedModeCTurn(langA.code, langB.code, turn);
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
            onAudioOutput: (pcm16, sampleRate, _channel, turnId) => {
              // Engage strict half-duplex gate BEFORE scheduling playback chunk
              engageEchoGuard();
              setChunkCount((n) => n + 1);
              if (turnId) {
                appendTurnAudioChunk(`modec:${turnId}`, pcm16, sampleRate);
              }
              try {
                // Force pan = 0.0 (center mono speaker output) in Mode C
                engine.enqueuePcm16(pcm16, "both", sampleRate);
              } catch (err) {
                const msg =
                  err instanceof Error ? err.message : "Audio playback failed";
                setAudioDebugNotice(`enqueuePcm16 error: ${msg}`);
              }
              syncAudioDiagnostics();
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
            "Microphone disconnected or preempted. Check your device and tap Start to resume."
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
            if (
              isSpeakerGatedRef.current ||
              (speakingStyleRef.current === "tap" &&
                activeTapTurnRef.current === null)
            ) {
              setInputLevel(0);
              return;
            }
            setInputLevel(level);
          },
          onSpeechStart: () => {
            if (
              speakingStyleRef.current === "auto" &&
              !isSpeakerGatedRef.current &&
              !isMutedRef.current
            ) {
              setSpeakerPhase("listening");
            }
          },
          onSpeechEnd: () => {
            if (
              speakingStyleRef.current === "auto" &&
              !isSpeakerGatedRef.current &&
              !isMutedRef.current
            ) {
              setSpeakerPhase("translating");
              client.sendAudioStreamEnd();
            }
          },
          onVADMisfire: () => {
            if (
              speakingStyleRef.current === "auto" &&
              !isSpeakerGatedRef.current
            ) {
              setSpeakerPhase("listening");
            }
          },
          onAudioFrame: (pcm16) => {
            if (
              speakingStyleRef.current === "auto" &&
              !isSpeakerGatedRef.current &&
              !isMutedRef.current
            ) {
              client.sendPcm16Frame(pcm16);
            }
          },
          onRawFrame: (pcm16) => {
            if (
              speakingStyleRef.current === "tap" &&
              activeTapTurnRef.current !== null &&
              !isSpeakerGatedRef.current
            ) {
              client.sendPcm16Frame(pcm16);
            }
          },
          onError: (msg) => {
            setErrorMessage(msg);
          },
        });

        vadRef.current = vad;

        await Promise.all([
          client.connect(),
          (async () => {
            const micInfo = await getMicManager().acquireMic(
              explicitMicId ?? (selectedMicId || undefined),
              {
                speakerAec: true,
                onTrackEnded: handleUnexpectedMicLoss,
              }
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
              speakerAec: true,
            });
          })(),
        ]);

        engine.unlockSync();
        syncAudioDiagnostics();
        isRunningRef.current = true;
        setIsRunning(true);
        setIsMuted(false);
        isMutedRef.current = false;

        const queuedPerson = pendingTapTurnRef.current;
        pendingTapTurnRef.current = null;
        if (queuedPerson && speakingStyleRef.current === "tap") {
          isSpeakerGatedRef.current = false;
          activateTapTurn(queuedPerson);
        } else if (speakingStyleRef.current === "auto") {
          isSpeakerGatedRef.current = false;
          setHardwareTrackEnabled(true);
          vad.setGated(false);
          client.setSpeakerOverride("auto");
          setSpeakerPhase("listening");
        } else {
          // Wait for explicit Tap-to-Speak press while keeping speaker AEC stream warm
          setHardwareTrackEnabled(false);
          vad.setGated(true);
          setSpeakerPhase("idle");
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to start speaker translation.";
        setErrorMessage(msg);
        await stopSession(true);
      } finally {
        isStartingRef.current = false;
        setIsStarting(false);
      }
    },
    [
      activateTapTurn,
      engageEchoGuard,
      langA.code,
      langA.label,
      langB.code,
      langB.label,
      refreshMics,
      selectedMicId,
      setHardwareTrackEnabled,
      settings.saveTranscripts,
      settings.vadSensitivity,
      settings.voiceName,
      stopSession,
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

  const handleTapSpeak = (person: "A" | "B") => {
    triggerHaptic(settings.hapticsEnabled, 12);
    const ctx = getStereoEngine().unlockSync();
    syncAudioDiagnostics();

    if (!isRunning) {
      if (isStartingRef.current) return;
      void startSession(ctx, undefined, person);
      return;
    }

    if (isSpeakerGatedRef.current || getStereoEngine().isPlaybackActive()) {
      return;
    }

    if (activeTapTurnRef.current === person) {
      finishActiveTapTurn();
    } else if (activeTapTurnRef.current === null) {
      activateTapTurn(person);
    }
  };

  const handleSetSpeakingStyle = (nextStyle: SpeakingStyle) => {
    triggerHaptic(settings.hapticsEnabled, 8);
    if (speakingStyle === nextStyle) return;
    setSpeakingStyle(nextStyle);
    speakingStyleRef.current = nextStyle;

    if (!isRunning) return;

    if (activeTapTurnRef.current !== null) {
      finishActiveTapTurn();
    }

    if (nextStyle === "auto") {
      clientRef.current?.setSpeakerOverride("auto");
      if (!isSpeakerGatedRef.current && !isMutedRef.current) {
        setHardwareTrackEnabled(true);
        vadRef.current?.setGated(false);
        setSpeakerPhase("listening");
      }
    } else {
      setHardwareTrackEnabled(false);
      vadRef.current?.setGated(true);
      setInputLevel(0);
      if (!isSpeakerGatedRef.current) {
        setSpeakerPhase("idle");
      }
    }
  };

  const handleToggleMute = () => {
    triggerHaptic(settings.hapticsEnabled, 10);
    getStereoEngine().unlockSync();
    syncAudioDiagnostics();
    if (!isRunning || speakingStyle !== "auto") return;

    if (isMuted) {
      setIsMuted(false);
      isMutedRef.current = false;
      if (!isSpeakerGatedRef.current) {
        setHardwareTrackEnabled(true);
        vadRef.current?.setGated(false);
        setSpeakerPhase("listening");
      }
    } else {
      setIsMuted(true);
      isMutedRef.current = true;
      setHardwareTrackEnabled(false);
      vadRef.current?.setGated(true);
      setInputLevel(0);
      clientRef.current?.sendAudioStreamEnd();
      if (!isSpeakerGatedRef.current) {
        setSpeakerPhase("idle");
      }
    }
  };

  const handleSelectMic = async (deviceId: string) => {
    const engine = getStereoEngine();
    const ctx = engine.unlockSync();
    syncAudioDiagnostics();

    setSelectedMicId(deviceId);
    if (vadRef.current && isRunning) {
      await vadRef.current.pause();
      const micInfo = await getMicManager().acquireMic(deviceId || undefined, {
        speakerAec: true,
        onTrackEnded: () => {
          setErrorMessage(
            "Microphone disconnected or preempted. Tap Start to reconnect."
          );
          void stopSession(true);
        },
      });
      setActiveMicLabel(micInfo.label);
      setSelectedMicId(micInfo.deviceId);
      setIsBluetoothMicRisk(micInfo.isBluetoothRisk);
      vadRef.current.setPreferredDeviceId(micInfo.deviceId || undefined);
      await vadRef.current.start({
        stream: micInfo.stream,
        preferredDeviceId: micInfo.deviceId || undefined,
        audioContext: ctx,
        sensitivity: settings.vadSensitivity,
        speakerAec: true,
      });

      const shouldOpenMic =
        !isSpeakerGatedRef.current &&
        !isMutedRef.current &&
        (speakingStyleRef.current === "auto" || activeTapTurnRef.current !== null);
      setHardwareTrackEnabled(shouldOpenMic);
      vadRef.current.setGated(!shouldOpenMic);
      engine.unlockSync();
      syncAudioDiagnostics();
    }
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
      `/mode-c?langA=${encodeURIComponent(resolvedA)}&langB=${encodeURIComponent(resolvedB)}`
    );
  };

  const handleCopyTranscript = async (): Promise<boolean> => {
    if (turns.length === 0) return false;
    const formatted = formatTranscriptForExport(
      turns.map((t) => ({
        speakerLabel:
          t.speaker === "A"
            ? `Person A (${langA.label} → ${langB.label})`
            : `Person B (${langB.label} → ${langA.label})`,
        sourceText: t.sourceText,
        translatedText: t.translatedText,
      }))
    );
    if (!formatted) return false;
    try {
      await navigator.clipboard.writeText(formatted);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 1600);
      return true;
    } catch {
      return false;
    }
  };

  const handleClearTurns = () => {
    triggerHaptic(settings.hapticsEnabled, 10);
    clearTurnAudioCache("modec:");
    clearPersistedModeCTurns(langA.code, langB.code);
    setEphemeralTurns([]);
  };

  const handleReplayTurn = (
    turn: LiveTranscriptTurn,
    perspective: "A" | "B"
  ) => {
    triggerHaptic(settings.hapticsEnabled, 8);
    const isIncomingTranslation = turn.speaker !== perspective;
    const ownerLang = perspective === "A" ? langA : langB;
    const textToSpeak = isIncomingTranslation
      ? turn.translatedText || turn.sourceText
      : turn.sourceText || turn.translatedText;

    const replayId = isIncomingTranslation
      ? `modec:${turn.id}`
      : `tts:${turn.id}:${perspective}`;

    if (isRunningRef.current) {
      engageEchoGuard();
    }

    const modeUsed = replayTurnAudio({
      turnId: replayId,
      text: textToSpeak,
      langCode: ownerLang.code,
      channel: "both",
    });

    if (
      modeUsed === "tts" &&
      isRunningRef.current &&
      typeof window !== "undefined" &&
      "speechSynthesis" in window
    ) {
      if (ttsReplayIntervalRef.current) {
        clearInterval(ttsReplayIntervalRef.current);
      }
      ttsReplayIntervalRef.current = setInterval(() => {
        if (!window.speechSynthesis.speaking) {
          if (ttsReplayIntervalRef.current) {
            clearInterval(ttsReplayIntervalRef.current);
            ttsReplayIntervalRef.current = null;
          }
          scheduleEchoGuardRelease();
        }
      }, 120);
    } else if (modeUsed === "unavailable" && isRunningRef.current) {
      scheduleEchoGuardRelease();
    }

    const indicatorKey = `${perspective}-${turn.id}`;
    setReplayingTurnKey(indicatorKey);
    if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    replayTimerRef.current = setTimeout(() => {
      setReplayingTurnKey(null);
    }, 1400);
  };

  const codeA = langA.code.toUpperCase();
  const codeB = langB.code.toUpperCase();

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#F5F3ED] text-[#242A26]"
    >
      {/* Top Half: Rotated 180deg for Person B sitting opposite */}
      <SpeakerPane
        perspective="B"
        ownerLang={langB}
        otherLang={langA}
        accent="sand"
        rotated
        turns={turns}
        speakingStyle={speakingStyle}
        isRunning={isRunning}
        isStarting={isStarting}
        isSpeakerLocked={isSpeakerLocked}
        activeTapTurn={activeTapTurn}
        phase={speakerPhase}
        inputLevel={inputLevel}
        outputLevel={outputLevel}
        isArabicUi={isRtl}
        replayingTurnKey={replayingTurnKey}
        onTapSpeak={handleTapSpeak}
        onReplayTurn={handleReplayTurn}
      />

      {/* Upright Center Control Bar (NEVER rotated) */}
      <div className="z-20 border-y border-[#E2DFD6] bg-white px-3 py-2 shadow-[0_4px_20px_-6px_rgba(33,69,54,0.14)] space-y-2">
        {/* Top Utility Row */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <Link
              href="/"
              aria-label={isRtl ? "العودة للرئيسية" : "Back to Home"}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-3 text-xs font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]/60"
            >
              <ArrowLeftIcon
                className={`w-3.5 h-3.5 ${isRtl ? "rotate-180" : ""}`}
              />
              <span className="hidden min-[360px]:inline">
                {isRtl ? "الرئيسية" : "Home"}
              </span>
            </Link>

            <SpeakerStatePill
              status={status}
              phase={speakerPhase}
              activeTurnOwner={activeTapTurn}
              isMuted={isMuted}
              isCooldown={isCooldown}
              isArabicUi={isRtl}
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
            <button
              type="button"
              dir="ltr"
              onClick={() => setLanguageModalOpen(true)}
              aria-label={isRtl ? "تغيير اللغتين" : "Change languages"}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 text-[11px] font-semibold text-[#315F4A] transition hover:bg-[#DCE8DD]"
            >
              {codeA} ↔ {codeB}
            </button>

            {turns.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setSummaryOpen(true)}
                  aria-label={isRtl ? "تلخيص المحادثة" : "Summarize conversation"}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-[#A8BDA9] bg-[#DCE8DD]/70 px-2.5 text-[11px] font-semibold text-[#214536] transition hover:bg-[#DCE8DD]"
                >
                  <SparklesIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {isRtl ? "ملخص" : "Summarize"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyTranscript()}
                  aria-label={isRtl ? "نسخ المحادثة" : "Copy transcript"}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 text-[11px] font-semibold text-[#315F4A] transition hover:bg-[#DCE8DD]"
                >
                  <CopyIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {copiedToast ? "✓" : isRtl ? "نسخ" : "Copy"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleClearTurns}
                  aria-label={isRtl ? "مسح السجل" : "Clear transcript"}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#565E58] transition hover:bg-[#C76A67]/15 hover:text-[#9B3B38]"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={isRtl ? "الإعدادات" : "Open settings"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] transition hover:bg-[#DCE8DD]"
            >
              <SettingsGearIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mode C Speaking Style + Session Actions Row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Dual Tap-to-Speak (default) vs Auto-Listen Toggle */}
          <div
            className="inline-flex min-h-[44px] items-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] p-0.5"
            role="group"
            aria-label={isRtl ? "أسلوب التحدث" : "Speaking style"}
          >
            <button
              type="button"
              onClick={() => handleSetSpeakingStyle("tap")}
              className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-[11px] font-semibold transition ${
                speakingStyle === "tap"
                  ? "bg-[#214536] text-white"
                  : "text-[#565E58] hover:text-[#242A26]"
              }`}
            >
              {isRtl ? "اضغط للتحدث" : "Tap-to-Speak"}
            </button>
            <button
              type="button"
              onClick={() => handleSetSpeakingStyle("auto")}
              className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-[11px] font-semibold transition ${
                speakingStyle === "auto"
                  ? "bg-[#214536] text-white"
                  : "text-[#565E58] hover:text-[#242A26]"
              }`}
            >
              {isRtl ? "استماع تلقائي" : "Auto-Listen"}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-1 justify-end min-w-[160px]">
            {isRunning && speakingStyle === "auto" && (
              <button
                type="button"
                onClick={handleToggleMute}
                className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition active:scale-[0.98] ${
                  isMuted
                    ? "border border-[#A87131]/40 bg-[#E8D8BF] text-[#242A26]"
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
                    ? isRtl
                      ? "استئناف"
                      : "Resume"
                    : isRtl
                      ? "كتم"
                      : "Mute"}
                </span>
              </button>
            )}

            <button
              type="button"
              disabled={isStarting}
              onClick={handleStartStop}
              className={`min-h-[44px] flex-1 sm:flex-initial min-w-[130px] rounded-full px-4 text-xs sm:text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60 ${
                isRunning
                  ? "border border-[#B54F4C]/40 bg-[#C76A67]/12 text-[#9B3B38] hover:bg-[#C76A67]/20"
                  : "bg-[#315F4A] text-white shadow-[0_6px_16px_-4px_rgba(33,69,54,0.38)] hover:bg-[#214536]"
              }`}
            >
              {isRunning
                ? isRtl
                  ? "إنهاء المحادثة"
                  : "End Conversation"
                : isStarting
                  ? isRtl
                    ? "جاري التشغيل..."
                    : "Starting..."
                  : isRtl
                    ? "ابدأ عبر مكبر الصوت"
                    : "Start Speaker Mode"}
            </button>
          </div>
        </div>

        <RecoveryBanner
          isOnline={isOnline}
          errorMessage={errorMessage}
          onRetry={!isRunning ? handleStartStop : undefined}
          onDismiss={() => setErrorMessage(null)}
          isArabicUi={isRtl}
          compact
        />
      </div>

      {/* Bottom Half: Upright for Person A */}
      <SpeakerPane
        perspective="A"
        ownerLang={langA}
        otherLang={langB}
        accent="forest"
        turns={turns}
        speakingStyle={speakingStyle}
        isRunning={isRunning}
        isStarting={isStarting}
        isSpeakerLocked={isSpeakerLocked}
        activeTapTurn={activeTapTurn}
        phase={speakerPhase}
        inputLevel={inputLevel}
        outputLevel={outputLevel}
        isArabicUi={isRtl}
        replayingTurnKey={replayingTurnKey}
        onTapSpeak={handleTapSpeak}
        onReplayTurn={handleReplayTurn}
      />

      {/* Upright Drawers & Modals (NEVER rotated) */}
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
        chunkCount={chunkCount}
        audioDebugNotice={audioDebugNotice}
        wakeLockActive={wakeLockActive}
        hideEarbudControls
        transcriptCount={turns.length}
        onExportTranscript={handleCopyTranscript}
        onClearTranscripts={handleClearTurns}
      />

      <MoreLanguagesModal
        isOpen={languageModalOpen}
        onClose={() => setLanguageModalOpen(false)}
        langA={langA.code}
        langB={langB.code}
        onChangePair={(nextA, nextB) => void handleChangeLanguagePair(nextA, nextB)}
        uiLocale={settings.uiLocale}
      />

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
        isArabicUi={isRtl}
      />
    </div>
  );
}
