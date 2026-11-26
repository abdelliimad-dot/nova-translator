"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import LanguageFlag from "@/components/nova/LanguageFlag";
import MoreLanguagesModal from "@/components/nova/MoreLanguagesModal";
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
import { findLanguage } from "@/lib/languages";
import type { PublicRoomSnapshot } from "@/lib/rooms/roomStore";
import {
  triggerHaptic,
  updateNovaSettings,
  useNovaSettings,
} from "@/lib/settingsStore";

interface PendingJoinState {
  roomId: string;
  inviteToken?: string;
  passcode: string;
  joining: boolean;
  error: string | null;
}

export default function ModeBCreateClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const settings = useNovaSettings();
  const isOnline = useIsOnline();
  const isArabicUi = settings.uiLocale === "ar";

  const initialHost = findLanguage(
    searchParams.get("langA") ?? settings.preferredLangA ?? "ar"
  ).code;
  const initialGuest = findLanguage(
    searchParams.get("langB") ?? settings.preferredLangB ?? "en"
  ).code;

  const [hostLang, setHostLang] = useState(initialHost);
  const [guestLang, setGuestLang] = useState(initialGuest);
  const [pickerState, setPickerState] = useState<{
    open: boolean;
    side: "from" | "to";
  }>({ open: false, side: "from" });

  const [joinCode, setJoinCode] = useState("");
  const [joinPasscode, setJoinPasscode] = useState("");
  const [creating, setCreating] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingJoin, setPendingJoin] = useState<PendingJoinState | null>(null);

  useEffect(() => {
    if (!pendingJoin) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pendingJoin.joining) {
        setPendingJoin(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingJoin]);

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
    updateNovaSettings({ preferredLangA: hostLang, preferredLangB: guestLang });
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ hostLang, guestLang }),
      });
      const data = (await res.json()) as {
        room?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.room?.id) {
        throw new Error(data.error || "Could not create room.");
      }
      router.push(`/room/${data.room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create room.");
      setCreating(false);
    }
  };

  const openJoinConfirmation = (
    roomId: string,
    inviteToken?: string,
    passcode = ""
  ) => {
    triggerHaptic(settings.hapticsEnabled, 10);
    setError(null);
    setPendingJoin({
      roomId,
      inviteToken,
      passcode: passcode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(),
      joining: false,
      error: null,
    });
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const cleanedPasscode = joinPasscode
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase();
    if (cleaned.length < 10) {
      setError(
        isArabicUi
          ? "أدخل رمز غرفة صحيحًا (10 أحرف على الأقل)."
          : "Enter a valid Room Code (shown below your partner's QR code)."
      );
      return;
    }
    openJoinConfirmation(cleaned, undefined, cleanedPasscode);
  };

  const handleConfirmJoin = async () => {
    if (!pendingJoin || pendingJoin.joining) return;
    if (!pendingJoin.inviteToken && pendingJoin.passcode.trim().length < 4) {
      setPendingJoin((prev) =>
        prev
          ? {
              ...prev,
              error: isArabicUi
                ? "أدخل رمز الدخول المكون من 6 أحرف للمتابعة."
                : "Enter the 6-character PIN shown on your partner's phone.",
            }
          : prev
      );
      return;
    }

    triggerHaptic(settings.hapticsEnabled, 12);
    const targetId = pendingJoin.roomId;
    setPendingJoin((prev) => (prev ? { ...prev, joining: true, error: null } : prev));

    try {
      const res = await fetch(`/api/rooms/${targetId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          ...(pendingJoin.inviteToken
            ? { inviteToken: pendingJoin.inviteToken }
            : {}),
          ...(pendingJoin.passcode.trim()
            ? { passcode: pendingJoin.passcode.trim() }
            : {}),
        }),
      });
      const data = (await res.json()) as {
        room?: PublicRoomSnapshot;
        error?: string;
      };
      if (!res.ok || !data.room) {
        setPendingJoin((prev) =>
          prev
            ? {
                ...prev,
                joining: false,
                error:
                  data.error ||
                  (isArabicUi
                    ? "تعذر التحقق من رمز الغرفة أو رمز الدخول."
                    : "That Room Code or PIN didn't match. Check with your partner and try again."),
              }
            : prev
        );
        return;
      }

      setPendingJoin(null);
      router.push(`/room/${targetId}?confirmed=1`);
    } catch {
      setPendingJoin((prev) =>
        prev
          ? {
              ...prev,
              joining: false,
              error: isArabicUi
                ? "تعذر الاتصال للانضمام للغرفة."
                : "Unable to connect right now. Check your internet and retry.",
            }
          : prev
      );
    }
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

      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[460px] md:max-w-3xl flex-col justify-between px-4 py-5 sm:py-8">
        <div className="space-y-5">
          {/* Header */}
          <header className="flex items-center justify-between gap-2">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-white px-3.5 text-xs font-semibold text-[#242A26] nova-soft-shadow transition hover:bg-[#DCE8DD]/50"
            >
              <ArrowLeftIcon
                className={`w-4 h-4 ${isArabicUi ? "rotate-180" : ""}`}
              />
              <span>{isArabicUi ? "الرئيسية" : "Home"}</span>
            </Link>

            <div className="flex items-center gap-2">
              <span className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-[#A86D43] px-3 py-1 text-xs font-semibold text-white">
                <TwoPhonesBadgeIcon className="w-3.5 h-3.5" />
                <span>
                  {isArabicUi ? "هاتفان منفصلان" : "Two Phones"}
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
                aria-label={isArabicUi ? "تبديل لغة التطبيق" : "Switch app language"}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-[#E2DFD6] bg-white px-3 text-xs font-semibold text-[#315F4A] nova-soft-shadow transition hover:bg-[#DCE8DD]/40"
              >
                {isArabicUi ? "EN" : "عربي"}
              </button>
            </div>
          </header>

          {/* Responsive 1-col mobile -> 2-col desktop grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            {/* Card 1: Create Room */}
            <section className="rounded-[26px] border border-[#E2DFD6] bg-white p-5 space-y-4 nova-card-shadow">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-[#242A26]">
                  {isArabicUi
                    ? "ابدأ غرفة جديدة"
                    : "Start a New Room"}
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-[#565E58]">
                  {isArabicUi
                    ? "يمسح شريكك الرمز من هاتفه دون حساب. يتحدث كل شخص بلغته ويسمع الترجمة مباشرة."
                    : "Your partner joins from their phone with one scan — no sign-up needed."}
                </p>
              </div>

              <div className="rounded-2xl border border-[#E2DFD6] bg-[#F5F3ED] p-1.5 min-[360px]:p-2">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                  {/* Host Lang */}
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(settings.hapticsEnabled, 8);
                      setPickerState({ open: true, side: "from" });
                    }}
                    aria-label={
                      isArabicUi
                        ? `لغتك: ${getLangName(hostLangInfo.code, hostLangInfo.label)}`
                        : `Your language: ${hostLangInfo.label}`
                    }
                    className="flex min-h-[52px] items-center justify-between gap-1 rounded-xl px-1 min-[360px]:px-1.5 py-1 text-start transition hover:bg-white/80 min-w-0"
                  >
                    <div className="min-w-0">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-[#315F4A]">
                        {isArabicUi ? "أنت" : "You"}
                      </span>
                      <span className="mt-0.5 inline-flex items-center gap-0.5 text-[12.5px] min-[360px]:text-sm font-semibold leading-tight text-[#242A26] max-w-full">
                        <span>
                          {getLangName(hostLangInfo.code, hostLangInfo.label)}
                        </span>
                        <ChevronDownIcon className="w-3 h-3 shrink-0 text-[#565E58]" />
                      </span>
                    </div>
                    <LanguageFlag code={hostLangInfo.code} size={18} className="min-[360px]:w-5 min-[360px]:h-5" />
                  </button>

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
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(settings.hapticsEnabled, 8);
                      setPickerState({ open: true, side: "to" });
                    }}
                    aria-label={
                      isArabicUi
                        ? `لغة الشريك: ${getLangName(guestLangInfo.code, guestLangInfo.label)}`
                        : `Partner's language: ${guestLangInfo.label}`
                    }
                    className="flex min-h-[52px] items-center justify-between gap-1 rounded-xl px-1 min-[360px]:px-1.5 py-1 text-start transition hover:bg-white/80 min-w-0"
                  >
                    <div className="min-w-0">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-[#A86D43]">
                        {isArabicUi ? "الشريك" : "Partner"}
                      </span>
                      <span className="mt-0.5 inline-flex items-center gap-0.5 text-[12.5px] min-[360px]:text-sm font-semibold leading-tight text-[#242A26] max-w-full">
                        <span>
                          {getLangName(guestLangInfo.code, guestLangInfo.label)}
                        </span>
                        <ChevronDownIcon className="w-3 h-3 shrink-0 text-[#565E58]" />
                      </span>
                    </div>
                    <LanguageFlag code={guestLangInfo.code} size={18} className="min-[360px]:w-5 min-[360px]:h-5" />
                  </button>
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
                      ? "إنشاء الغرفة وعرض QR"
                      : "Create Room & Show QR"}
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
              className="rounded-[26px] border border-[#E2DFD6] bg-white p-5 space-y-3.5 nova-card-shadow"
            >
              <div>
                <h2 className="text-lg font-bold tracking-tight text-[#242A26]">
                  {isArabicUi ? "الدخول لغرفة شريك" : "Join a Partner's Room"}
                </h2>
                <p className="mt-1 text-xs text-[#565E58]">
                  {isArabicUi
                    ? "امسح رمز QR من شاشة شريكك، أو أدخل الرمز والرقم السري يدوياً."
                    : "Scan the QR code on your partner's screen, or enter the code and PIN."}
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
                  {isArabicUi ? "مسح رمز QR" : "Scan QR Code"}
                </span>
              </button>

              <div className="relative flex items-center py-0.5">
                <span className="flex-1 border-t border-[#E2DFD6]" />
                <span className="px-2.5 text-[11px] font-medium text-[#565E58]">
                  {isArabicUi ? "أو أدخل الرمز يدويًا" : "or enter code manually"}
                </span>
                <span className="flex-1 border-t border-[#E2DFD6]" />
              </div>

              <div className="space-y-2.5">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1">
                    <label
                      htmlFor="join-room-code"
                      className="sr-only"
                    >
                      {isArabicUi ? "رمز الغرفة" : "Room Code"}
                    </label>
                    <input
                      id="join-room-code"
                      type="text"
                      dir="ltr"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder={isArabicUi ? "رمز الغرفة" : "Room Code"}
                      maxLength={20}
                      className="min-h-[46px] w-full rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-4 py-2 font-mono text-xs sm:text-sm uppercase tracking-wider text-[#242A26] placeholder:text-[#565E58] placeholder:normal-case placeholder:tracking-normal outline-none focus:border-[#315F4A]"
                    />
                  </div>
                  <div className="w-full sm:w-32">
                    <label
                      htmlFor="join-room-passcode"
                      className="sr-only"
                    >
                      {isArabicUi ? "رمز الدخول PIN" : "6-letter PIN"}
                    </label>
                    <input
                      id="join-room-passcode"
                      type="text"
                      dir="ltr"
                      value={joinPasscode}
                      onChange={(e) =>
                        setJoinPasscode(
                          e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
                        )
                      }
                      placeholder={isArabicUi ? "PIN (6 أحرف)" : "6-char PIN"}
                      maxLength={10}
                      className="min-h-[46px] w-full rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-4 py-2 font-mono text-xs sm:text-sm uppercase tracking-widest text-[#242A26] placeholder:text-[#565E58] placeholder:normal-case placeholder:tracking-normal outline-none focus:border-[#315F4A]"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="min-h-[46px] w-full rounded-full bg-[#214536] px-5 py-2 text-xs sm:text-sm font-semibold text-white transition hover:bg-[#315F4A] active:scale-[0.98]"
                >
                  {isArabicUi ? "متابعة للانضمام" : "Continue to Join"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* Searchable Language Picker */}
      <MoreLanguagesModal
        isOpen={pickerState.open}
        onClose={() => setPickerState((prev) => ({ ...prev, open: false }))}
        langA={hostLang}
        langB={guestLang}
        initialTarget={pickerState.side}
        onChangePair={(nextHost, nextGuest) => {
          setHostLang(nextHost);
          setGuestLang(nextGuest);
        }}
        uiLocale={settings.uiLocale}
      />

      {/* QR Scanner Modal */}
      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onDecodedRoom={(roomId, inviteToken) => {
          setIsScannerOpen(false);
          openJoinConfirmation(roomId, inviteToken);
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
          onClick={(e) => {
            if (e.target === e.currentTarget && !pendingJoin.joining) {
              setPendingJoin(null);
            }
          }}
        >
          <div className="w-full max-w-md rounded-t-[28px] sm:rounded-[28px] border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.24)] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="join-confirm-title"
                  className="text-base font-bold text-[#242A26]"
                >
                  {isArabicUi ? "تأكيد الدخول للغرفة" : "Ready to Join Room?"}
                </h2>
                <p className="text-xs text-[#565E58]">
                  {pendingJoin.inviteToken
                    ? isArabicUi
                      ? "تم التعرف على الدعوة بنجاح — اضغط دخول للبدء"
                      : "Private invite ready — confirm below to enter"
                    : isArabicUi
                      ? "أدخل رمز الدخول المكون من 6 أحرف الظاهر عند شريكك"
                      : "Enter the 6-character PIN shown on your partner's screen"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingJoin(null)}
                aria-label={isArabicUi ? "إلغاء" : "Cancel"}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-white text-[#242A26]"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-2xl border border-[#E2DFD6] bg-white p-4 space-y-3 nova-soft-shadow">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#565E58]">
                  {isArabicUi ? "رمز الغرفة" : "Room Code"}
                </span>
                <span
                  dir="ltr"
                  className="rounded-full bg-[#DCE8DD] px-3 py-1 font-mono text-xs font-bold tracking-wider text-[#214536] break-all"
                >
                  {pendingJoin.roomId}
                </span>
              </div>

              {!pendingJoin.inviteToken && (
                <div className="pt-2 border-t border-[#E2DFD6] space-y-1.5">
                  <label
                    htmlFor="modal-room-passcode"
                    className="block text-xs font-semibold text-[#315F4A]"
                  >
                    {isArabicUi ? "رمز الدخول (6 أحرف)" : "6-character PIN"}
                  </label>
                  <input
                    id="modal-room-passcode"
                    type="text"
                    dir="ltr"
                    value={pendingJoin.passcode}
                    onChange={(e) =>
                      setPendingJoin((prev) =>
                        prev
                          ? {
                              ...prev,
                              passcode: e.target.value
                                .replace(/[^a-zA-Z0-9]/g, "")
                                .toUpperCase(),
                              error: null,
                            }
                          : prev
                      )
                    }
                    placeholder="XXXXXX"
                    maxLength={10}
                    className="min-h-[44px] w-full rounded-xl border border-[#E2DFD6] bg-[#F5F3ED] px-3.5 py-2 font-mono text-sm font-bold uppercase tracking-[0.18em] text-[#242A26] outline-none focus:border-[#315F4A]"
                  />
                </div>
              )}

              {pendingJoin.error && (
                <p
                  role="alert"
                  className="rounded-xl border border-[#B54F4C]/35 bg-[#C76A67]/10 px-3 py-2 text-xs font-medium text-[#9B3B38]"
                >
                  {pendingJoin.error}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setPendingJoin(null)}
                disabled={pendingJoin.joining}
                className="min-h-[46px] rounded-full border border-[#E2DFD6] bg-white px-4 text-xs font-semibold text-[#242A26] transition hover:bg-[#F5F3ED] disabled:opacity-50"
              >
                {isArabicUi ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmJoin()}
                disabled={pendingJoin.joining}
                className="min-h-[46px] rounded-full bg-[#315F4A] px-4 text-xs font-semibold text-white transition hover:bg-[#214536] active:scale-[0.98] disabled:opacity-60"
              >
                {pendingJoin.joining
                  ? isArabicUi
                    ? "جاري الدخول..."
                    : "Joining..."
                  : isArabicUi
                    ? "دخول الغرفة"
                    : "Join Room"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
