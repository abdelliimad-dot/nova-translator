"use client";

import { useEffect, useState } from "react";
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
  initialTarget = "from",
  uiLocale,
}: MoreLanguagesModalProps) {
  const [activeSide, setActiveSide] = useState<"from" | "to">(initialTarget);
  const [searchQuery, setSearchQuery] = useState("");
  const [prevKey, setPrevKey] = useState(`${isOpen}:${initialTarget}`);

  const nextKey = `${isOpen}:${initialTarget}`;
  if (prevKey !== nextKey) {
    setPrevKey(nextKey);
    if (isOpen) {
      setActiveSide(initialTarget);
      setSearchQuery("");
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const dict = getDictionary(uiLocale);
  const isRtl = uiLocale === "ar";

  const getDisplayName = (code: string, fallbackLabel: string) => {
    if (code === "ar") return uiLocale === "ar" ? "العربية" : "Arabic";
    return uiLocale === "ar" ? (LANGUAGE_ARABIC_NAMES[code] ?? fallbackLabel) : fallbackLabel;
  };

  const handleSelect = (code: string) => {
    if (activeSide === "from") {
      if (code === langB) {
        onChangePair(code, langA);
      } else {
        onChangePair(code, langB);
      }
      setActiveSide("to");
      setSearchQuery("");
      return;
    }

    if (code === langA) {
      onChangePair(langB, code);
    } else {
      onChangePair(langA, code);
    }
    onClose();
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredLanguages = normalizedQuery
    ? SUPPORTED_LANGUAGES.filter((l) => {
        const arName = (LANGUAGE_ARABIC_NAMES[l.code] ?? "").toLowerCase();
        return (
          l.label.toLowerCase().includes(normalizedQuery) ||
          l.native.toLowerCase().includes(normalizedQuery) ||
          l.code.toLowerCase().includes(normalizedQuery) ||
          arName.includes(normalizedQuery)
        );
      })
    : SUPPORTED_LANGUAGES;

  const selectedCode = activeSide === "from" ? langA : langB;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#242A26]/45 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="more-languages-title"
      dir={isRtl ? "rtl" : "ltr"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-t-[28px] sm:rounded-[28px] border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.22)] max-h-[88dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2DFD6] bg-white px-5 py-4 shrink-0">
          <div className="min-w-0">
            <h2
              id="more-languages-title"
              className="text-base font-bold text-[#242A26]"
            >
              {dict.moreLanguagesTitle}
            </h2>
            <p className="text-xs text-[#565E58]">
              {activeSide === "from" ? dict.selectFromTitle : dict.selectToTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={dict.closeLabel}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] transition hover:bg-[#DCE8DD]"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Active Side Switch + Search */}
        <div className="px-5 pt-4 pb-3 space-y-2.5 bg-[#F5F3ED] shrink-0">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl border border-[#E2DFD6] bg-white p-1.5 nova-soft-shadow">
            <button
              type="button"
              onClick={() => setActiveSide("from")}
              className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition ${
                activeSide === "from"
                  ? "bg-[#214536] text-white"
                  : "text-[#242A26] hover:bg-[#F5F3ED]"
              }`}
            >
              <LanguageFlag code={langA} size={18} />
              <span className="truncate">
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
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#DCE8DD] text-[#214536] transition hover:bg-[#A8BDA9]/50 active:scale-95"
            >
              <HorizontalSwapIcon className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setActiveSide("to")}
              className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition ${
                activeSide === "to"
                  ? "bg-[#214536] text-white"
                  : "text-[#242A26] hover:bg-[#F5F3ED]"
              }`}
            >
              <LanguageFlag code={langB} size={18} />
              <span className="truncate">
                {getDisplayName(
                  langB,
                  SUPPORTED_LANGUAGES.find((l) => l.code === langB)?.label ?? langB
                )}
              </span>
            </button>
          </div>

          <div className="relative">
            <label htmlFor="nova-language-search" className="sr-only">
              {dict.searchLanguagesPlaceholder}
            </label>
            <input
              id="nova-language-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={dict.searchLanguagesPlaceholder}
              className="min-h-[44px] w-full rounded-2xl border border-[#E2DFD6] bg-white px-4 py-2 text-sm text-[#242A26] placeholder:text-[#565E58] outline-none transition focus:border-[#315F4A]"
            />
          </div>
        </div>

        {/* Language List */}
        <div className="overflow-y-auto px-5 pb-6 space-y-2 overscroll-contain">
          {filteredLanguages.length === 0 ? (
            <div className="rounded-2xl border border-[#E2DFD6] bg-white px-4 py-6 text-center text-xs font-medium text-[#565E58]">
              {dict.noLanguagesFound}
            </div>
          ) : (
            filteredLanguages.map((lang) => {
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
                      ? "border-[#315F4A] bg-[#DCE8DD]/70 text-[#214536]"
                      : "border-[#E2DFD6] bg-white text-[#242A26] hover:border-[#A8BDA9]"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <LanguageFlag code={lang.code} size={26} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {getDisplayName(lang.code, lang.label)}
                      </div>
                      <div className="text-xs text-[#565E58] truncate">
                        {lang.native} · {lang.label}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isOtherSide && (
                      <span className="rounded-full bg-[#E8D8BF]/85 px-2.5 py-0.5 text-[11px] font-semibold text-[#242A26]">
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
            })
          )}
        </div>
      </div>
    </div>
  );
}
