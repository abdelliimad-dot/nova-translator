"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import LanguageFlag from "@/components/nova/LanguageFlag";
import {
  ArrowLeftIcon,
  CameraIcon,
  CheckIcon,
  CopyIcon,
  SpeakerPlayIcon,
  UploadImageIcon,
} from "@/components/nova/NovaIcons";
import { CameraTranslateIllustration } from "@/components/nova/NovaIllustrations";
import { replayTurnAudio } from "@/lib/audio/replayHelper";
import { LANGUAGE_ARABIC_NAMES } from "@/lib/i18n";
import { findLanguage, SUPPORTED_LANGUAGES } from "@/lib/languages";
import { triggerHaptic, useNovaSettings } from "@/lib/settingsStore";

interface TranslatedImageItem {
  original: string;
  translated: string;
  note?: string;
  price?: string;
}

interface ImageTranslationResponse {
  detectedLanguage: string;
  headline: string;
  summary: string;
  items: TranslatedImageItem[];
  rawTextTranslated: string;
  targetLang: string;
}

async function compressImageFileToJpegBase64(
  file: File
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  const maxEdge = 1280;
  const quality = 0.75;
  const objectUrl = URL.createObjectURL(file);
  try {
    let sourceWidth = 0;
    let sourceHeight = 0;
    let drawable: CanvasImageSource;

    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file);
        sourceWidth = bitmap.width;
        sourceHeight = bitmap.height;
        drawable = bitmap;
      } catch {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error("Could not decode image."));
          el.src = objectUrl;
        });
        sourceWidth = img.width;
        sourceHeight = img.height;
        drawable = img;
      }
    } else {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Could not decode image."));
        el.src = objectUrl;
      });
      sourceWidth = img.width;
      sourceHeight = img.height;
      drawable = img;
    }

    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight, 1));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.drawImage(drawable, 0, 0, width, height);
    if ("close" in drawable && typeof drawable.close === "function") {
      drawable.close();
    }

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const base64 = dataUrl.split(",")[1] ?? "";
    return { base64, mimeType: "image/jpeg", previewUrl: dataUrl };
  } catch {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read file."));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1] ?? "";
    return {
      base64,
      mimeType: file.type || "image/jpeg",
      previewUrl: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function CameraTranslateClient() {
  const searchParams = useSearchParams();
  const settings = useNovaSettings();
  const isRtl = settings.uiLocale === "ar";

  const initialTarget = findLanguage(
    searchParams.get("target") ??
      (settings.uiLocale === "ar"
        ? "ar"
        : settings.preferredLangA || "en")
  ).code;

  const [targetLang, setTargetLang] = useState(initialTarget);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<{
    base64: string;
    mimeType: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImageTranslationResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const targetEntry = findLanguage(targetLang);

  const runTranslate = async (
    base64: string,
    mimeType: string,
    langCode: string
  ) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/translate-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          imageBase64: base64,
          mimeType,
          targetLang: langCode,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as
        | ImageTranslationResponse
        | { error?: string };
      if (!res.ok) {
        const serverErr =
          "error" in json && typeof json.error === "string" && json.error
            ? json.error
            : null;
        throw new Error(
          serverErr ??
            (isRtl
              ? `تعذر ترجمة الصورة (HTTP ${res.status}).`
              : `Could not translate this image (HTTP ${res.status}).`)
        );
      }
      setResult(json as ImageTranslationResponse);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isRtl
            ? "حدث خطأ أثناء معالجة الصورة."
            : "Image translation failed."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFilePicked = async (file?: File | null) => {
    if (!file) return;
    triggerHaptic(settings.hapticsEnabled, 10);
    setResult(null);
    setError(null);
    try {
      const processed = await compressImageFileToJpegBase64(file);
      setPreviewUrl(processed.previewUrl);
      setLastPayload({
        base64: processed.base64,
        mimeType: processed.mimeType,
      });
      await runTranslate(processed.base64, processed.mimeType, targetLang);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load selected photo."
      );
    }
  };

  const handleTargetChange = (nextCode: string) => {
    setTargetLang(nextCode);
    if (lastPayload) {
      void runTranslate(lastPayload.base64, lastPayload.mimeType, nextCode);
    }
  };

  const handleCopyAll = async () => {
    if (!result) return;
    const lines = [result.headline, "", result.summary];
    if (result.items.length > 0) {
      lines.push(
        "",
        ...result.items.map(
          (it) =>
            `${it.translated}${it.price ? ` (${it.price})` : ""}${it.note ? ` — ${it.note}` : ""}`
        )
      );
    } else if (result.rawTextTranslated) {
      lines.push("", result.rawTextTranslated);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n").trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore
    }
  };

  const handleSpeakSummary = () => {
    if (!result) return;
    triggerHaptic(settings.hapticsEnabled, 8);
    const spoken =
      result.summary ||
      result.rawTextTranslated ||
      result.items.map((i) => i.translated).join(". ");
    replayTurnAudio({
      turnId: `cam-${Date.now()}`,
      text: spoken,
      langCode: targetEntry.code,
      channel: "both",
    });
  };

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="min-h-dvh w-full bg-[#F5F3ED] text-[#242A26]"
    >
      <main className="mx-auto max-w-xl px-4 py-4 space-y-4">
        <header className="flex items-center justify-between gap-2">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-white px-3.5 text-xs font-semibold text-[#242A26] nova-soft-shadow hover:bg-[#DCE8DD]/60"
          >
            <ArrowLeftIcon className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`} />
            <span>{isRtl ? "الرئيسية" : "Home"}</span>
          </Link>

          <span className="rounded-full bg-[#DCE8DD] px-3 py-1 text-xs font-bold text-[#214536]">
            {isRtl ? "ترجمة الكاميرا" : "Camera Translate"}
          </span>
        </header>

        {/* Capture Hero Card */}
        <section className="rounded-[26px] border border-[#E2DFD6] bg-white p-4 space-y-4 nova-card-shadow">
          <div className="flex items-center gap-3.5">
            <CameraTranslateIllustration />
            <div className="min-w-0 flex-1 space-y-1">
              <h1 className="text-lg font-bold text-[#242A26]">
                {isRtl
                  ? "ترجم القوائم واللافتات بالصورة"
                  : "Translate Menus, Signs & Receipts"}
              </h1>
              <p className="text-xs leading-relaxed text-[#565E58]">
                {isRtl
                  ? "التقط صورة مباشرة بكاميرا الهاتف أو اختر صورة من المعرض."
                  : "Snap a photo with your phone camera or upload one from your gallery."}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#E2DFD6] bg-[#F5F3ED] px-3.5 py-2">
            <label
              htmlFor="camera-target-lang"
              className="flex items-center gap-2 text-xs font-semibold text-[#315F4A]"
            >
              <LanguageFlag code={targetEntry.code} size={18} />
              <span>{isRtl ? "الترجمة إلى:" : "Translate into:"}</span>
            </label>
            <select
              id="camera-target-lang"
              value={targetLang}
              onChange={(e) => handleTargetChange(e.target.value)}
              className="min-h-[44px] rounded-xl border border-[#E2DFD6] bg-white px-3 text-xs font-semibold text-[#242A26] outline-none focus:border-[#315F4A]"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {isRtl
                    ? `${LANGUAGE_ARABIC_NAMES[l.code] ?? l.label} (${l.native})`
                    : `${l.label} (${l.native})`}
                </option>
              ))}
            </select>
          </div>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void handleFilePicked(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void handleFilePicked(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={loading}
              onClick={() => cameraInputRef.current?.click()}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-[#315F4A] px-4 text-xs sm:text-sm font-semibold text-white shadow-[0_6px_16px_-4px_rgba(33,69,54,0.34)] transition hover:bg-[#214536] active:scale-[0.98] disabled:opacity-60"
            >
              <CameraIcon className="w-4 h-4" />
              <span>{isRtl ? "التقاط صورة" : "Take Photo"}</span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => galleryInputRef.current?.click()}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-4 text-xs sm:text-sm font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]/65 active:scale-[0.98] disabled:opacity-60"
            >
              <UploadImageIcon className="w-4 h-4 text-[#315F4A]" />
              <span>{isRtl ? "رفع من المعرض" : "Upload Photo"}</span>
            </button>
          </div>
        </section>

        {previewUrl && (
          <div className="overflow-hidden rounded-[22px] border border-[#E2DFD6] bg-white p-2 nova-soft-shadow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt={isRtl ? "الصورة الملتقطة" : "Captured image preview"}
              className="max-h-64 w-full rounded-2xl object-contain bg-[#F5F3ED]"
            />
          </div>
        )}

        {loading && (
          <div className="rounded-[24px] border border-[#E2DFD6] bg-white p-6 text-center space-y-2 nova-card-shadow">
            <div className="mx-auto h-7 w-7 rounded-full border-2 border-[#315F4A] border-t-transparent animate-spin" />
            <p className="text-xs font-semibold text-[#315F4A]">
              {isRtl
                ? "جاري قراءة النص وترجمته بدقة..."
                : "Reading text & translating items..."}
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-[#B54F4C]/35 bg-[#C76A67]/12 p-4 text-xs font-medium text-[#9B3B38]">
            {error}
          </div>
        )}

        {!loading && result && (
          <section className="rounded-[26px] border border-[#A8BDA9] bg-white p-4 space-y-3.5 nova-card-shadow">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2DFD6] pb-3">
              <div className="min-w-0">
                <span className="inline-flex rounded-full bg-[#DCE8DD] px-2.5 py-0.5 text-[10px] font-bold text-[#214536]">
                  {result.detectedLanguage}
                </span>
                <h2 className="mt-1 text-base font-bold text-[#242A26]">
                  {result.headline}
                </h2>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSpeakSummary}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E2DFD6] bg-[#F5F3ED] px-3 text-xs font-semibold text-[#315F4A] hover:bg-[#DCE8DD]"
                >
                  <SpeakerPlayIcon className="w-4 h-4" />
                  <span>{isRtl ? "نطق" : "Speak"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyAll()}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[#315F4A] px-3 text-xs font-semibold text-white hover:bg-[#214536]"
                >
                  {copied ? (
                    <CheckIcon className="w-4 h-4" />
                  ) : (
                    <CopyIcon className="w-4 h-4" />
                  )}
                  <span>
                    {copied ? (isRtl ? "تم" : "Copied") : isRtl ? "نسخ" : "Copy"}
                  </span>
                </button>
              </div>
            </div>

            {result.summary && (
              <p
                dir={targetEntry.rtl ? "rtl" : "ltr"}
                className="rounded-2xl bg-[#F5F3ED] p-3 text-xs leading-relaxed text-[#242A26]"
              >
                {result.summary}
              </p>
            )}

            {result.items.length > 0 ? (
              <div className="space-y-2">
                {result.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-2xl border border-[#E2DFD6] bg-[#F5F3ED]/65 p-3 space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        dir={targetEntry.rtl ? "rtl" : "ltr"}
                        className="text-sm font-bold text-[#214536]"
                      >
                        {item.translated}
                      </p>
                      {item.price && (
                        <span
                          dir="ltr"
                          className="shrink-0 rounded-full bg-[#E8D8BF] px-2.5 py-0.5 text-[11px] font-bold text-[#242A26]"
                        >
                          {item.price}
                        </span>
                      )}
                    </div>
                    {item.note && (
                      <p
                        dir={targetEntry.rtl ? "rtl" : "ltr"}
                        className="text-xs text-[#565E58]"
                      >
                        {item.note}
                      </p>
                    )}
                    {item.original && (
                      <p className="text-[11px] text-[#777F79]">
                        {item.original}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              result.rawTextTranslated && (
                <pre
                  dir={targetEntry.rtl ? "rtl" : "ltr"}
                  className="whitespace-pre-wrap rounded-2xl border border-[#E2DFD6] bg-[#F5F3ED] p-3 font-sans text-xs leading-relaxed text-[#242A26]"
                >
                  {result.rawTextTranslated}
                </pre>
              )
            )}
          </section>
        )}
      </main>
    </div>
  );
}
