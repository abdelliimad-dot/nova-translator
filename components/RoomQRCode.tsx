"use client";

import { useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckIcon, CopyIcon, ShareIcon } from "@/components/nova/NovaIcons";
import { useNovaSettings } from "@/lib/settingsStore";

interface RoomQRCodeProps {
  roomId: string;
  compact?: boolean;
}

const subscribeNoop = () => () => {};

export default function RoomQRCode({ roomId, compact = false }: RoomQRCodeProps) {
  const settings = useNovaSettings();
  const isArabicUi = settings.uiLocale === "ar";
  const [copied, setCopied] = useState(false);

  const origin = useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => ""
  );

  const shareUrl = origin ? `${origin}/room/${roomId}` : `/room/${roomId}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
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
      className={`rounded-[24px] border border-[#E6E5DE] bg-white nova-card-shadow ${
        compact ? "p-4" : "p-5"
      } space-y-4`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#315F4A]">
            {isArabicUi ? "امسح الرمز للانضمام" : "Scan to Join Room"}
          </span>
          <div className="mt-0.5 flex items-center gap-2">
            <span
              dir="ltr"
              className="font-mono text-2xl font-bold tracking-[0.18em] text-[#242A26]"
            >
              {roomId}
            </span>
          </div>
        </div>

        <span className="rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-3 py-1 text-[11px] font-semibold text-[#777F79]">
          {isArabicUi ? "دون تسجيل" : "No login needed"}
        </span>
      </div>

      {/* High-contrast white QR container for reliable camera scanning */}
      <div className="flex justify-center">
        <div className="rounded-2xl border border-[#E6E5DE] bg-white p-3.5 nova-soft-shadow">
          <QRCodeSVG
            value={shareUrl}
            size={compact ? 152 : 188}
            level="M"
            bgColor="#ffffff"
            fgColor="#214536"
          />
        </div>
      </div>

      <div className="space-y-2.5">
        <div
          dir="ltr"
          className="truncate rounded-xl border border-[#E6E5DE] bg-[#F5F3ED] px-3 py-2 font-mono text-[11px] text-[#777F79]"
        >
          {shareUrl}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-3 py-2 text-xs font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]/60 active:scale-[0.98]"
          >
            {copied ? (
              <CheckIcon className="w-3.5 h-3.5 text-[#4C8062]" />
            ) : (
              <CopyIcon className="w-3.5 h-3.5 text-[#315F4A]" />
            )}
            <span>
              {copied
                ? isArabicUi
                  ? "تم النسخ!"
                  : "Copied!"
                : isArabicUi
                  ? "نسخ الرابط"
                  : "Copy Link"}
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
    </div>
  );
}
