"use client";

import { useState } from "react";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { getDictionary, LANGUAGE_ARABIC_NAMES, type UiLocale } from "@/lib/i18n";
import LanguageFlag from "@/components/nova/LanguageFlag";
import {
  CheckIcon,
  CloseIcon,
  HorizontalSwapIcon,
} from "@/components/nova/NovaIcons";

interface MoreLanguagesModalProps {
  isOpen: boolean;
  onClose: () => void;
  langA: string;
  langB: string;
  onChangePair: (nextA: string, nextB: string) => void;
  initialTarget?: "from" | "to";
  uiLocale: UiLocale;
}

export default function MoreLanguagesModal({
  isOpen,
  onClose,
  langA,
  langB,
  onChangePair,
  initialTarget = "to",
  uiLocale,
}: MoreLanguagesModalProps) {
  const [activeSide, setActiveSide] = useState<"from" | "to">(initialTarget);

  if (!isOpen) return null;

  const dict = getDictionary(uiLocale);
  const isRtl = uiLocale === "ar";

  const getDisplayName = (code: string, fallbackLabel: string) =>
    uiLocale === "ar" ? (LANGUAGE_ARABIC_NAMES[code] ?? fallbackLabel) : fallbackLabel;

  const handleSelect = (code: string) => {
    if (activeSide === "from") {
      if (code === langB) {
        onChangePair(code, langA);
      } else {
        onChangePair(code, langB);
      }
      setActiveSide("to");
      return;
    }

    if (code === langA) {
      onChangePair(langB, code);
    } else {
      onChangePair(langA, code);
    }
    onClose();
  };

  const selectedCode = activeSide === "from" ? langA : langB;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#242A26]/45 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="more-languages-title"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="w-full max-w-md rounded-t-[28px] sm:rounded-[28px] border border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.22)] max-h-[88dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E6E5DE] bg-white px-5 py-4">
          <div>
            <h2
              id="more-languages-title"
              className="text-base font-semibold text-[#242A26]"
            >
              {dict.moreLanguagesTitle}
            </h2>
            <p className="text-xs text-[#777F79]">
              {activeSide === "from" ? dict.selectFromTitle : dict.selectToTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={dict.closeLabel}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] transition hover:bg-[#DCE8DD]"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        {/* From / To Switch Tabs */}
        <div className="px-5 pt-4 pb-3 bg-[#F5F3ED]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl border border-[#E6E5DE] bg-white p-1.5 nova-soft-shadow">
            <button
              type="button"
              onClick={() => setActiveSide("from")}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                activeSide === "from"
                  ? "bg-[#214536] text-white"
                  : "text-[#242A26] hover:bg-[#F5F3ED]"
              }`}
            >
              <LanguageFlag code={langA} size={18} />
              <span className="truncate">
                {dict.fromLabel}:{" "}
                {getDisplayName(
                  langA,
                  SUPPORTED_LANGUAGES.find((l) => l.code === langA)?.label ?? langA
                )}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onChangePair(langB, langA)}
              aria-label={dict.swapLanguagesAria}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#DCE8DD] text-[#214536] transition hover:bg-[#A8BDA9]/50 active:scale-95"
            >
              <HorizontalSwapIcon className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setActiveSide("to")}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                activeSide === "to"
                  ? "bg-[#214536] text-white"
                  : "text-[#242A26] hover:bg-[#F5F3ED]"
              }`}
            >
              <LanguageFlag code={langB} size={18} />
              <span className="truncate">
                {dict.toLabel}:{" "}
                {getDisplayName(
                  langB,
                  SUPPORTED_LANGUAGES.find((l) => l.code === langB)?.label ?? langB
                )}
              </span>
            </button>
          </div>
        </div>

        {/* Language Grid */}
        <div className="overflow-y-auto px-5 pb-6 space-y-2">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = lang.code === selectedCode;
            const isOtherSide =
              activeSide === "from" ? lang.code === langB : lang.code === langA;

            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => handleSelect(lang.code)}
                className={`flex w-full min-h-[52px] items-center justify-between rounded-2xl border px-4 py-2.5 text-start transition active:scale-[0.99] ${
                  isSelected
                    ? "border-[#315F4A] bg-[#DCE8DD]/65 text-[#214536]"
                    : "border-[#E6E5DE] bg-white text-[#242A26] hover:border-[#A8BDA9] hover:bg-white"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <LanguageFlag code={lang.code} size={26} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {getDisplayName(lang.code, lang.label)}
                    </div>
                    <div className="text-xs text-[#777F79] truncate">
                      {lang.native} · {lang.label}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isOtherSide && (
                    <span className="rounded-full bg-[#E8D8BF]/70 px-2 py-0.5 text-[10px] font-semibold text-[#242A26]">
                      {activeSide === "from" ? dict.toLabel : dict.fromLabel}
                    </span>
                  )}
                  {isSelected && (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#315F4A] text-white">
                      <CheckIcon className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
