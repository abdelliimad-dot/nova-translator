"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraIcon,
  CloseIcon,
  QrCodeIcon,
  UploadImageIcon,
} from "@/components/nova/NovaIcons";
import { useNovaSettings } from "@/lib/settingsStore";

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDecodedRoom: (roomId: string) => void;
}

export function extractRoomIdFromQr(rawPayload: string): string | null {
  const trimmed = rawPayload.trim();
  if (!trimmed) return null;

  // 1) Match full or relative invite URL: https://.../room/UD6JM4 or /room/UD6JM4
  const pathMatch = /\/(?:room|mode-b)\/([a-zA-Z0-9]{4,12})(?:[/?#]|$)/i.exec(
    trimmed
  );
  if (pathMatch?.[1]) {
    return pathMatch[1].toUpperCase();
  }

  // 2) Match raw room code (e.g. UD6JM4)
  if (/^[a-zA-Z0-9]{4,12}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}

function decodeCanvasWithJsQr(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): string | null {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  return result?.data ?? null;
}

async function decodeImageFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not load selected image."));
      el.src = url;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    // Try high-res pass (up to 1400px) and medium pass (up to 720px) for dense phone screenshots
    for (const maxSide of [1400, 720]) {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const decoded = decodeCanvasWithJsQr(canvas, ctx);
      if (decoded) return decoded;
    }

    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function QrScannerModal({
  isOpen,
  onClose,
  onDecodedRoom,
}: QrScannerModalProps) {
  const settings = useNovaSettings();
  const isArabicUi = settings.uiLocale === "ar";

  const [cameraActive, setCameraActive] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [decodingImage, setDecodingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastScanTimeRef = useRef(0);

  const releaseHardwareCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    releaseHardwareCamera();
    setCameraActive(false);
    setStartingCamera(false);
  }, [releaseHardwareCamera]);

  const handleClose = useCallback(() => {
    stopCamera();
    setError(null);
    onClose();
  }, [onClose, stopCamera]);

  useEffect(() => {
    if (!isOpen) {
      releaseHardwareCamera();
    }
    return () => {
      releaseHardwareCamera();
    };
  }, [isOpen, releaseHardwareCamera]);

  const handleDecodedPayload = useCallback(
    (payload: string) => {
      const roomId = extractRoomIdFromQr(payload);
      if (!roomId) {
        setError(
          isArabicUi
            ? "تمت قراءة الرمز، لكنه ليس رابط أو رمز غرفة NOVA صالحًا."
            : "QR code detected, but it is not a NOVA room link or room code."
        );
        return false;
      }
      stopCamera();
      setError(null);
      onDecodedRoom(roomId);
      return true;
    },
    [isArabicUi, onDecodedRoom, stopCamera]
  );

  // Camera frame scanning loop
  useEffect(() => {
    if (!cameraActive) return;

    let cancelled = false;
    const scanLoop = (now: number) => {
      if (cancelled) return;

      const video = videoRef.current;
      if (
        video &&
        video.readyState >= video.HAVE_ENOUGH_DATA &&
        video.videoWidth > 0 &&
        now - lastScanTimeRef.current >= 120
      ) {
        lastScanTimeRef.current = now;
        if (!canvasRef.current) {
          canvasRef.current = document.createElement("canvas");
        }
        const canvas = canvasRef.current;
        const scale = Math.min(
          1,
          640 / Math.max(video.videoWidth, video.videoHeight)
        );
        const w = Math.max(1, Math.round(video.videoWidth * scale));
        const h = Math.max(1, Math.round(video.videoHeight * scale));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          const decoded = decodeCanvasWithJsQr(canvas, ctx);
          if (decoded && handleDecodedPayload(decoded)) {
            return;
          }
        }
      }

      rafRef.current = requestAnimationFrame(scanLoop);
    };

    rafRef.current = requestAnimationFrame(scanLoop);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [cameraActive, handleDecodedPayload]);

  const handleStartCamera = async () => {
    setError(null);
    stopCamera();

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError(
        isArabicUi
          ? "مسح الكاميرا يتطلب HTTPS ومتصفحًا مدعومًا. يمكنك رفع صورة QR بدلًا من ذلك."
          : "Camera scanning requires HTTPS and a supported mobile browser. Use Upload QR Image instead."
      );
      return;
    }

    setStartingCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      stopCamera();
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError(
          isArabicUi
            ? "تم رفض إذن الكاميرا. اسمح بالوصول في إعدادات المتصفح أو ارفع صورة للرمز."
            : "Camera permission was denied. Allow camera access in your browser settings or upload a QR image below."
        );
      } else if (name === "NotFoundError") {
        setError(
          isArabicUi
            ? "لم يتم العثور على كاميرا. يمكنك رفع صورة رمز QR من المعرض."
            : "No camera was found on this device. Use Upload QR Image instead."
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Could not start camera for QR scanning."
        );
      }
    } finally {
      setStartingCamera(false);
    }
  };

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    stopCamera();
    setDecodingImage(true);
    try {
      const decoded = await decodeImageFile(file);
      if (!decoded) {
        setError(
          isArabicUi
            ? "لم يتم العثور على رمز QR في الصورة. جرّب لقطة أوضح."
            : "No QR code found in that image. Try a clearer photo or screenshot."
        );
        return;
      }
      handleDecodedPayload(decoded);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to read QR code from the selected image."
      );
    } finally {
      setDecodingImage(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      dir={isArabicUi ? "rtl" : "ltr"}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#242A26]/45 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-scanner-title"
    >
      <div className="w-full max-w-md rounded-t-[28px] sm:rounded-[28px] border border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.24)] max-h-[92dvh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#E6E5DE] bg-white px-5 py-4">
          <div>
            <h2
              id="qr-scanner-title"
              className="text-base font-bold text-[#242A26]"
            >
              {isArabicUi ? "الانضمام عبر رمز QR" : "Join Room via QR Code"}
            </h2>
            <p className="text-xs text-[#777F79]">
              {isArabicUi
                ? "وجّه الكاميرا الخلفية أو ارفع صورة للرمز"
                : "Point your rear camera or upload a screenshot"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={isArabicUi ? "إغلاق الماسح" : "Close QR scanner"}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] transition hover:bg-[#DCE8DD]"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Two Clear Actions */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={startingCamera}
              onClick={() =>
                cameraActive ? stopCamera() : void handleStartCamera()
              }
              className={`inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-semibold transition active:scale-[0.98] ${
                cameraActive
                  ? "border border-[#C76A67]/40 bg-[#C76A67]/12 text-[#C76A67]"
                  : "bg-[#315F4A] text-white hover:bg-[#214536]"
              } disabled:opacity-60`}
            >
              <CameraIcon className="w-4 h-4 shrink-0" />
              <span>
                {startingCamera
                  ? isArabicUi
                    ? "جاري الفتح..."
                    : "Opening..."
                  : cameraActive
                    ? isArabicUi
                      ? "إيقاف الكاميرا"
                      : "Stop Camera"
                    : isArabicUi
                      ? "مسح بالكاميرا"
                      : "Scan Camera"}
              </span>
            </button>

            <button
              type="button"
              disabled={decodingImage}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-full border border-[#E6E5DE] bg-white px-4 py-2.5 text-xs font-semibold text-[#242A26] nova-soft-shadow transition hover:bg-[#E8D8BF]/45 active:scale-[0.98] disabled:opacity-60"
            >
              <UploadImageIcon className="w-4 h-4 shrink-0 text-[#C58B62]" />
              <span>
                {decodingImage
                  ? isArabicUi
                    ? "جاري القراءة..."
                    : "Decoding..."
                  : isArabicUi
                    ? "رفع صورة QR"
                    : "Upload QR"}
              </span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => void handleFileSelected(e)}
              className="hidden"
            />
          </div>

          {error && (
            <div className="rounded-2xl border border-[#C76A67]/40 bg-[#C76A67]/10 px-3.5 py-2.5 text-xs font-medium text-[#C76A67]">
              {error}
            </div>
          )}

          {/* Live Rear Camera Viewfinder */}
          <div className="relative overflow-hidden rounded-[22px] border border-[#E6E5DE] bg-white aspect-square flex items-center justify-center nova-soft-shadow">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`h-full w-full object-cover ${
                cameraActive ? "block" : "hidden"
              }`}
            />

            {cameraActive ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-48 w-48 rounded-2xl border-2 border-[#DCE8DD] shadow-[0_0_0_9999px_rgba(33,69,54,0.38)]" />
              </div>
            ) : (
              <div className="px-6 text-center space-y-3">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#DCE8DD] text-[#214536]">
                  <QrCodeIcon className="w-7 h-7" />
                </div>
                <p className="text-xs leading-relaxed text-[#777F79]">
                  {isArabicUi ? (
                    <>
                      اضغط <strong className="text-[#242A26]">مسح بالكاميرا</strong>{" "}
                      لتوجيهها نحو رمز شريكك، أو{" "}
                      <strong className="text-[#242A26]">رفع صورة QR</strong>{" "}
                      لاختيار لقطة شاشة.
                    </>
                  ) : (
                    <>
                      Tap <strong className="text-[#242A26]">Scan Camera</strong>{" "}
                      to aim at your partner&apos;s QR code, or tap{" "}
                      <strong className="text-[#242A26]">Upload QR</strong> to
                      pick a screenshot from your gallery.
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
