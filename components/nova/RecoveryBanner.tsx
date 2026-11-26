"use client";

import { CloseIcon, MicOffIcon, ShieldCheckIcon } from "@/components/nova/NovaIcons";

export type RecoveryErrorKind = "permission" | "network" | "not_found" | "generic";

export function classifyErrorKind(message: string): RecoveryErrorKind {
  const lower = message.toLowerCase();
  if (
    lower.includes("notallowed") ||
    lower.includes("permission") ||
    lower.includes("denied")
  ) {
    return "permission";
  }
  if (
    lower.includes("notfound") ||
    lower.includes("no microphone") ||
    lower.includes("requested device not found") ||
    lower.includes("disconnected") ||
    lower.includes("preempted") ||
    lower.includes("notreadable")
  ) {
    return "not_found";
  }
  if (
    lower.includes("offline") ||
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("timed out") ||
    lower.includes("socket") ||
    lower.includes("reach") ||
    lower.includes("disconnected from")
  ) {
    return "network";
  }
  return "generic";
}

function toHumanErrorCopy(
  message: string,
  kind: RecoveryErrorKind,
  isArabicUi: boolean
): { title: string; hint: string } {
  if (kind === "permission") {
    return isArabicUi
      ? {
          title: "تعذر الوصول إلى الميكروفون",
          hint: "اسمح للمتصفح باستخدام الميكروفون من إعدادات الموقع ثم اضغط إعادة المحاولة.",
        }
      : {
          title: "Microphone access is blocked",
          hint: "Allow microphone access in your browser site settings, then tap Try again.",
        };
  }
  if (kind === "not_found") {
    return isArabicUi
      ? {
          title: "لم يتم العثور على ميكروفون جاهز",
          hint: "تأكد من عدم استخدام الميكروفون في مكالمة أخرى أو اختر ميكروفون الهاتف من الإعدادات.",
        }
      : {
          title: "No microphone is currently available",
          hint: "Close other apps using the mic or switch to your phone microphone in Settings.",
        };
  }
  if (kind === "network") {
    return isArabicUi
      ? {
          title: "تعذر الاتصال بخدمة الترجمة",
          hint: "تحقق من اتصال الإنترنت لديك ثم اضغط إعادة المحاولة.",
        }
      : {
          title: "Connection lost or unstable",
          hint: "Check your internet connection and tap Try again.",
        };
  }
  if (message.toLowerCase().includes("suspended")) {
    return isArabicUi
      ? {
          title: "أوقف الهاتف صوت المتصفح مؤقتًا",
          hint: "اضغط استئناف أو أعد تشغيل الترجمة لاستعادة الصوت.",
        }
      : {
          title: "Audio was paused by your phone",
          hint: "Tap anywhere on screen or tap Try again to resume voice playback.",
        };
  }
  return {
    title: message,
    hint: isArabicUi
      ? "اضغط إعادة المحاولة لاستئناف الجلسة."
      : "Tap Try again to reconnect smoothly.",
  };
}

interface RecoveryBannerProps {
  isOnline?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  isArabicUi?: boolean;
  compact?: boolean;
}

export default function RecoveryBanner({
  isOnline = true,
  errorMessage,
  onRetry,
  onDismiss,
  isArabicUi = false,
  compact = false,
}: RecoveryBannerProps) {
  if (isOnline && !errorMessage) return null;

  const errorKind = errorMessage ? classifyErrorKind(errorMessage) : null;
  const copy =
    errorMessage && errorKind
      ? toHumanErrorCopy(errorMessage, errorKind, isArabicUi)
      : null;

  return (
    <div
      className="space-y-1.5"
      dir={isArabicUi ? "rtl" : "ltr"}
      aria-live="polite"
    >
      {!isOnline && (
        <div
          className="flex items-center justify-between gap-2 rounded-2xl border border-[#A87131]/40 bg-[#E8D8BF]/90 px-3.5 py-2.5 text-xs text-[#242A26]"
          role="status"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#A87131]"
              aria-hidden="true"
            />
            <span className="font-medium leading-snug">
              {isArabicUi
                ? "لا يوجد اتصال بالإنترنت — ستستأنف الترجمة تلقائيًا عند عودة الشبكة."
                : "You're offline — check your connection to continue translating."}
            </span>
          </div>
        </div>
      )}

      {errorMessage && copy && (
        <div
          className={`rounded-2xl border border-[#B54F4C]/40 bg-[#C76A67]/10 ${
            compact ? "px-3 py-2" : "px-4 py-3"
          } text-xs text-[#242A26]`}
          role="alert"
        >
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex items-start gap-2 min-w-0">
              {errorKind === "permission" || errorKind === "not_found" ? (
                <MicOffIcon className="mt-0.5 w-4 h-4 shrink-0 text-[#B54F4C]" />
              ) : (
                <ShieldCheckIcon className="mt-0.5 w-4 h-4 shrink-0 text-[#B54F4C]" />
              )}
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold text-[#9B3B38] leading-snug break-words">
                  {copy.title}
                </p>
                <p className="text-[11px] text-[#565E58] leading-snug">
                  {copy.hint}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="min-h-[44px] rounded-full bg-[#315F4A] px-3.5 text-[11px] font-semibold text-white transition hover:bg-[#214536] active:scale-[0.98]"
                >
                  {isArabicUi ? "إعادة المحاولة" : "Try again"}
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label={isArabicUi ? "إخفاء التنبيه" : "Dismiss alert"}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-white text-[#565E58] hover:text-[#242A26]"
                >
                  <CloseIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
