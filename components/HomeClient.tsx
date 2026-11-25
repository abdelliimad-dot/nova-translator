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
import { findLanguage, SUPPORTED_LANGUAGES } from "@/lib/languages";
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

  const [langA, setLangA] = useState("ar");
  const [langB, setLangB] = useState("en");
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMoreLangsOpen, setIsMoreLangsOpen] = useState(false);

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

  const handleSelectA = (nextA: string) => {
    triggerHaptic(settings.hapticsEnabled, 8);
    if (nextA === langB) {
      setLangB(langA);
    }
    setLangA(nextA);
  };

  const handleSelectB = (nextB: string) => {
    triggerHaptic(settings.hapticsEnabled, 8);
    if (nextB === langA) {
      setLangA(langB);
    }
    setLangB(nextB);
  };

  const handleSwapLanguages = () => {
    triggerHaptic(settings.hapticsEnabled, 10);
    setLangA(langB);
    setLangB(langA);
  };

  const handlePreset = (a: string, b: string) => {
    triggerHaptic(settings.hapticsEnabled, 10);
    setLangA(a);
    setLangB(b);
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
      flagCode: "gb",
    },
    {
      a: "ar",
      b: "fr",
      label: dict.presets.arFr,
      type: "flag" as const,
      flagCode: "fr",
    },
    {
      a: "ar",
      b: "tr",
      label: dict.presets.arTr,
      type: "flag" as const,
      flagCode: "tr",
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

      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="space-y-4">
          {/* Header Bar */}
          <header className="flex items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <NovaLogo size={40} className="shrink-0" />
              <div className="min-w-0">
                <div className="text-[20px] font-bold tracking-tight leading-none text-[#242A26]">
                  {dict.brandName}
                </div>
                <p className="mt-1 text-[11px] font-medium text-[#777F79] truncate">
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
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-[#E6E5DE] bg-white px-3 text-xs font-semibold text-[#315F4A] nova-soft-shadow transition hover:bg-[#DCE8DD]/40 active:scale-95"
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
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E6E5DE] bg-white text-[#242A26] nova-soft-shadow transition hover:bg-[#DCE8DD]/40 active:scale-95"
              >
                <SettingsGearIcon className="w-5 h-5" />
              </button>
            </div>
          </header>

          {/* Compact Hero Section */}
          <section className="relative flex items-center justify-between gap-2 pt-1 pb-0.5">
            <div className="min-w-0 flex-1 space-y-1.5">
              <h1 className="text-[28px] sm:text-[31px] font-bold leading-[1.08] tracking-tight text-[#242A26]">
                {dict.heroTitle}
              </h1>
              <p className="text-[13px] font-medium leading-snug text-[#777F79]">
                {dict.heroSubtitle}
              </p>
            </div>
            <div className="shrink-0 -me-1">
              <HeroGlobeIllustration />
            </div>
          </section>

          {/* Language Selector + Presets Section */}
          <section className="space-y-2.5" aria-label="Language selection">
            <div className="rounded-[24px] border border-[#E6E5DE] bg-white p-3.5 nova-card-shadow">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                {/* From Language */}
                <div className="relative flex min-h-[48px] items-center justify-between gap-1.5 rounded-2xl px-2 py-1 transition hover:bg-[#F5F3ED]">
                  <div className="min-w-0">
                    <span className="block text-[11px] font-medium text-[#777F79]">
                      {dict.fromLabel}
                    </span>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[16px] font-semibold text-[#242A26] max-w-full">
                      <span className="truncate">
                        {getLanguageDisplayName(langAInfo.code, langAInfo.label)}
                      </span>
                      <ChevronDownIcon className="w-3.5 h-3.5 shrink-0 text-[#777F79]" />
                    </span>
                  </div>
                  <LanguageFlag code={langAInfo.code} size={26} />
                  <select
                    aria-label={dict.fromLabel}
                    value={langA}
                    onChange={(e) => handleSelectA(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  >
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label} ({l.native})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Swap Button */}
                <button
                  type="button"
                  onClick={handleSwapLanguages}
                  aria-label={dict.swapLanguagesAria}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#DCE8DD] text-[#214536] transition hover:bg-[#A8BDA9]/55 active:scale-95"
                >
                  <HorizontalSwapIcon className="w-4 h-4" />
                </button>

                {/* To Language */}
                <div className="relative flex min-h-[48px] items-center justify-between gap-1.5 rounded-2xl px-2 py-1 transition hover:bg-[#F5F3ED]">
                  <div className="min-w-0">
                    <span className="block text-[11px] font-medium text-[#777F79]">
                      {dict.toLabel}
                    </span>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[16px] font-semibold text-[#242A26] max-w-full">
                      <span className="truncate">
                        {getLanguageDisplayName(langBInfo.code, langBInfo.label)}
                      </span>
                      <ChevronDownIcon className="w-3.5 h-3.5 shrink-0 text-[#777F79]" />
                    </span>
                  </div>
                  <LanguageFlag code={langBInfo.code} size={26} />
                  <select
                    aria-label={dict.toLabel}
                    value={langB}
                    onChange={(e) => handleSelectB(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  >
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label} ({l.native})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Quick Presets Row */}
            <div className="grid grid-cols-4 gap-1.5">
              {presets.map((preset) => {
                const active = isPresetActive(preset.a, preset.b);
                return (
                  <button
                    key={`${preset.a}-${preset.b}`}
                    type="button"
                    onClick={() => handlePreset(preset.a, preset.b)}
                    className={`flex min-h-[44px] items-center justify-center gap-1 rounded-full px-1.5 py-1.5 text-[10.5px] sm:text-[11px] font-semibold transition active:scale-[0.97] ${
                      active
                        ? "bg-[#214536] text-white nova-soft-shadow"
                        : "border border-[#E6E5DE] bg-white text-[#242A26] nova-soft-shadow hover:border-[#A8BDA9]"
                    }`}
                  >
                    {preset.type === "bolt" ? (
                      <BoltIcon
                        className={`w-3 h-3 shrink-0 ${
                          active ? "text-[#DCE8DD]" : "text-[#315F4A]"
                        }`}
                      />
                    ) : (
                      <LanguageFlag code={preset.b} size={14} />
                    )}
                    <span className="whitespace-nowrap">{preset.label}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  triggerHaptic(settings.hapticsEnabled, 8);
                  setIsMoreLangsOpen(true);
                }}
                className="flex min-h-[44px] items-center justify-center gap-1 rounded-full border border-[#E6E5DE] bg-white px-1.5 py-1.5 text-[10.5px] sm:text-[11px] font-semibold text-[#242A26] nova-soft-shadow transition hover:border-[#A8BDA9] active:scale-[0.97]"
              >
                <MoreGridIcon className="w-3.5 h-3.5 shrink-0 text-[#315F4A]" />
                <span className="whitespace-nowrap">{dict.moreLanguages}</span>
              </button>
            </div>
          </section>

          {/* Primary Mode Cards */}
          <section className="space-y-3" aria-label="Translation modes">
            {/* Mode A — Face to Face */}
            <div className="relative overflow-hidden rounded-[26px] border border-[#E6E5DE] bg-white p-4 nova-card-shadow">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 start-0 w-[44%] bg-gradient-to-tr from-[#315F4A]/20 via-[#DCE8DD]/65 to-transparent"
              />
              <div className="relative grid grid-cols-[auto_1fr] items-center gap-2.5 sm:gap-3.5">
                <div className="flex items-center justify-center">
                  <EarbudsIllustration />
                </div>

                <div className="min-w-0 space-y-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#315F4A] px-2.5 py-1 text-[11px] font-semibold text-white">
                    <HeadphonesIcon className="w-3.5 h-3.5" />
                    <span>{dict.modeABadge}</span>
                  </span>

                  <div>
                    <h2 className="text-[18px] sm:text-[19px] font-bold leading-tight text-[#242A26]">
                      {dict.modeATitle}
                    </h2>
                    <p className="mt-0.5 text-xs font-medium text-[#777F79]">
                      {dict.modeASubtitle}
                    </p>
                  </div>

                  <Link
                    href={`/mode-a?langA=${encodeURIComponent(langA)}&langB=${encodeURIComponent(langB)}`}
                    onClick={() => triggerHaptic(settings.hapticsEnabled, 12)}
                    className="inline-flex min-h-[44px] w-full items-center justify-between gap-1.5 rounded-full bg-[#315F4A] ps-3.5 pe-1.5 py-1.5 text-[12px] sm:text-[13px] font-semibold text-white shadow-[0_6px_16px_-4px_rgba(33,69,54,0.38)] transition hover:bg-[#214536] active:scale-[0.98]"
                  >
                    <span className="whitespace-nowrap">{dict.modeACta}</span>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#214536]">
                      <ArrowRightIcon
                        className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`}
                      />
                    </span>
                  </Link>
                </div>
              </div>
            </div>

            {/* Mode B — Connect Two Phones */}
            <div className="relative overflow-hidden rounded-[26px] border border-[#E6E5DE] bg-white p-4 nova-card-shadow">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 start-0 w-[44%] bg-gradient-to-tr from-[#E8D8BF]/70 via-[#E8D8BF]/30 to-transparent"
              />
              <div className="relative grid grid-cols-[auto_1fr] items-center gap-2.5 sm:gap-3.5">
                <div className="flex items-center justify-center">
                  <TwoPhonesIllustration />
                </div>

                <div className="min-w-0 space-y-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#C58B62] px-2.5 py-1 text-[11px] font-semibold text-white">
                    <TwoPhonesBadgeIcon className="w-3.5 h-3.5" />
                    <span>{dict.modeBBadge}</span>
                  </span>

                  <div>
                    <h2 className="text-[18px] sm:text-[19px] font-bold leading-tight text-[#242A26]">
                      {dict.modeBTitle}
                    </h2>
                    <p className="mt-0.5 text-xs font-medium text-[#777F79]">
                      {dict.modeBSubtitle}
                    </p>
                  </div>

                  <Link
                    href={`/mode-b?langA=${encodeURIComponent(langA)}&langB=${encodeURIComponent(langB)}`}
                    onClick={() => triggerHaptic(settings.hapticsEnabled, 12)}
                    className="inline-flex min-h-[44px] w-full items-center justify-between gap-1.5 rounded-full bg-[#E8D8BF] ps-3.5 pe-1.5 py-1.5 text-[12px] sm:text-[13px] font-semibold text-[#242A26] transition hover:bg-[#dfcba8] active:scale-[0.98]"
                  >
                    <span className="whitespace-nowrap">{dict.modeBCta}</span>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#242A26]/20 bg-white/75 text-[#242A26]">
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

        {/* Footer Trust Strip + Earbud Test Link */}
        <footer className="mt-4 space-y-2.5">
          {/* Trust Strip */}
          <div className="grid grid-cols-3 divide-x rtl:divide-x-reverse divide-[#E6E5DE] rounded-[20px] border border-[#E6E5DE] bg-white px-2 py-2.5 nova-soft-shadow">
            <div className="flex items-center justify-center gap-1.5 px-1.5">
              <ShieldCheckIcon className="w-4 h-4 shrink-0 text-[#315F4A]" />
              <span className="text-[11px] font-semibold leading-tight text-[#242A26]">
                {dict.trustSecure}
              </span>
            </div>
            <div className="flex items-center justify-center gap-1.5 px-1.5">
              <BoltIcon className="w-4 h-4 shrink-0 text-[#315F4A]" />
              <span className="text-[11px] font-semibold leading-tight text-[#242A26]">
                {dict.trustInstant}
              </span>
            </div>
            <div className="flex items-center justify-center gap-1.5 px-1.5">
              <GlobeLinesIcon className="w-4 h-4 shrink-0 text-[#315F4A]" />
              <span className="text-[11px] font-semibold leading-tight text-[#242A26]">
                {dict.trustMulti}
              </span>
            </div>
          </div>

          {/* Discreet Earbud Test + PWA Install */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(settings.hapticsEnabled, 8);
                setIsTestModalOpen(true);
              }}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E6E5DE] bg-white/85 px-4 py-2 text-xs font-medium text-[#315F4A] transition hover:bg-white active:scale-95"
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
            <p className="text-center text-[11px] text-[#777F79]">
              {dict.iosInstallHint}
            </p>
          )}

          {/* Made for conversations */}
          <div className="flex items-center justify-center gap-2.5 pt-0.5 text-[11px] text-[#777F79]">
            <span className="h-px w-10 bg-[#E6E5DE]" />
            <span className="inline-flex items-center gap-1">
              <span>{dict.madeForConversations}</span>
              <HeartOutlineIcon className="w-3.5 h-3.5 text-[#315F4A]" />
            </span>
            <span className="h-px w-10 bg-[#E6E5DE]" />
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
        isOpen={isMoreLangsOpen}
        onClose={() => setIsMoreLangsOpen(false)}
        langA={langA}
        langB={langB}
        onChangePair={(nextA, nextB) => {
          setLangA(nextA);
          setLangB(nextB);
        }}
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
