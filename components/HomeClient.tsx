"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import AudioSettingsDrawer from "@/components/AudioSettingsDrawer";
import EarbudTestModal from "@/components/EarbudTestModal";
import LanguageFlag from "@/components/nova/LanguageFlag";
import MoreLanguagesModal from "@/components/nova/MoreLanguagesModal";
import QuickPhrasesView from "@/components/QuickPhrasesView";
import SavedPhrasesModal from "@/components/SavedPhrasesModal";
import {
  ArrowRightIcon,
  BoltIcon,
  BookOpenIcon,
  CameraIcon,
  ChevronDownIcon,
  GlobeLinesIcon,
  HeadphonesIcon,
  HeadphonesListenIcon,
  HeartOutlineIcon,
  HorizontalSwapIcon,
  MoreGridIcon,
  OfflineCheckIcon,
  SettingsGearIcon,
  ShieldCheckIcon,
  SpeakerPlayIcon,
  StarIcon,
  TwoPhonesBadgeIcon,
} from "@/components/nova/NovaIcons";
import {
  EarbudsIllustration,
  HeroGlobeIllustration,
  TwoPhonesIllustration,
} from "@/components/nova/NovaIllustrations";
import NovaLogo from "@/components/nova/NovaLogo";
import { useSavedPhrases } from "@/lib/favoritesStore";
import { getDictionary, LANGUAGE_ARABIC_NAMES } from "@/lib/i18n";
import { findLanguage, SUPPORTED_LANGUAGES } from "@/lib/languages";
import {
  triggerHaptic,
  updateNovaSettings,
  useNovaSettings,
} from "@/lib/settingsStore";
import { APP_VERSION } from "@/lib/version";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const subscribeNoop = () => () => {};

function subscribeStandalone(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia("(display-mode: standalone)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getStandaloneSnapshot() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as unknown as { standalone?: boolean }).standalone)
  );
}

function getIOSSnapshot() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream
  );
}

