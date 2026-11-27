"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import LanguageFlag from "@/components/nova/LanguageFlag";
import {
  ArrowLeftIcon,
  CloseIcon,
  ExpandScreenIcon,
  OfflineCheckIcon,
  SearchIcon,
  SpeakerPlayIcon,
  StarIcon,
} from "@/components/nova/NovaIcons";
import { replayTurnAudio } from "@/lib/audio/replayHelper";
import { LANGUAGE_ARABIC_NAMES } from "@/lib/i18n";
import { findLanguage, SUPPORTED_LANGUAGES } from "@/lib/languages";
import { triggerHaptic, useNovaSettings } from "@/lib/settingsStore";
import {
  TRAVEL_CATEGORIES,
  TRAVEL_PHRASES,
  type TravelCategoryId,
  type TravelPhraseItem,
} from "@/lib/travelPhrases";

interface QuickPhrasesViewProps {
  onCloseModal?: () => void;
}

const PINNED_STORAGE_KEY = "nova_pinned_travel_phrases_v1";
const EMPTY_PINS: string[] = [];
const pinListeners = new Set<() => void>();
let cachedPinsRaw: string | null = null;
let cachedPinsList: string[] = EMPTY_PINS;

function notifyPinListeners() {
  for (const l of pinListeners) l();
}

function subscribePins(cb: () => void): () => void {
  pinListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === PINNED_STORAGE_KEY) cb();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    pinListeners.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function readPinnedIds(): string[] {
  if (typeof window === "undefined") return EMPTY_PINS;
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (raw === cachedPinsRaw) return cachedPinsList;
    cachedPinsRaw = raw;
    if (!raw) {
      cachedPinsList = EMPTY_PINS;
      return cachedPinsList;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cachedPinsList = EMPTY_PINS;
      return cachedPinsList;
    }
    cachedPinsList = parsed.filter((x): x is string => typeof x === "string");
    return cachedPinsList;
  } catch {
    return EMPTY_PINS;
  }
}

function togglePinnedPhraseId(id: string): void {
  if (typeof window === "undefined") return;
  const current = readPinnedIds();
  const next = current.includes(id)
    ? current.filter((item) => item !== id)
    : [id, ...current];
  try {
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(PINNED_STORAGE_KEY, serialized);
    cachedPinsRaw = serialized;
    cachedPinsList = next;
  } catch {
    // Ignore storage quota errors cleanly
  }
  notifyPinListeners();
}

