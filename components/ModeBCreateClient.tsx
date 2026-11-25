"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import LanguageFlag from "@/components/nova/LanguageFlag";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  ChevronDownIcon,
  CloseIcon,
  HorizontalSwapIcon,
  QrCodeIcon,
  TwoPhonesBadgeIcon,
} from "@/components/nova/NovaIcons";
import QrScannerModal from "@/components/QrScannerModal";
import RecoveryBanner from "@/components/nova/RecoveryBanner";
import { useIsOnline } from "@/lib/hooks/useNetworkStatus";
import { LANGUAGE_ARABIC_NAMES } from "@/lib/i18n";
import { findLanguage, SUPPORTED_LANGUAGES } from "@/lib/languages";
import type { PublicRoomSnapshot } from "@/lib/rooms/roomStore";
import {
  triggerHaptic,
  updateNovaSettings,
  useNovaSettings,
} from "@/lib/settingsStore";

interface PendingJoinState {
  roomId: string;
  loading: boolean;
  preview: PublicRoomSnapshot | null;
  previewError: string | null;
}

export default function ModeBCreateClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const settings = useNovaSettings();
  const isOnline = useIsOnline();
  const isArabicUi = settings.uiLocale === "ar";

  const initialHost = findLanguage(searchParams.get("langA") ?? "ar").code;
  const initialGuest = findLanguage(searchParams.get("langB") ?? "en").code;

  const [hostLang, setHostLang] = useState(initialHost);
  const [guestLang, setGuestLang] = useState(initialGuest);
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingJoin, setPendingJoin] = useState<PendingJoinState | null>(null);

  const hostLangInfo = findLanguage(hostLang);
  const guestLangInfo = findLanguage(guestLang);

  const getLangName = (code: string, fallback: string) => {
    if (code === "ar") return "العربية";
    return isArabicUi ? (LANGUAGE_ARABIC_NAMES[code] ?? fallback) : fallback;
  };

  const handleSwap = () => {
    triggerHaptic(settings.hapticsEnabled, 10);
    setHostLang(guestLang);
    setGuestLang(hostLang);
  };

  const handleCreateRoom = async () => {
    triggerHaptic(settings.hapticsEnabled, 12);
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostLang, guestLang }),
      });
      const data = (await res.json()) as {
        room?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.room?.id) {
        throw new Error(data.error || "Could not create room.");
      }
      router.push(`/room/${data.room.id}?role=host`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create room.");
      setCreating(false);
    }
  };

  const openJoinConfirmation = async (roomId: string) => {
    triggerHaptic(settings.hapticsEnabled, 10);
    setError(null);
    setPendingJoin({
      roomId,
      loading: true,
      preview: null,
      previewError: null,
    });

    try {
      const res = await fetch(`/api/rooms/${roomId}`, { cache: "no-store" });
      const data = (await res.json()) as {
        room?: PublicRoomSnapshot;
        error?: string;
      };
      setPendingJoin((prev) => {
        if (!prev || prev.roomId !== roomId) return prev;
        if (!res.ok || !data.room) {
          return {
            ...prev,
            loading: false,
            previewError:
              data.error ||
              (isArabicUi
                ? "تعذر جلب تفاصيل الغرفة، يمكنك المتابعة على أي حال."
                : "Could not load room preview; you can still join directly."),
          };
        }
        return {
          ...prev,
          loading: false,
          preview: data.room,
        };
      });
    } catch {
      setPendingJoin((prev) =>
        prev && prev.roomId === roomId
          ? {
              ...prev,
              loading: false,
              previewError: isArabicUi
                ? "تعذر الوصول للخادم مؤقتًا."
                : "Temporary connection issue loading preview.",
            }
          : prev
      );
    }
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (cleaned.length < 4) {
      setError(
        isArabicUi
          ? "أدخل رمز غرفة صحيحًا (4 أحرف على الأقل)."
          : "Enter a valid room code."
      );
      return;
    }
    void openJoinConfirmation(cleaned);
  };

  const handleConfirmJoin = () => {
    if (!pendingJoin) return;
    triggerHaptic(settings.hapticsEnabled, 12);
    const targetId = pendingJoin.roomId;
    setPendingJoin(null);
    router.push(`/room/${targetId}?confirmed=1`);
  };

  return (
    <div
      dir={isArabicUi ? "rtl" : "ltr"}
      className="relative min-h-dvh w-full overflow-x-hidden bg-[#F5F3ED] text-[#242A26]"
    >
      {/* Subtle organic sand & sage corner waves */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <svg
          className="absolute -top-6 -start-10 h-40 w-52 text-[#E8D8BF]/55"
          viewBox="0 0 240 180"
          fill="none"
        >
          <path d="M0 0H210C155 48 92 108 0 148V0Z" fill="currentColor" />
        </svg>
        <svg
          className="absolute -bottom-8 -end-10 h-44 w-56 text-[#DCE8DD]/65"
          viewBox="0 0 240 160"
          fill="none"
        >
          <path d="M240 160V34C158 58 84 102 18 160H240Z" fill="currentColor" />
        </svg>
      </div>

      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[460px] flex-col justify-between px-4 py-5 sm:py-8">
        <div className="space-y-5">
          {/* Header */}
          <header className="flex items-center justify-between gap-2">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E6E5DE] bg-white px-3.5 text-xs font-semibold text-[#242A26] nova-soft-shadow transition hover:bg-[#DCE8DD]/50"
            >
              <ArrowLeftIcon
                className={`w-4 h-4 ${isArabicUi ? "rotate-180" : ""}`}
              />
              <span>{isArabicUi ? "الرئيسية" : "Home"}</span>
            </Link>

            <div className="flex items-center gap-2">
              <span className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-[#C58B62] px-3 py-1 text-xs font-semibold text-white">
                <TwoPhonesBadgeIcon className="w-3.5 h-3.5" />
                <span>
                  {isArabicUi ? "الوضع B · هاتفان" : "Mode B · Two Phones"}
                </span>
              </span>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic(settings.hapticsEnabled, 8);
                  updateNovaSettings({
                    uiLocale: isArabicUi ? "en" : "ar",
                  });
                }}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-[#E6E5DE] bg-white px-3 text-xs font-semibold text-[#315F4A] nova-soft-shadow transition hover:bg-[#DCE8DD]/40"
              >
                {isArabicUi ? "EN" : "عربي"}
              </button>
            </div>
          </header>

          {/* Card 1: Create Room */}
          <section className="rounded-[26px] border border-[#E6E5DE] bg-white p-5 space-y-4 nova-card-shadow">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[#242A26]">
                {isArabicUi
                  ? "إنشاء غرفة ترجمة عبر QR"
                  : "Create a QR Translation Room"}
              </h1>
              <p className="mt-1 text-xs leading-relaxed text-[#777F79]">
                {isArabicUi
                  ? "يمسح شريكك الرمز من هاتفه دون تسجيل دخول. يتحدث كل هاتف بلغته ويسمع الترجمة مباشرة."
                  : "Your partner scans the QR code on their own phone — no login required. Each phone captures its own voice and hears live translation."}
              </p>
            </div>

            <div className="rounded-2xl border border-[#E6E5DE] bg-[#F5F3ED] p-3">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                {/* Host Lang */}
                <div className="relative flex min-h-[52px] items-center justify-between gap-1.5 rounded-xl px-2 py-1 hover:bg-white/75">
                  <div className="min-w-0">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#315F4A]">
                      {isArabicUi ? "لغتك (المضيف)" : "You (Host)"}
                    </span>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-[#242A26] max-w-full">
                      <span className="truncate">
                        {getLangName(hostLangInfo.code, hostLangInfo.label)}
                      </span>
                      <ChevronDownIcon className="w-3.5 h-3.5 shrink-0 text-[#777F79]" />
                    </span>
                  </div>
                  <LanguageFlag code={hostLangInfo.code} size={24} />
                  <select
                    aria-label="Your spoken language (Host)"
                    value={hostLang}
                    onChange={(e) => setHostLang(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  >
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label} ({l.native})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Swap */}
                <button
                  type="button"
                  onClick={handleSwap}
                  aria-label={isArabicUi ? "تبديل اللغتين" : "Swap languages"}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#DCE8DD] text-[#214536] transition hover:bg-[#A8BDA9]/55 active:scale-95"
                >
                  <HorizontalSwapIcon className="w-4 h-4" />
                </button>

                {/* Guest Lang */}
                <div className="relative flex min-h-[52px] items-center justify-between gap-1.5 rounded-xl px-2 py-1 hover:bg-white/75">
                  <div className="min-w-0">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#C58B62]">
                      {isArabicUi ? "الشريك (الضيف)" : "Partner (Guest)"}
                    </span>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-[#242A26] max-w-full">
                      <span className="truncate">
                        {getLangName(guestLangInfo.code, guestLangInfo.label)}
                      </span>
                      <ChevronDownIcon className="w-3.5 h-3.5 shrink-0 text-[#777F79]" />
                    </span>
                  </div>
                  <LanguageFlag code={guestLangInfo.code} size={24} />
                  <select
                    aria-label="Partner's language (Guest)"
                    value={guestLang}
                    onChange={(e) => setGuestLang(e.target.value)}
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

            <RecoveryBanner
              isOnline={isOnline}
              errorMessage={error}
              onDismiss={() => setError(null)}
              isArabicUi={isArabicUi}
            />

            <button
              type="button"
              disabled={creating || !isOnline}
              onClick={() => void handleCreateRoom()}
              className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-full bg-[#315F4A] ps-5 pe-2 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_-4px_rgba(33,69,54,0.38)] transition hover:bg-[#214536] active:scale-[0.99] disabled:opacity-60"
            >
              <span>
                {creating
                  ? isArabicUi
                    ? "جاري إنشاء الغرفة..."
                    : "Creating Room..."
                  : isArabicUi
                    ? "إنشاء غرفة QR مباشرة"
                    : "Create Live QR Room"}
              </span>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#214536]">
                <ArrowRightIcon
                  className={`w-4 h-4 ${isArabicUi ? "rotate-180" : ""}`}
                />
              </span>
            </button>
          </section>

          {/* Card 2: Join Partner's Room */}
          <form
            onSubmit={handleJoinRoom}
            className="rounded-[26px] border border-[#E6E5DE] bg-white p-5 space-y-3.5 nova-card-shadow"
          >
            <div>
              <label
                htmlFor="join-room-code"
                className="block text-sm font-bold text-[#242A26]"
              >
                {isArabicUi ? "الانضمام إلى غرفة شريك" : "Join Partner's Room"}
              </label>
              <p className="mt-0.5 text-xs text-[#777F79]">
                {isArabicUi
                  ? "امسح رمز QR بالكاميرا أو أدخل رمز الغرفة المكون من 6 أحرف"
                  : "Scan your partner's QR code or enter their 6-character code"}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                triggerHaptic(settings.hapticsEnabled, 8);
                setIsScannerOpen(true);
              }}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[#E8D8BF] px-4 py-3 text-sm font-semibold text-[#242A26] transition hover:bg-[#dfcba8] active:scale-[0.99]"
            >
              <QrCodeIcon className="w-4 h-4 text-[#214536]" />
              <CameraIcon className="w-4 h-4 text-[#214536]" />
              <span>
                {isArabicUi ? "مسح / رفع رمز QR" : "Scan / Upload QR"}
              </span>
            </button>

            <div className="flex gap-2">
              <input
                id="join-room-code"
                type="text"
                dir="ltr"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder={
                  isArabicUi ? "أو أدخل الرمز (مثال K7M9P2)" : "Code (e.g. K7M9P2)"
                }
                maxLength={10}
                className="min-h-[46px] flex-1 rounded-full border border-[#E6E5DE] bg-[#F5F3ED] px-4 py-2 font-mono text-sm uppercase tracking-widest text-[#242A26] placeholder:text-[#777F79] placeholder:normal-case placeholder:tracking-normal outline-none focus:border-[#315F4A]"
              />
              <button
                type="submit"
                className="min-h-[46px] rounded-full bg-[#214536] px-5 py-2 text-xs font-semibold text-white transition hover:bg-[#315F4A] active:scale-[0.98]"
              >
                {isArabicUi ? "دخول" : "Join"}
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* QR Scanner Modal */}
      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onDecodedRoom={(roomId) => {
          setIsScannerOpen(false);
          void openJoinConfirmation(roomId);
        }}
      />

      {/* Join Confirmation Modal */}
      {pendingJoin && (
        <div
          dir={isArabicUi ? "rtl" : "ltr"}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#242A26]/45 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-confirm-title"
        >
          <div className="w-full max-w-md rounded-t-[28px] sm:rounded-[28px] border border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.24)] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="join-confirm-title"
                  className="text-base font-bold text-[#242A26]"
                >
                  {isArabicUi ? "تأكيد الانضمام للغرفة" : "Confirm Join Room"}
                </h2>
                <p className="text-xs text-[#777F79]">
                  {isArabicUi
                    ? "تحقق من رمز الغرفة واللغات قبل البدء"
                    : "Verify the room code and languages before entering"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingJoin(null)}
                aria-label={isArabicUi ? "إلغاء" : "Cancel"}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E6E5DE] bg-white text-[#242A26]"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-2xl border border-[#E6E5DE] bg-white p-4 space-y-3 nova-soft-shadow">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#777F79]">
                  {isArabicUi ? "رمز الغرفة" : "Room Code"}
                </span>
                <span
                  dir="ltr"
                  className="rounded-full bg-[#DCE8DD] px-3 py-1 font-mono text-sm font-bold tracking-widest text-[#214536]"
                >
                  {pendingJoin.roomId}
                </span>
              </div>

              {pendingJoin.loading ? (
                <p className="text-xs text-[#777F79]">
                  {isArabicUi
                    ? "جاري التحقق من تفاصيل الغرفة..."
                    : "Fetching room details..."}
                </p>
              ) : pendingJoin.preview ? (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#E6E5DE]">
                  <div className="flex items-center gap-2">
                    <LanguageFlag
                      code={pendingJoin.preview.hostLangCode}
                      size={20}
                    />
                    <span className="text-xs font-semibold text-[#242A26]">
                      {getLangName(
                        pendingJoin.preview.hostLangCode,
                        pendingJoin.preview.hostLangLabel
                      )}
                    </span>
                  </div>
                  <span className="text-xs text-[#777F79]">↔</span>
                  <div className="flex items-center gap-2">
                    <LanguageFlag
                      code={pendingJoin.preview.guestLangCode}
                      size={20}
                    />
                    <span className="text-xs font-semibold text-[#315F4A]">
                      {getLangName(
                        pendingJoin.preview.guestLangCode,
                        pendingJoin.preview.guestLangLabel
                      )}
                    </span>
                  </div>
                </div>
              ) : pendingJoin.previewError ? (
                <p className="text-xs text-[#C28B47]">
                  {pendingJoin.previewError}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setPendingJoin(null)}
                className="min-h-[46px] rounded-full border border-[#E6E5DE] bg-white px-4 text-xs font-semibold text-[#242A26] transition hover:bg-[#F5F3ED]"
              >
                {isArabicUi ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleConfirmJoin}
                className="min-h-[46px] rounded-full bg-[#315F4A] px-4 text-xs font-semibold text-white transition hover:bg-[#214536] active:scale-[0.98]"
              >
                {isArabicUi ? "تأكيد والدخول" : "Confirm & Join"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
