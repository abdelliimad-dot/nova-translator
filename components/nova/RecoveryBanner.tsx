"use client";

import { CloseIcon, MicOffIcon, ShieldCheckIcon } from "@/components/nova/NovaIcons";

export type RecoveryErrorKind = "permission" | "network" | "generic";

export function classifyErrorKind(message: string): RecoveryErrorKind {
  const lower = message.toLowerCase();
  if (
    lower.includes("notallowed") ||
    lower.includes("permission") ||
    lower.includes("denied") ||
    lower.includes("notfound") ||
    lower.includes("microphone")
  ) {
    return "permission";
  }
  if (
    lower.includes("offline") ||
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("timed out") ||
    lower.includes("socket") ||
    lower.includes("reach")
  ) {
    return "network";
  }
  return "generic";
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

  return (
    <div className="space-y-1.5" dir={isArabicUi ? "rtl" : "ltr"}>
      {!isOnline && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#C28B47]/45 bg-[#E8D8BF]/85 px-3 py-2 text-xs text-[#242A26]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#C28B47]" />
            <span className="font-medium leading-snug">
              {isArabicUi
                ? "أنت غير متصل بالإنترنت — الترجمة الفورية والمزامنة تتطلبان اتصالًا."
                : "You are offline — live AI translation and room sync require an active connection."}
            </span>
          </div>
        </div>
      )}

      {errorMessage && (
        <div
          className={`rounded-2xl border border-[#C76A67]/45 bg-[#C76A67]/10 ${
            compact ? "px-3 py-2" : "px-3.5 py-2.5"
          } text-xs text-[#242A26]`}
          role="alert"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              {errorKind === "permission" ? (
                <MicOffIcon className="mt-0.5 w-4 h-4 shrink-0 text-[#C76A67]" />
              ) : (
                <ShieldCheckIcon className="mt-0.5 w-4 h-4 shrink-0 text-[#C76A67]" />
              )}
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold text-[#C76A67] leading-snug break-words">
                  {errorMessage}
                </p>
                {errorKind === "permission" && (
                  <p className="text-[11px] text-[#777F79] leading-snug">
                    {isArabicUi
                      ? "اسمح بالوصول للميكروفون من إعدادات الموقع في المتصفح ثم اضغط إعادة المحاولة."
                      : "Enable Microphone permission in your browser site settings, then tap Retry."}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="min-h-[44px] rounded-full bg-[#315F4A] px-3.5 text-[11px] font-semibold text-white transition hover:bg-[#214536] active:scale-[0.98]"
                >
                  {isArabicUi ? "إعادة المحاولة" : "Retry"}
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label={isArabicUi ? "إخفاء التنبيه" : "Dismiss error"}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E6E5DE] bg-white text-[#777F79] hover:text-[#242A26]"
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