export default function HomeClient() {
  const settings = useNovaSettings();
  const dict = getDictionary(settings.uiLocale);
  const isRtl = settings.uiLocale === "ar";

  const langA = findLanguage(settings.preferredLangA || "ar").code;
  const langB = findLanguage(settings.preferredLangB || "en").code;
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPhrasesOpen, setIsPhrasesOpen] = useState(false);
  const [isSavedOpen, setIsSavedOpen] = useState(false);
  const savedPhrases = useSavedPhrases();
  const [pickerState, setPickerState] = useState<{
    open: boolean;
    side: "from" | "to";
  }>({ open: false, side: "from" });

  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const isStandalone = useSyncExternalStore(
    subscribeStandalone,
    getStandaloneSnapshot,
    () => false
  );
  const isIOS = useSyncExternalStore(
    subscribeNoop,
    getIOSSnapshot,
    () => false
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Non-fatal in restricted contexts
      });
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  const langAInfo = findLanguage(langA);
  const langBInfo = findLanguage(langB);

  const getLanguageDisplayName = (code: string, fallback: string) => {
    if (code === "ar") return "العربية";
    if (code === "ar-dz") {
      return settings.uiLocale === "ar"
        ? "الدارجة الجزائرية"
        : "Algerian Darija";
    }
    if (settings.uiLocale === "ar") {
      return LANGUAGE_ARABIC_NAMES[code] ?? fallback;
    }
    return fallback;
  };

  const setLanguagePair = (nextA: string, nextB: string) => {
    updateNovaSettings({
      preferredLangA: nextA,
      preferredLangB: nextB === nextA ? langA : nextB,
    });
  };

  const handleSwapLanguages = () => {
    triggerHaptic(settings.hapticsEnabled, 10);
    updateNovaSettings({
      preferredLangA: langB,
      preferredLangB: langA,
    });
  };

  const handlePreset = (a: string, b: string) => {
    triggerHaptic(settings.hapticsEnabled, 10);
    setLanguagePair(a, b);
  };

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") {
      setInstallPrompt(null);
    }
  };

  const isPresetActive = (a: string, b: string) =>
    (langA === a && langB === b) || (langA === b && langB === a);

  const presets = [
    {
      a: "ar",
      b: "en",
      label: dict.presets.arEn,
      type: "bolt" as const,
    },
    {
      a: "ar",
      b: "fr",
      label: dict.presets.arFr,
      type: "flag" as const,
    },
    {
      a: "ar",
      b: "tr",
      label: dict.presets.arTr,
      type: "flag" as const,
    },
  ];

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="relative min-h-dvh w-full overflow-x-hidden bg-[#F5F3ED] text-[#242A26]"
    >
      {/* Subtle organic Algerian sage & sand corner backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <svg
          className="absolute -top-6 -start-10 h-44 w-56 text-[#DCE8DD]/80"
          viewBox="0 0 240 180"
          fill="none"
        >
          <path
            d="M0 0H210C155 48 92 108 0 148V0Z"
            fill="currentColor"
          />
          <path
            d="M0 0H145C98 42 54 78 0 105V0Z"
            fill="#A8BDA9"
            fillOpacity="0.28"
          />
        </svg>
        <svg
          className="absolute -bottom-8 -start-8 h-40 w-56 text-[#DCE8DD]/75"
          viewBox="0 0 240 160"
          fill="none"
        >
          <path
            d="M0 160V40C84 62 152 104 220 160H0Z"
            fill="currentColor"
          />
        </svg>
        <svg
          className="absolute -bottom-8 -end-10 h-44 w-56 text-[#E8D8BF]/45"
          viewBox="0 0 240 160"
          fill="none"
        >
          <path
            d="M240 160V34C158 58 84 102 18 160H240Z"
            fill="currentColor"
          />
        </svg>
      </div>

      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[460px] md:max-w-3xl flex-col justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="space-y-4 md:space-y-6">
          {/* Header Bar */}
          <header className="flex items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <NovaLogo size={40} className="shrink-0" />
              <div className="min-w-0">
                <div className="text-[19px] sm:text-[20px] font-bold tracking-tight leading-none text-[#242A26]">
                  {dict.brandName}
                </div>
                <p className="mt-1 truncate text-[11px] font-semibold leading-tight text-[#315F4A]">
                  {isRtl
                    ? "NOVA — مترجم السفر الذكي"
                    : "NOVA — AI Travel Interpreter"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(settings.hapticsEnabled, 8);
                  updateNovaSettings({
                    uiLocale: settings.uiLocale === "ar" ? "en" : "ar",
                  });
                }}
                aria-label={dict.uiLanguageLabel}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-[#E2DFD6] bg-white px-3 text-xs font-semibold text-[#315F4A] nova-soft-shadow transition hover:bg-[#DCE8DD]/45 active:scale-95"
              >
                {settings.uiLocale === "ar" ? "EN" : "عربي"}
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic(settings.hapticsEnabled, 8);
                  setIsSettingsOpen(true);
                }}
                aria-label={dict.settingsTitle}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-white text-[#242A26] nova-soft-shadow transition hover:bg-[#DCE8DD]/45 active:scale-95"
              >
                <SettingsGearIcon className="w-5 h-5" />
              </button>
            </div>
          </header>

          {/* Compact Hero Section */}
          <section className="relative flex items-center justify-between gap-3 pt-1">
            <div className="min-w-0 flex-1 space-y-1.5">
              <h1 className="text-[26px] sm:text-[31px] md:text-[34px] font-bold leading-[1.1] tracking-tight text-[#242A26]">
                {dict.heroTitle}
              </h1>
              <p className="text-[13px] sm:text-sm font-medium leading-snug text-[#565E58]">
                {dict.heroSubtitle}
              </p>
            </div>
            <div className="shrink-0 -me-1">
              <HeroGlobeIllustration />
            </div>
          </section>

          {/* Language Selector + Presets Section */}
          <section className="space-y-2.5" aria-label={dict.moreLanguagesTitle}>
            <div className="rounded-[24px] border border-[#E2DFD6] bg-white p-2.5 sm:p-3.5 nova-card-shadow">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 sm:gap-2">
                {/* Speaker 1 / Your language */}
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(settings.hapticsEnabled, 8);
                    setPickerState({ open: true, side: "from" });
                  }}
                  aria-label={`${dict.fromLabel}: ${getLanguageDisplayName(langAInfo.code, langAInfo.label)}`}
                  className="flex min-h-[52px] items-center justify-between gap-1 rounded-2xl px-1.5 sm:px-2.5 py-1.5 text-start transition hover:bg-[#F5F3ED] active:scale-[0.99] min-w-0"
                >
                  <div className="min-w-0">
                    <span className="block text-[11px] font-medium text-[#565E58] leading-tight">
                      {dict.fromLabel}
                    </span>
                    <span className="mt-0.5 inline-flex items-center gap-0.5 sm:gap-1 text-[13px] min-[360px]:text-[14.5px] sm:text-[16px] font-semibold leading-tight text-[#242A26] max-w-full">
                      <span>
                        {getLanguageDisplayName(langAInfo.code, langAInfo.label)}
                      </span>
                      <ChevronDownIcon className="w-3.5 h-3.5 shrink-0 text-[#565E58]" />
                    </span>
                  </div>
                  <LanguageFlag code={langAInfo.code} size={20} className="sm:w-[22px] sm:h-[22px]" />
                </button>

                {/* Swap Button */}
                <button
                  type="button"
                  onClick={handleSwapLanguages}
                  aria-label={dict.swapLanguagesAria}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#DCE8DD] text-[#214536] transition hover:bg-[#A8BDA9]/55 active:scale-95"
                >
                  <HorizontalSwapIcon className="w-4 h-4" />
                </button>

                {/* Speaker 2 / Partner's language */}
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(settings.hapticsEnabled, 8);
                    setPickerState({ open: true, side: "to" });
                  }}
                  aria-label={`${dict.toLabel}: ${getLanguageDisplayName(langBInfo.code, langBInfo.label)}`}
                  className="flex min-h-[52px] items-center justify-between gap-1 rounded-2xl px-1.5 sm:px-2.5 py-1.5 text-start transition hover:bg-[#F5F3ED] active:scale-[0.99] min-w-0"
                >
                  <div className="min-w-0">
                    <span className="block text-[11px] font-medium text-[#565E58] leading-tight">
                      {dict.toLabel}
                    </span>
                    <span className="mt-0.5 inline-flex items-center gap-0.5 sm:gap-1 text-[13px] min-[360px]:text-[14.5px] sm:text-[16px] font-semibold leading-tight text-[#242A26] max-w-full">
                      <span>
                        {getLanguageDisplayName(langBInfo.code, langBInfo.label)}
                      </span>
                      <ChevronDownIcon className="w-3.5 h-3.5 shrink-0 text-[#565E58]" />
                    </span>
                  </div>
                  <LanguageFlag code={langBInfo.code} size={20} className="sm:w-[22px] sm:h-[22px]" />
                </button>
              </div>

              <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-[#E2DFD6]/80 pt-1 text-[11px] font-medium text-[#565E58]">
                <span>{dict.bidirectionalHint}</span>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(settings.hapticsEnabled, 8);
                    setPickerState({ open: true, side: "from" });
                  }}
                  className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-end px-2 -my-1.5 font-semibold text-[#315F4A] hover:underline"
                >
                  {SUPPORTED_LANGUAGES.length} {isRtl ? "لغة" : "languages"}
                </button>
              </div>
            </div>

            {/* Quick Presets Row (2x2 on mobile so no label truncates; 4 cols on sm+) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {presets.map((preset) => {
                const active = isPresetActive(preset.a, preset.b);
                return (
                  <button
                    key={`${preset.a}-${preset.b}`}
                    type="button"
                    onClick={() => handlePreset(preset.a, preset.b)}
                    className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold transition active:scale-[0.97] ${
                      active
                        ? "bg-[#214536] text-white nova-soft-shadow"
                        : "border border-[#E2DFD6] bg-white text-[#242A26] nova-soft-shadow hover:border-[#A8BDA9]"
                    }`}
                  >
                    {preset.type === "bolt" ? (
                      <BoltIcon
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? "text-[#DCE8DD]" : "text-[#315F4A]"
                        }`}
                      />
                    ) : (
                      <LanguageFlag code={preset.b} size={15} />
                    )}
                    <span className="truncate">{preset.label}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  triggerHaptic(settings.hapticsEnabled, 8);
                  setPickerState({ open: true, side: "from" });
                }}
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-[#E2DFD6] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#242A26] nova-soft-shadow transition hover:border-[#A8BDA9] active:scale-[0.97]"
              >
                <MoreGridIcon className="w-3.5 h-3.5 shrink-0 text-[#315F4A]" />
                <span className="truncate">{dict.moreLanguages}</span>
              </button>
            </div>
          </section>

          {/* Travel Quick-Start Hero: Two Fastest On-The-Go Actions Side-by-Side */}
          <section
            aria-label={isRtl ? "انطلاق السفر السريع" : "Travel quick-start"}
            className="space-y-2.5"
          >
            <div className="flex items-center justify-between px-1">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#315F4A]">
                {isRtl ? "انطلاق فوري أثناء السفر" : "Quick-Start on the Go"}
              </h2>
              <span className="text-[11px] font-medium text-[#565E58]">
                {isRtl ? "بلمسة واحدة" : "Instant travel access"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              {/* Quick-Start 1: Phone Speaker (Mode C) */}
              <Link
                href={`/mode-c?langA=${encodeURIComponent(langA)}&langB=${encodeURIComponent(langB)}`}
                onClick={() => triggerHaptic(settings.hapticsEnabled, 12)}
                className="group relative flex flex-col justify-between overflow-hidden rounded-[24px] border border-[#315F4A] bg-[#214536] p-3.5 sm:p-4 text-white shadow-[0_10px_24px_-8px_rgba(33,69,54,0.45)] transition hover:bg-[#1b3a2d] active:scale-[0.985] min-w-0"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-[#DCE8DD]">
                    <SpeakerPlayIcon className="w-5 h-5" />
                  </span>
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#DCE8DD]">
                    {dict.modeCBadge}
                  </span>
                </div>

                <div className="mt-3 space-y-1 min-w-0">
                  <h3 className="text-[15px] sm:text-[17px] font-bold leading-tight text-white">
                    {dict.modeCTitle}
                  </h3>
                  <p className="text-[11px] font-medium leading-snug text-[#DCE8DD]">
                    {dict.modeCSubtitle}
                  </p>
                </div>

                <div className="mt-3.5 flex min-h-[44px] items-center justify-between gap-1.5 rounded-full bg-white ps-3 pe-1.5 py-1 text-[11.5px] sm:text-xs font-bold text-[#214536]">
                  <span className="truncate">
                    {isRtl ? "ابدأ الصوت" : "Speak Now"}
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#DCE8DD] text-[#214536]">
                    <ArrowRightIcon
                      className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`}
                    />
                  </span>
                </div>
              </Link>

              {/* Quick-Start 2: Camera Translate (Menus & Signs) */}
              <Link
                href={`/camera?target=${encodeURIComponent(langA)}`}
                onClick={() => triggerHaptic(settings.hapticsEnabled, 12)}
                className="group relative flex flex-col justify-between overflow-hidden rounded-[24px] border border-[#E2DFD6] bg-white p-3.5 sm:p-4 text-[#242A26] nova-card-shadow transition hover:border-[#A8BDA9] active:scale-[0.985] min-w-0"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#E8D8BF]/85 text-[#A86D43]">
                    <CameraIcon className="w-5 h-5" />
                  </span>
                  <span className="rounded-full bg-[#DCE8DD] px-2 py-0.5 text-[10px] font-bold text-[#214536]">
                    {isRtl ? "كاميرا" : "Camera"}
                  </span>
                </div>

                <div className="mt-3 space-y-1 min-w-0">
                  <h3 className="text-[15px] sm:text-[17px] font-bold leading-tight text-[#242A26]">
                    {isRtl ? "ترجمة بالكاميرا" : "Camera Translate"}
                  </h3>
                  <p className="text-[11px] font-medium leading-snug text-[#565E58]">
                    {isRtl ? "قوائم الطعام واللافتات" : "Menus, signs & bills"}
                  </p>
                </div>

                <div className="mt-3.5 flex min-h-[44px] items-center justify-between gap-1.5 rounded-full bg-[#F5F3ED] border border-[#E2DFD6] ps-3 pe-1.5 py-1 text-[11.5px] sm:text-xs font-bold text-[#214536]">
                  <span className="truncate">
                    {isRtl ? "صوّر وترجم" : "Scan Photo"}
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#315F4A] text-white">
                    <ArrowRightIcon
                      className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`}
                    />
                  </span>
                </div>
              </Link>
            </div>
          </section>

          {/* Prominent Offline Travel Phrases Card */}
          <section aria-label={isRtl ? "دليل عبارات السفر" : "Offline travel phrases"}>
            <div className="relative overflow-hidden rounded-[26px] border border-[#E2DFD6] bg-white p-3.5 sm:p-4 nova-card-shadow">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 end-0 w-[40%] bg-gradient-to-l rtl:bg-gradient-to-r from-[#E8D8BF]/40 to-transparent"
              />
              <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(settings.hapticsEnabled, 10);
                    setIsPhrasesOpen(true);
                  }}
                  className="flex flex-1 min-h-[44px] items-center gap-3 min-w-0 text-start transition active:scale-[0.99]"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#E8D8BF]/85 text-[#A86D43]">
                    <BookOpenIcon className="w-6 h-6" />
                  </span>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[15px] sm:text-base font-bold text-[#242A26]">
                        {isRtl ? "دليل عبارات السفر" : "Offline Travel Phrases"}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#A8BDA9] bg-[#DCE8DD] px-2 py-0.5 text-[10px] font-bold text-[#214536]">
                        <OfflineCheckIcon className="w-3 h-3" />
                        <span>{isRtl ? "يعمل بدون إنترنت" : "Offline Ready"}</span>
                      </span>
                    </div>
                    <p className="text-xs font-medium text-[#565E58]">
                      {isRtl
                        ? "7 فئات: المطار، الفندق، التاكسي، الطعام، الصرافة والطوارئ"
                        : "49 phrases across Airport, Hotel, Taxi, Dining, SIM & Emergency"}
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(settings.hapticsEnabled, 10);
                      setIsPhrasesOpen(true);
                    }}
                    className="inline-flex min-h-[44px] flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-full bg-[#315F4A] px-4 text-xs font-semibold text-white transition hover:bg-[#214536] active:scale-[0.98]"
                  >
                    <span>{isRtl ? "فتح الدليل" : "Browse"}</span>
                  </button>
                  <Link
                    href="/phrases"
                    aria-label={isRtl ? "فتح صفحة العبارات الكاملة" : "Open full phrases page"}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#315F4A] transition hover:bg-[#DCE8DD]"
                  >
                    <ArrowRightIcon
                      className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`}
                    />
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* Core Conversation & Listening Modes */}
          <section
            className="space-y-2.5"
            aria-label={isRtl ? "أوضاع المحادثة والاستماع" : "Conversation and listening modes"}
          >
            <div className="flex items-center justify-between px-1">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#565E58]">
                {isRtl ? "أوضاع المحادثة الحية" : "Conversation & Listening"}
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Mode A — One Phone / Shared Earbuds */}
              <div className="relative flex flex-col justify-between overflow-hidden rounded-[26px] border border-[#E2DFD6] bg-white p-3.5 sm:p-4 nova-card-shadow">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 start-0 w-[44%] bg-gradient-to-tr from-[#315F4A]/14 via-[#DCE8DD]/55 to-transparent"
                />
                <div className="relative grid grid-cols-[auto_1fr] items-center gap-2.5 sm:gap-3">
                  <div className="flex items-center justify-center scale-90 min-[360px]:scale-100 origin-center">
                    <EarbudsIllustration />
                  </div>

                  <div className="min-w-0 space-y-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#315F4A] px-2.5 py-1 text-[11px] font-semibold text-white">
                      <HeadphonesIcon className="w-3.5 h-3.5" />
                      <span>{dict.modeABadge}</span>
                    </span>

                    <div>
                      <h3 className="text-[17px] min-[360px]:text-[18px] font-bold leading-tight text-[#242A26]">
                        {dict.modeATitle}
                      </h3>
                      <p className="mt-0.5 text-xs font-medium leading-snug text-[#565E58]">
                        {dict.modeASubtitle}
                      </p>
                    </div>

                    <Link
                      href={`/mode-a?langA=${encodeURIComponent(langA)}&langB=${encodeURIComponent(langB)}`}
                      onClick={() => triggerHaptic(settings.hapticsEnabled, 12)}
                      className="inline-flex min-h-[44px] w-full items-center justify-between gap-1.5 rounded-full bg-[#315F4A] ps-3.5 pe-1.5 py-1.5 text-xs sm:text-[13px] font-semibold leading-tight text-white shadow-[0_6px_16px_-4px_rgba(33,69,54,0.34)] transition hover:bg-[#214536] active:scale-[0.98]"
                    >
                      <span>{dict.modeACta}</span>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#214536]">
                        <ArrowRightIcon
                          className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`}
                        />
                      </span>
                    </Link>
                  </div>
                </div>
              </div>

              {/* Mode B — Two-Phone Call */}
              <div className="relative flex flex-col justify-between overflow-hidden rounded-[26px] border border-[#E2DFD6] bg-white p-3.5 sm:p-4 nova-card-shadow">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 start-0 w-[44%] bg-gradient-to-tr from-[#E8D8BF]/70 via-[#E8D8BF]/30 to-transparent"
                />
                <div className="relative grid grid-cols-[auto_1fr] items-center gap-2.5 sm:gap-3">
                  <div className="flex items-center justify-center scale-90 min-[360px]:scale-100 origin-center">
                    <TwoPhonesIllustration />
                  </div>

                  <div className="min-w-0 space-y-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#A86D43] px-2.5 py-1 text-[11px] font-semibold text-white">
                      <TwoPhonesBadgeIcon className="w-3.5 h-3.5" />
                      <span>{dict.modeBBadge}</span>
                    </span>

                    <div>
                      <h3 className="text-[17px] min-[360px]:text-[18px] font-bold leading-tight text-[#242A26]">
                        {dict.modeBTitle}
                      </h3>
                      <p className="mt-0.5 text-xs font-medium leading-snug text-[#565E58]">
                        {dict.modeBSubtitle}
                      </p>
                    </div>

                    <Link
                      href={`/mode-b?langA=${encodeURIComponent(langA)}&langB=${encodeURIComponent(langB)}`}
                      onClick={() => triggerHaptic(settings.hapticsEnabled, 12)}
                      className="inline-flex min-h-[44px] w-full items-center justify-between gap-1.5 rounded-full bg-[#E8D8BF] ps-3.5 pe-1.5 py-1.5 text-xs sm:text-[13px] font-semibold leading-tight text-[#242A26] transition hover:bg-[#dfcba8] active:scale-[0.98]"
                    >
                      <span>{dict.modeBCta}</span>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#242A26]/20 bg-white/80 text-[#242A26]">
                        <ArrowRightIcon
                          className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`}
                        />
                      </span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Secondary Utilities: Live Listen + Saved Phrases */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Link
                href={`/listen?from=${encodeURIComponent(langB)}&to=${encodeURIComponent(langA)}`}
                onClick={() => triggerHaptic(settings.hapticsEnabled, 10)}
                className="flex min-h-[56px] items-center justify-between gap-3 rounded-[22px] border border-[#E2DFD6] bg-white p-3.5 nova-soft-shadow transition hover:border-[#A8BDA9] active:scale-[0.99]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#DCE8DD] text-[#214536]">
                    <HeadphonesListenIcon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#242A26] truncate">
                      {isRtl ? "الاستماع الفوري" : "Live Listen"}
                    </div>
                    <div className="text-[11px] font-medium text-[#565E58] truncate">
                      {isRtl
                        ? "الجولات السياحية والإعلانات والشروحات"
                        : "Tours, announcements & live subtitles"}
                    </div>
                  </div>
                </div>
                <ArrowRightIcon
                  className={`w-4 h-4 shrink-0 text-[#315F4A] ${isRtl ? "rotate-180" : ""}`}
                />
              </Link>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic(settings.hapticsEnabled, 10);
                  setIsSavedOpen(true);
                }}
                className="flex min-h-[56px] items-center justify-between gap-3 rounded-[22px] border border-[#E2DFD6] bg-white p-3.5 text-start nova-soft-shadow transition hover:border-[#C58B62] active:scale-[0.99]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#E8D8BF]/80 text-[#A86D43]">
                    <StarIcon className="w-5 h-5" filled={savedPhrases.length > 0} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#242A26] truncate">
                      {isRtl ? "العبارات المحفوظة" : "Saved Phrases"}
                    </div>
                    <div className="text-[11px] font-medium text-[#565E58] truncate">
                      {savedPhrases.length > 0
                        ? `${savedPhrases.length} ${isRtl ? "عبارة في المفضلة" : "bookmarked"}`
                        : isRtl
                          ? "مفضلتك الصوتية والنصية"
                          : "Starred translations with replay"}
                    </div>
                  </div>
                </div>
                <ArrowRightIcon
                  className={`w-4 h-4 shrink-0 text-[#A86D43] ${isRtl ? "rotate-180" : ""}`}
                />
              </button>
            </div>
          </section>
        </div>

        {/* Footer Trust Strip + Earbud Check */}
        <footer className="mt-5 space-y-2.5">
          <div className="grid grid-cols-3 divide-x rtl:divide-x-reverse divide-[#E2DFD6] rounded-[20px] border border-[#E2DFD6] bg-white px-2 py-2.5 nova-soft-shadow">
            <div className="flex items-center justify-center gap-1.5 px-1.5">
              <ShieldCheckIcon className="w-4 h-4 shrink-0 text-[#315F4A]" />
              <span className="text-[11px] font-semibold leading-tight text-[#242A26] text-center">
                {dict.trustSecure}
              </span>
            </div>
            <div className="flex items-center justify-center gap-1.5 px-1.5">
              <BoltIcon className="w-4 h-4 shrink-0 text-[#315F4A]" />
              <span className="text-[11px] font-semibold leading-tight text-[#242A26] text-center">
                {dict.trustInstant}
              </span>
            </div>
            <div className="flex items-center justify-center gap-1.5 px-1.5">
              <GlobeLinesIcon className="w-4 h-4 shrink-0 text-[#315F4A]" />
              <span className="text-[11px] font-semibold leading-tight text-[#242A26] text-center">
                {dict.trustMulti}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(settings.hapticsEnabled, 8);
                setIsTestModalOpen(true);
              }}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-white/90 px-4 py-2 text-xs font-medium text-[#315F4A] transition hover:bg-white active:scale-95"
            >
              <HeadphonesIcon className="w-3.5 h-3.5" />
              <span>{dict.testEarbudsBtn}</span>
            </button>

            {!isStandalone && installPrompt && (
              <button
                type="button"
                onClick={handleInstallClick}
                className="inline-flex min-h-[44px] items-center rounded-full bg-[#214536] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#315F4A]"
              >
                {dict.installAppCta} {dict.brandName}
              </button>
            )}
          </div>

          {!isStandalone && !installPrompt && isIOS && (
            <p className="text-center text-[11px] text-[#565E58]">
              {dict.iosInstallHint}
            </p>
          )}

          <div className="flex items-center justify-center gap-2.5 pt-0.5 text-[11px] text-[#565E58]">
            <span className="h-px w-10 bg-[#E2DFD6]" />
            <span className="inline-flex items-center gap-1">
              <span>{dict.madeForConversations}</span>
              <HeartOutlineIcon className="w-3.5 h-3.5 text-[#315F4A]" />
            </span>
            <span className="h-px w-10 bg-[#E2DFD6]" />
          </div>

          <p
            dir="ltr"
            className="text-center font-mono text-[10px] font-medium tracking-wide text-[#777F79]"
          >
            NOVA v{APP_VERSION}
          </p>
        </footer>
      </main>

      {/* Modals & Settings Drawer */}
      <AudioSettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onOpenEarbudTest={() => setIsTestModalOpen(true)}
        showDiagnostics={false}
      />

      <MoreLanguagesModal
        isOpen={pickerState.open}
        onClose={() => setPickerState((prev) => ({ ...prev, open: false }))}
        langA={langA}
        langB={langB}
        initialTarget={pickerState.side}
        onChangePair={setLanguagePair}
        uiLocale={settings.uiLocale}
      />

      <EarbudTestModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        langALabel={langAInfo.label}
        langBLabel={langBInfo.label}
      />

      {isPhrasesOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#242A26]/45 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={isRtl ? "عبارات السفر السريعة" : "Quick Travel Phrases"}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsPhrasesOpen(false);
          }}
        >
          <div className="h-[88dvh] w-full max-w-xl overflow-y-auto rounded-t-[28px] sm:rounded-[28px] border border-[#E2DFD6] bg-[#F5F3ED] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.28)]">
            <QuickPhrasesView onCloseModal={() => setIsPhrasesOpen(false)} />
          </div>
        </div>
      )}

      <SavedPhrasesModal
        isOpen={isSavedOpen}
        onClose={() => setIsSavedOpen(false)}
      />
    </div>
  );
}