export default function QuickPhrasesView({
  onCloseModal,
}: QuickPhrasesViewProps) {
  const settings = useNovaSettings();
  const isRtl = settings.uiLocale === "ar";
  const pinnedIds = useSyncExternalStore(
    subscribePins,
    readPinnedIds,
    () => EMPTY_PINS
  );
  const pinnedSet = new Set(pinnedIds);

  const [category, setCategory] = useState<TravelCategoryId | "pinned">(
    "airport"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [targetLang, setTargetLang] = useState(
    settings.preferredLangB && settings.preferredLangB !== "ar"
      ? settings.preferredLangB
      : "en"
  );
  const [fullscreenPhrase, setFullscreenPhrase] = useState<{
    source: string;
    target: string;
    langCode: string;
  } | null>(null);

  const targetEntry = findLanguage(targetLang);
  const nativeLang = isRtl ? "ar" : "en";
  const normalizedSearch = searchQuery.trim().toLowerCase();

  // Filter strictly client-side (100% Offline Ready, zero API calls)
  const matchingPhrases = TRAVEL_PHRASES.filter((item) => {
    if (normalizedSearch.length > 0) {
      const targetStr = (item.text[targetEntry.code] ?? "").toLowerCase();
      const sourceStr = (item.text[nativeLang] ?? "").toLowerCase();
      const enStr = (item.text.en ?? "").toLowerCase();
      return (
        targetStr.includes(normalizedSearch) ||
        sourceStr.includes(normalizedSearch) ||
        enStr.includes(normalizedSearch)
      );
    }
    if (category === "pinned") {
      return pinnedSet.has(item.id);
    }
    return item.category === category;
  });

  // Float pinned phrases cleanly to the top in every view
  const sortedPhrases = [...matchingPhrases].sort((a, b) => {
    const aPinned = pinnedSet.has(a.id) ? 0 : 1;
    const bPinned = pinnedSet.has(b.id) ? 0 : 1;
    return aPinned - bPinned;
  });

  const getPhraseTargetText = (item: TravelPhraseItem): string =>
    item.text[targetEntry.code] ?? item.text.en;

  const getPhraseSourceText = (item: TravelPhraseItem): string =>
    item.text[nativeLang] ?? item.text.en;

  const handleSpeak = (item: TravelPhraseItem) => {
    triggerHaptic(settings.hapticsEnabled, 8);
    const text = getPhraseTargetText(item);
    replayTurnAudio({
      turnId: `phrase-${item.id}-${targetEntry.code}`,
      text,
      langCode: targetEntry.code,
      channel: "both",
    });
  };

  const handleShowLarge = (item: TravelPhraseItem) => {
    triggerHaptic(settings.hapticsEnabled, 8);
    setFullscreenPhrase({
      source: getPhraseSourceText(item),
      target: getPhraseTargetText(item),
      langCode: targetEntry.code,
    });
  };

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="flex flex-col h-full bg-[#F5F3ED] text-[#242A26]"
    >
      <div className="mx-auto w-full max-w-2xl px-4 py-4 space-y-3.5">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-2">
          {onCloseModal ? (
            <button
              type="button"
              onClick={onCloseModal}
              aria-label={isRtl ? "إغلاق" : "Close"}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-white px-3.5 text-xs font-semibold text-[#242A26] nova-soft-shadow hover:bg-[#DCE8DD]/60"
            >
              <CloseIcon className="w-4 h-4" />
              <span>{isRtl ? "إغلاق" : "Close"}</span>
            </button>
          ) : (
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-white px-3.5 text-xs font-semibold text-[#242A26] nova-soft-shadow hover:bg-[#DCE8DD]/60"
            >
              <ArrowLeftIcon
                className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`}
              />
              <span>{isRtl ? "الرئيسية" : "Home"}</span>
            </Link>
          )}

          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border border-[#A8BDA9] bg-[#DCE8DD] px-2.5 text-[11px] font-bold text-[#214536]">
              <OfflineCheckIcon className="w-3.5 h-3.5" />
              <span>{isRtl ? "بدون إنترنت" : "Offline Ready"}</span>
            </span>

            <div className="flex items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-white px-2.5 py-0.5 nova-soft-shadow min-w-0">
              <LanguageFlag code={targetEntry.code} size={18} />
              <select
                aria-label={
                  isRtl ? "لغة العرض والنطق" : "Phrase target language"
                }
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="min-h-[40px] max-w-[130px] bg-transparent text-xs font-bold text-[#214536] outline-none"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {isRtl
                      ? `${LANGUAGE_ARABIC_NAMES[l.code] ?? l.label}`
                      : l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>

        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold text-[#242A26]">
              {isRtl ? "دليل عبارات السفر" : "Travel Phrasebook"}
            </h1>
            <span className="text-[11px] font-semibold text-[#565E58]">
              {TRAVEL_PHRASES.length}{" "}
              {isRtl ? "عبارة في 7 فئات" : "phrases · 7 categories"}
            </span>
          </div>
          <p className="text-xs text-[#565E58]">
            {isRtl
              ? "يعمل 100% دون اتصال. انطق العبارة أو كبّرها على الشاشة للسائق أو الموظف."
              : "100% offline. Search, pin favorites, speak aloud, or show full-screen text."}
          </p>
        </div>

        {/* Instant Search Bar */}
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 start-3.5 -translate-y-1/2 w-4 h-4 text-[#565E58]" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              isRtl
                ? "ابحث في كل العبارات (مطار، تاكسي، حلال، باسبور...)"
                : "Search all phrases (taxi, halal, passport, Wi-Fi...)"
            }
            aria-label={isRtl ? "البحث في عبارات السفر" : "Search travel phrases"}
            className="min-h-[46px] w-full rounded-2xl border border-[#E2DFD6] bg-white ps-10 pe-10 text-sm text-[#242A26] placeholder:text-[#777F79] outline-none nova-soft-shadow transition focus:border-[#315F4A]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label={isRtl ? "مسح البحث" : "Clear search"}
              className="absolute top-1/2 end-1.5 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full text-[#565E58] hover:bg-[#F5F3ED]"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Pills (hidden only while actively typing search, or shown dimmed for fast switch) */}
        {!normalizedSearch && (
          <div className="flex flex-wrap gap-2">
            {pinnedIds.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(settings.hapticsEnabled, 6);
                  setCategory("pinned");
                }}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition active:scale-[0.97] ${
                  category === "pinned"
                    ? "bg-[#A86D43] text-white nova-soft-shadow"
                    : "border border-[#C58B62]/50 bg-[#E8D8BF]/65 text-[#242A26]"
                }`}
              >
                <StarIcon className="w-3.5 h-3.5" filled />
                <span>
                  {isRtl
                    ? `المثبتة (${pinnedIds.length})`
                    : `Pinned (${pinnedIds.length})`}
                </span>
              </button>
            )}

            {TRAVEL_CATEGORIES.map((cat) => {
              const active = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    triggerHaptic(settings.hapticsEnabled, 6);
                    setCategory(cat.id);
                  }}
                  className={`min-h-[44px] rounded-full px-3.5 text-xs font-semibold transition active:scale-[0.97] ${
                    active
                      ? "bg-[#214536] text-white nova-soft-shadow"
                      : "border border-[#E2DFD6] bg-white text-[#242A26] hover:border-[#A8BDA9]"
                  }`}
                >
                  {isRtl ? cat.ar : cat.en}
                </button>
              );
            })}
          </div>
        )}

        {/* Phrase Cards */}
        <div className="space-y-2.5 pb-6">
          {sortedPhrases.length === 0 ? (
            <div className="rounded-[22px] border border-[#E2DFD6] bg-white p-6 text-center space-y-2 nova-soft-shadow">
              <p className="text-sm font-semibold text-[#242A26]">
                {normalizedSearch
                  ? isRtl
                    ? "لا توجد عبارة مطابقة لبحثك."
                    : "No matching phrases found."
                  : isRtl
                    ? "لا توجد عبارات مثبتة بعد."
                    : "No pinned phrases yet."}
              </p>
              <p className="text-xs text-[#565E58]">
                {normalizedSearch
                  ? isRtl
                    ? "جرّب كلمة أخرى مثل فندق أو تاكسي أو حلال."
                    : "Try another keyword like hotel, taxi, halal, or pharmacy."
                  : isRtl
                    ? "اضغط على أيقونة النجمة بجانب أي عبارة لتثبيتها هنا."
                    : "Tap the star button on any phrase to pin it here for quick access."}
              </p>
            </div>
          ) : (
            sortedPhrases.map((item) => {
              const targetText = getPhraseTargetText(item);
              const sourceText = getPhraseSourceText(item);
              const isPinned = pinnedSet.has(item.id);
              const catMeta = TRAVEL_CATEGORIES.find(
                (c) => c.id === item.category
              );

              return (
                <div
                  key={item.id}
                  className={`rounded-[22px] border bg-white p-4 space-y-2.5 nova-card-shadow transition ${
                    isPinned
                      ? "border-[#C58B62]/65 bg-[#FFFDF9]"
                      : "border-[#E2DFD6]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      {(isPinned || normalizedSearch) && catMeta && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isPinned && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#E8D8BF] px-2 py-0.5 text-[10px] font-bold text-[#A86D43]">
                              {isRtl ? "مثبتة" : "Pinned"}
                            </span>
                          )}
                          {normalizedSearch && (
                            <span className="inline-flex items-center rounded-full bg-[#F5F3ED] px-2 py-0.5 text-[10px] font-semibold text-[#565E58]">
                              {isRtl ? catMeta.ar : catMeta.en}
                            </span>
                          )}
                        </div>
                      )}
                      <p
                        dir={targetEntry.rtl ? "rtl" : "ltr"}
                        className="text-base font-bold leading-snug text-[#214536]"
                      >
                        {targetText}
                      </p>
                      {sourceText !== targetText && (
                        <p className="text-xs leading-relaxed text-[#565E58]">
                          {sourceText}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(settings.hapticsEnabled, 8);
                        togglePinnedPhraseId(item.id);
                      }}
                      aria-label={
                        isPinned
                          ? isRtl
                            ? "إزالة التثبيت"
                            : "Unpin phrase"
                          : isRtl
                            ? "تثبيت العبارة"
                            : "Pin phrase to top"
                      }
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition active:scale-95 ${
                        isPinned
                          ? "border-[#C58B62] bg-[#E8D8BF] text-[#A86D43]"
                          : "border-[#E2DFD6] bg-[#F5F3ED] text-[#565E58] hover:text-[#A86D43]"
                      }`}
                    >
                      <StarIcon className="w-4 h-4" filled={isPinned} />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => handleSpeak(item)}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full bg-[#315F4A] px-4 text-xs font-semibold text-white transition hover:bg-[#214536] active:scale-[0.98]"
                    >
                      <SpeakerPlayIcon className="w-4 h-4" />
                      <span>{isRtl ? "تشغيل الصوت" : "Speak"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleShowLarge(item)}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-4 text-xs font-semibold text-[#242A26] transition hover:bg-[#DCE8DD] active:scale-[0.98]"
                    >
                      <ExpandScreenIcon className="w-4 h-4 text-[#315F4A]" />
                      <span>{isRtl ? "عرض مكبّر" : "Show Big"}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* High-Contrast Full-Screen Show Card */}
      {fullscreenPhrase && (
        <div
          className="fixed inset-0 z-[60] flex flex-col justify-between bg-[#214536] p-6 text-white"
          role="dialog"
          aria-modal="true"
          aria-label={isRtl ? "بطاقة عرض مكبرة" : "Full screen phrase card"}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-xs font-semibold">
              <LanguageFlag code={fullscreenPhrase.langCode} size={18} />
              <span>{findLanguage(fullscreenPhrase.langCode).label}</span>
            </span>
            <button
              type="button"
              onClick={() => setFullscreenPhrase(null)}
              aria-label={isRtl ? "إغلاق العرض المكبر" : "Close full screen"}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#214536] shadow-lg transition hover:bg-[#DCE8DD]"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="my-auto rounded-[28px] border border-white/15 bg-[#14261E]/65 px-5 py-8 text-center space-y-5 shadow-2xl">
            <p
              dir={findLanguage(fullscreenPhrase.langCode).rtl ? "rtl" : "ltr"}
              className="text-3xl sm:text-5xl font-bold leading-snug text-white break-words"
            >
              {fullscreenPhrase.target}
            </p>
            {fullscreenPhrase.source !== fullscreenPhrase.target && (
              <p className="text-sm sm:text-lg font-medium text-[#DCE8DD]">
                {fullscreenPhrase.source}
              </p>
            )}
          </div>

          <div className="flex justify-center pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(settings.hapticsEnabled, 10);
                replayTurnAudio({
                  turnId: `fullphrase-${Date.now()}`,
                  text: fullscreenPhrase.target,
                  langCode: fullscreenPhrase.langCode,
                  channel: "both",
                });
              }}
              className="inline-flex min-h-[54px] min-w-[220px] items-center justify-center gap-2 rounded-full bg-[#E8D8BF] px-8 text-sm font-bold text-[#242A26] shadow-lg transition hover:bg-[#dfcba8] active:scale-[0.98]"
            >
              <SpeakerPlayIcon className="w-5 h-5" />
              <span>{isRtl ? "نطق العبارة الآن" : "Speak Out Loud"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
