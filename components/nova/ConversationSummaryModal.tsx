"use client";

import { useEffect, useState } from "react";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  ShareNetworkIcon,
  SparklesIcon,
} from "@/components/nova/NovaIcons";
import type { ConversationSummaryPayload } from "@/app/api/summarize/route";

export interface SummaryTurnInput {
  speakerLabel: string;
  sourceText: string;
  translatedText: string;
}

interface ConversationSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  turns: SummaryTurnInput[];
  langALabel: string;
  langBLabel: string;
  isArabicUi: boolean;
}

function formatSummaryText(data: ConversationSummaryPayload): string {
  const sections: string[] = [data.title, "", data.summary];
  if (data.keyPoints.length > 0) {
    sections.push("", "Key Points:", ...data.keyPoints.map((p) => `- ${p}`));
  }
  if (data.pricesAndNumbers.length > 0) {
    sections.push(
      "",
      "Prices & Numbers:",
      ...data.pricesAndNumbers.map((p) => `- ${p}`)
    );
  }
  if (data.timesAndPlaces.length > 0) {
    sections.push(
      "",
      "Times & Places:",
      ...data.timesAndPlaces.map((p) => `- ${p}`)
    );
  }
  if (data.decisions.length > 0) {
    sections.push("", "Decisions:", ...data.decisions.map((p) => `- ${p}`));
  }
  return sections.join("\n").trim();
}

export default function ConversationSummaryModal({
  isOpen,
  onClose,
  turns,
  langALabel,
  langBLabel,
  isArabicUi,
}: ConversationSummaryModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ConversationSummaryPayload | null>(null);
  const [lastSignature, setLastSignature] = useState("");
  const [copied, setCopied] = useState(false);

  const signature = `${isArabicUi ? "ar" : "en"}:${turns.length}:${turns[turns.length - 1]?.sourceText ?? ""}:${turns[turns.length - 1]?.translatedText ?? ""}`;

  useEffect(() => {
    if (!isOpen || turns.length === 0) return;
    if (data && lastSignature === signature) return;

    let cancelled = false;
    const loadSummary = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/summarize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            turns,
            uiLocale: isArabicUi ? "ar" : "en",
            langALabel,
            langBLabel,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as
          | ConversationSummaryPayload
          | { error?: string };
        if (!res.ok) {
          throw new Error(
            "error" in json && json.error
              ? json.error
              : isArabicUi
                ? "تعذر إنشاء الملخص."
                : "Could not summarize this conversation."
          );
        }
        if (!cancelled) {
          setData(json as ConversationSummaryPayload);
          setLastSignature(signature);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : isArabicUi
                ? "حدث خطأ أثناء التلخيص."
                : "Failed to generate summary."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [isOpen, turns, isArabicUi, langALabel, langBLabel, signature, data, lastSignature]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(formatSummaryText(data));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const handleShare = async () => {
    if (!data) return;
    const text = formatSummaryText(data);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: data.title, text });
        return;
      } catch {
        // Fallback to copy
      }
    }
    await handleCopy();
  };

  const renderBullets = (
    headingEn: string,
    headingAr: string,
    items: string[],
    badgeClass: string
  ) => {
    if (items.length === 0) return null;
    return (
      <div className="rounded-2xl border border-[#E6E5DE] bg-white p-3.5 space-y-2 nova-soft-shadow">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeClass}`}
        >
          {isArabicUi ? headingAr : headingEn}
        </span>
        <ul className="space-y-1.5 text-xs leading-relaxed text-[#242A26]">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#315F4A]"
                aria-hidden="true"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div
      dir={isArabicUi ? "rtl" : "ltr"}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#242A26]/45 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nova-summary-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px] border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.28)]">
        <header className="flex items-center justify-between border-b border-[#E2DFD6] bg-white px-5 py-4 shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#DCE8DD] text-[#214536]">
              <SparklesIcon className="w-4 h-4" />
            </span>
            <div>
              <h2 id="nova-summary-title" className="text-base font-bold">
                {isArabicUi ? "ملخص المحادثة الذكي" : "AI Conversation Summary"}
              </h2>
              <p className="text-[11px] text-[#565E58]">
                {langALabel} ↔ {langBLabel} · {turns.length}{" "}
                {isArabicUi ? "رسائل" : "turns"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={isArabicUi ? "إغلاق" : "Close"}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] hover:bg-[#DCE8DD]"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading && (
            <div className="rounded-2xl border border-[#E2DFD6] bg-white p-6 text-center space-y-2 nova-soft-shadow">
              <div className="mx-auto h-6 w-6 rounded-full border-2 border-[#315F4A] border-t-transparent animate-spin" />
              <p className="text-xs font-semibold text-[#565E58]">
                {isArabicUi
                  ? "جاري استخلاص النقاط والأسعار والمواعيد..."
                  : "Extracting key points, prices, times, and decisions..."}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-[#B54F4C]/35 bg-[#C76A67]/12 p-4 text-xs font-medium text-[#9B3B38]">
              {error}
            </div>
          )}

          {!loading && data && (
            <>
              <div className="rounded-2xl border border-[#A8BDA9] bg-white p-4 space-y-1.5 nova-soft-shadow">
                <h3 className="text-sm font-bold text-[#214536]">
                  {data.title}
                </h3>
                <p className="text-xs leading-relaxed text-[#242A26]">
                  {data.summary}
                </p>
              </div>

              {renderBullets(
                "Key Points",
                "النقاط الرئيسية",
                data.keyPoints,
                "bg-[#DCE8DD] text-[#214536]"
              )}
              {renderBullets(
                "Prices & Numbers",
                "الأسعار والأرقام",
                data.pricesAndNumbers,
                "bg-[#E8D8BF] text-[#242A26]"
              )}
              {renderBullets(
                "Times & Places",
                "المواعيد والأماكن",
                data.timesAndPlaces,
                "bg-[#F5F3ED] text-[#315F4A] border border-[#E2DFD6]"
              )}
              {renderBullets(
                "Decisions & Next Steps",
                "القرارات والخطوات التالية",
                data.decisions,
                "bg-[#315F4A] text-white"
              )}
            </>
          )}
        </div>

        {data && (
          <footer className="grid grid-cols-2 gap-2.5 border-t border-[#E2DFD6] bg-white px-5 py-3.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-4 text-xs font-semibold text-[#242A26] hover:bg-[#DCE8DD]"
            >
              {copied ? (
                <CheckIcon className="w-4 h-4 text-[#315F4A]" />
              ) : (
                <CopyIcon className="w-4 h-4 text-[#315F4A]" />
              )}
              <span>
                {copied
                  ? isArabicUi
                    ? "تم النسخ!"
                    : "Copied!"
                  : isArabicUi
                    ? "نسخ الملخص"
                    : "Copy Summary"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void handleShare()}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-[#315F4A] px-4 text-xs font-semibold text-white hover:bg-[#214536]"
            >
              <ShareNetworkIcon className="w-4 h-4" />
              <span>{isArabicUi ? "مشاركة" : "Share"}</span>
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
