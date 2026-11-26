"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckIcon, CopyIcon, ShareIcon } from "@/components/nova/NovaIcons";
import { useNovaSettings } from "@/lib/settingsStore";

interface RoomQRCodeProps {
  roomId: string;
  inviteToken?: string | null;
  passcode?: string | null;
  compact?: boolean;
}

const subscribeNoop = () => () => {};

export default function RoomQRCode({
  roomId,
  inviteToken,
  passcode,
  compact = false,
}: RoomQRCodeProps) {
  const settings = useNovaSettings();
  const isArabicUi = settings.uiLocale === "ar";
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const origin = useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => ""
  );

  const fragment = inviteToken
    ? `#invite=${encodeURIComponent(inviteToken)}`
    : "";
  const shareUrl = origin
    ? `${origin}/room/${roomId}${fragment}`
    : `/room/${roomId}${fragment}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator === "undefined" || !navigator.share) {
      await handleCopy();
      return;
    }
    try {
      await navigator.share({
        title: "Join NOVA Translation Room",
        text: `Join live translation room ${roomId}`,
        url: shareUrl,
      });
    } catch {
      // User cancelled share sheet
    }
  };

  return (
    <div
      dir={isArabicUi ? "rtl" : "ltr"}
      className={`rounded-[24px] border border-[#E2DFD6] bg-white nova-card-shadow ${
        compact ? "p-4" : "p-5"
      } space-y-3.5`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#315F4A]">
            {isArabicUi ? "دعوة شريكك للغرفة" : "Invite Your Partner"}
          </span>
          <p className="mt-0.5 text-xs text-[#565E58]">
            {isArabicUi
              ? "يمسح شريكك الرمز بكاميرا هاتفه أو يدخل رمز الغرفة ورمز الدخول:"
              : "Ask your partner to scan this QR code, or enter the code and PIN:"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              dir="ltr"
              className="rounded-lg border border-[#E2DFD6] bg-[#F5F3ED] px-2.5 py-1 font-mono text-sm sm:text-base font-bold tracking-[0.1em] text-[#242A26] break-all"
            >
              {roomId}
            </span>
            {passcode && (
              <span
                dir="ltr"
                className="rounded-lg border border-[#A8BDA9] bg-[#DCE8DD] px-2.5 py-1 font-mono text-xs font-bold tracking-[0.12em] text-[#214536]"
              >
                {isArabicUi ? `PIN: ${passcode}` : `PIN: ${passcode}`}
              </span>
            )}
          </div>
        </div>

        <span className="shrink-0 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-3 py-1 text-[11px] font-semibold text-[#565E58]">
          {isArabicUi ? "دعوة خاصة" : "Private Invite"}
        </span>
      </div>

      {/* High-contrast white QR container for reliable camera scanning */}
      <div className="flex justify-center">
        <div className="rounded-2xl border border-[#E2DFD6] bg-white p-3 nova-soft-shadow">
          <QRCodeSVG
            value={shareUrl}
            size={compact ? 148 : 184}
            level="M"
            bgColor="#ffffff"
            fgColor="#214536"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-3 py-2 text-xs font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]/60 active:scale-[0.98]"
        >
          {copied ? (
            <CheckIcon className="w-3.5 h-3.5 text-[#3E6E53]" />
          ) : (
            <CopyIcon className="w-3.5 h-3.5 text-[#315F4A]" />
          )}
          <span>
            {copied
              ? isArabicUi
                ? "تم النسخ!"
                : "Copied!"
              : isArabicUi
                ? "نسخ رابط الدعوة"
                : "Copy Invite Link"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => void handleNativeShare()}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-[#315F4A] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#214536] active:scale-[0.98]"
        >
          <ShareIcon className="w-3.5 h-3.5" />
          <span>{isArabicUi ? "مشاركة الدعوة" : "Share Invite"}</span>
        </button>
      </div>
    </div>
  );
}
