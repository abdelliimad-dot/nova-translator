"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import AudioSettingsDrawer from "@/components/AudioSettingsDrawer";
import EarbudTestModal from "@/components/EarbudTestModal";
import LanguageFlag from "@/components/nova/LanguageFlag";
import MoreLanguagesModal from "@/components/nova/MoreLanguagesModal";
import {
  ArrowRightIcon,
  BoltIcon,
  ChevronDownIcon,
  GlobeLinesIcon,
  HeadphonesIcon,
  HeartOutlineIcon,
  HorizontalSwapIcon,
  MoreGridIcon,
  SettingsGearIcon,
  ShieldCheckIcon,
  TwoPhonesBadgeIcon,
} from "@/components/nova/NovaIcons";
import {
  EarbudsIllustration,
  HeroGlobeIllustration,
  TwoPhonesIllustration,
} from "@/components/nova/NovaIllustrations";
import NovaLogo from "@/components/nova/NovaLogo";
import { getDictionary, LANGUAGE_ARABIC_NAMES } from "@/lib/i18n";
import { findLanguage } from "@/lib/languages";
import {
  triggerHaptic,
  updateNovaSettings,
  useNovaSettings,
} from "@/lib/settingsStore";

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
                <div className="text-[20px] font-bold tracking-tight leading-none text-[#242A26]">
                  {dict.brandName}
                </div>
                <p className="mt-1 text-[11px] font-medium leading-tight text-[#565E58]">
                  {dict.brandSubtitle}
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
                  13 {isRtl ? "لغة" : "languages"}
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

          {/* Primary Mode Cards (Stacked mobile -> Balanced 2-col desktop) */}
          <section
            className="grid grid-cols-1 md:grid-cols-2 gap-3.5"
            aria-label="Conversation modes"
          >
            {/* Mode A — One Phone / Share Earbuds */}
            <div className="relative flex flex-col justify-between overflow-hidden rounded-[26px] border border-[#E2DFD6] bg-white p-3 min-[360px]:p-4 nova-card-shadow">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 start-0 w-[44%] bg-gradient-to-tr from-[#315F4A]/16 via-[#DCE8DD]/60 to-transparent"
              />
              <div className="relative grid grid-cols-[auto_1fr] items-center gap-2 min-[360px]:gap-3">
                <div className="flex items-center justify-center scale-90 min-[360px]:scale-100 origin-center">
                  <EarbudsIllustration />
                </div>

                <div className="min-w-0 space-y-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#315F4A] px-2.5 py-1 text-[11px] font-semibold text-white">
                    <HeadphonesIcon className="w-3.5 h-3.5" />
                    <span>{dict.modeABadge}</span>
                  </span>

                  <div>
                    <h2 className="text-[17px] min-[360px]:text-[19px] font-bold leading-tight text-[#242A26]">
                      {dict.modeATitle}
                    </h2>
                    <p className="mt-0.5 text-xs font-medium leading-snug text-[#565E58]">
                      {dict.modeASubtitle}
                    </p>
                  </div>

                  <Link
                    href={`/mode-a?langA=${encodeURIComponent(langA)}&langB=${encodeURIComponent(langB)}`}
                    onClick={() => triggerHaptic(settings.hapticsEnabled, 12)}
                    className="inline-flex min-h-[44px] w-full items-center justify-between gap-1.5 rounded-full bg-[#315F4A] ps-3 min-[360px]:ps-3.5 pe-1.5 py-1.5 text-[11.5px] min-[360px]:text-[13px] font-semibold leading-tight text-white shadow-[0_6px_16px_-4px_rgba(33,69,54,0.38)] transition hover:bg-[#214536] active:scale-[0.98]"
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

            {/* Mode B — Two Phones */}
            <div className="relative flex flex-col justify-between overflow-hidden rounded-[26px] border border-[#E2DFD6] bg-white p-3 min-[360px]:p-4 nova-card-shadow">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 start-0 w-[44%] bg-gradient-to-tr from-[#E8D8BF]/70 via-[#E8D8BF]/30 to-transparent"
              />
              <div className="relative grid grid-cols-[auto_1fr] items-center gap-2 min-[360px]:gap-3">
                <div className="flex items-center justify-center scale-90 min-[360px]:scale-100 origin-center">
                  <TwoPhonesIllustration />
                </div>

                <div className="min-w-0 space-y-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#A86D43] px-2.5 py-1 text-[11px] font-semibold text-white">
                    <TwoPhonesBadgeIcon className="w-3.5 h-3.5" />
                    <span>{dict.modeBBadge}</span>
                  </span>

                  <div>
                    <h2 className="text-[17px] min-[360px]:text-[19px] font-bold leading-tight text-[#242A26]">
                      {dict.modeBTitle}
                    </h2>
                    <p className="mt-0.5 text-xs font-medium leading-snug text-[#565E58]">
                      {dict.modeBSubtitle}
                    </p>
                  </div>

                  <Link
                    href={`/mode-b?langA=${encodeURIComponent(langA)}&langB=${encodeURIComponent(langB)}`}
                    onClick={() => triggerHaptic(settings.hapticsEnabled, 12)}
                    className="inline-flex min-h-[44px] w-full items-center justify-between gap-1.5 rounded-full bg-[#E8D8BF] ps-3 min-[360px]:ps-3.5 pe-1.5 py-1.5 text-[11.5px] min-[360px]:text-[13px] font-semibold leading-tight text-[#242A26] transition hover:bg-[#dfcba8] active:scale-[0.98]"
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
    </div>
  );
}
