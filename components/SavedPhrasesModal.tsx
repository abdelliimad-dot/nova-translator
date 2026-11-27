"use client";

import { useEffect, useState } from "react";
import LanguageFlag from "@/components/nova/LanguageFlag";
import {
  CloseIcon,
  SpeakerPlayIcon,
  StarIcon,
  TrashIcon,
} from "@/components/nova/NovaIcons";
import { replayTurnAudio } from "@/lib/audio/replayHelper";
import {
  clearSavedPhrases,
  removeSavedPhrase,
  useSavedPhrases,
} from "@/lib/favoritesStore";
import { findLanguage } from "@/lib/languages";
import { triggerHaptic, useNovaSettings } from "@/lib/settingsStore";

interface SavedPhrasesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SavedPhrasesModal({
  isOpen,
  onClose,
}: SavedPhrasesModalProps) {
  const settings = useNovaSettings();
  const isRtl = settings.uiLocale === "ar";
  const saved = useSavedPhrases();
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#242A26]/45 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="saved-phrases-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px] border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.28)]">
        <header className="flex items-center justify-between border-b border-[#E2DFD6] bg-white px-5 py-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E8D8BF] text-[#A86D43]">
              <StarIcon className="w-4 h-4" filled />
            </span>
            <div>
              <h2 id="saved-phrases-title" className="text-base font-bold">
                {isRtl ? "العبارات المحفوظة" : "Saved Phrases"}
              </h2>
              <p className="text-[11px] text-[#565E58]">
                {saved.length} {isRtl ? "عبارة محفوظة" : "saved"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {saved.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(settings.hapticsEnabled, 10);
                  clearSavedPhrases();
                }}
                aria-label={isRtl ? "مسح الكل" : "Clear all saved"}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-3 text-xs font-semibold text-[#9B3B38] hover:bg-[#C76A67]/15"
              >
                <TrashIcon className="w-3.5 h-3.5" />
                <span>{isRtl ? "مسح" : "Clear"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={isRtl ? "إغلاق" : "Close"}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {saved.length === 0 ? (
            <div className="rounded-2xl border border-[#E2DFD6] bg-white p-6 text-center space-y-1.5 nova-soft-shadow">
              <p className="text-sm font-semibold text-[#242A26]">
                {isRtl
                  ? "لا توجد عبارات محفوظة بعد"
                  : "No saved phrases yet"}
              </p>
              <p className="text-xs text-[#565E58]">
                {isRtl
                  ? "اضغط على أيقونة النجمة في أي ترجمة داخل الوضع A أو B أو C لحفظها هنا."
                  : "Tap the star icon on any translated message in Mode A, B, or C to bookmark it here."}
              </p>
            </div>
          ) : (
            saved.map((item) => {
              const tgtLang = findLanguage(item.targetLang);
              const srcLang = findLanguage(item.sourceLang);
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-[#E2DFD6] bg-white p-3.5 space-y-2 nova-soft-shadow"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <LanguageFlag code={srcLang.code} size={16} />
                      <span className="text-[10px] font-bold uppercase text-[#565E58]">
                        {srcLang.code} → {tgtLang.code}
                      </span>
                      <LanguageFlag code={tgtLang.code} size={16} />
                      <span className="rounded-full bg-[#F5F3ED] px-2 py-0.5 text-[10px] font-semibold text-[#315F4A]">
                        {item.modeLabel}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic(settings.hapticsEnabled, 8);
                          setPlayingId(item.id);
                          replayTurnAudio({
                            turnId: `fav-${item.id}`,
                            text: item.translatedText || item.sourceText,
                            langCode: tgtLang.code,
                            channel: "both",
                          });
                          setTimeout(() => setPlayingId(null), 1400);
                        }}
                        aria-label={isRtl ? "تشغيل الصوت" : "Replay audio"}
                        className={`inline-flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition ${
                          playingId === item.id
                            ? "border-[#315F4A] bg-[#315F4A] text-white"
                            : "border-[#E2DFD6] bg-[#F5F3ED] text-[#315F4A] hover:bg-[#DCE8DD]"
                        }`}
                      >
                        <SpeakerPlayIcon className="w-3.5 h-3.5" />
                        <span>{isRtl ? "نطق" : "Play"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic(settings.hapticsEnabled, 8);
                          removeSavedPhrase(item.id);
                        }}
                        aria-label={isRtl ? "حذف العبارة" : "Delete saved phrase"}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#565E58] hover:bg-[#C76A67]/15 hover:text-[#9B3B38]"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {item.translatedText && (
                    <p
                      dir={tgtLang.rtl ? "rtl" : "ltr"}
                      className="text-sm font-bold leading-snug text-[#214536]"
                    >
                      {item.translatedText}
                    </p>
                  )}
                  {item.sourceText && (
                    <p
                      dir={srcLang.rtl ? "rtl" : "ltr"}
                      className="text-xs text-[#565E58]"
                    >
                      {item.sourceText}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
