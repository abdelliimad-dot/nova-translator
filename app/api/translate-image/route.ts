import { GoogleGenAI } from "@google/genai";
import { findLanguage, SUPPORTED_LANGUAGES } from "@/lib/languages";
import {
  extractJsonObject,
  formatGeminiApiError,
  noStoreJson,
  parseAuthenticatedJsonApi,
  STANDARD_GEMINI_MODEL,
} from "@/lib/security/apiHelpers";
import { createRateLimiter } from "@/lib/security/authCrypto";

const MAX_IMAGE_BODY_BYTES = 4_500_000; // ~4.5 MB JSON payload
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const imageLimiterBySubject = createRateLimiter({
  maxRequests: 20,
  windowMs: 60 * 1000,
});
const imageLimiterByIp = createRateLimiter({
  maxRequests: 40,
  windowMs: 60 * 1000,
});

interface ImageTranslationResult {
  detectedLanguage: string;
  headline: string;
  summary: string;
  items: Array<{
    original: string;
    translated: string;
    note?: string;
    price?: string;
  }>;
  rawTextTranslated: string;
}

export async function POST(request: Request) {
  const ctx = await parseAuthenticatedJsonApi<{
    imageBase64?: unknown;
    mimeType?: unknown;
    targetLang?: unknown;
    sourceLang?: unknown;
  }>(request, {
    scope: "translate-image",
    maxBytes: MAX_IMAGE_BODY_BYTES,
    subjectLimiter: imageLimiterBySubject,
    ipLimiter: imageLimiterByIp,
  });

  if (!ctx.ok) return ctx.response;

  const { imageBase64, mimeType, targetLang, sourceLang } = ctx.data;

  if (typeof imageBase64 !== "string" || imageBase64.trim().length < 32) {
    return noStoreJson({ error: "A valid image payload is required." }, 400);
  }

  const cleanMime =
    typeof mimeType === "string"
      ? mimeType.trim().toLowerCase()
      : "image/jpeg";
  if (!ALLOWED_MIME_TYPES.has(cleanMime)) {
    return noStoreJson({ error: "Unsupported image format." }, 400);
  }

  if (typeof targetLang !== "string" || !targetLang.trim()) {
    return noStoreJson({ error: "Target language is required." }, 400);
  }

  const targetCode = targetLang.trim().toLowerCase();
  const targetEntry = SUPPORTED_LANGUAGES.find((l) => l.code === targetCode);
  if (!targetEntry) {
    return noStoreJson({ error: "Unsupported target language." }, 400);
  }

  const sourceHint =
    typeof sourceLang === "string" && sourceLang.trim() && sourceLang !== "auto"
      ? findLanguage(sourceLang).label
      : "auto-detect";

  // Strip optional data-URL prefix and whitespace that mobile encoders may insert
  const rawBase64 = imageBase64
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/\s+/g, "")
    .trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(rawBase64)) {
    return noStoreJson({ error: "Image payload must be valid base64." }, 400);
  }

  const prompt = [
    `You are NOVA's visual translator for menus, street signs, labels, and receipts.`,
    `Source language hint: ${sourceHint}. Target language: ${targetEntry.label}.`,
    `Read all visible text in the image accurately and translate it naturally into ${targetEntry.label}.`,
    `Return ONLY valid JSON with this exact schema:`,
    `{`,
    `  "detectedLanguage": "Name of detected source language",`,
    `  "headline": "Short 2-6 word category title in ${targetEntry.label} (e.g. Restaurant Menu, Street Sign, Pharmacy Label)",`,
    `  "summary": "1-2 clear sentences in ${targetEntry.label} summarizing what the image shows",`,
    `  "items": [`,
    `    { "original": "Original line or dish name", "translated": "Natural translation in ${targetEntry.label}", "note": "Brief helpful explanation if dish/term/instruction needs context, otherwise empty string", "price": "Price/number if shown, otherwise empty string" }`,
    `  ],`,
    `  "rawTextTranslated": "Clean multi-line full translation fallback in ${targetEntry.label}"`,
    `}`,
    `If no readable text is present, set "items" to [] and explain clearly in "summary". Preserve every number, currency, date, and warning accurately.`,
  ].join("\n");

  try {
    const ai = new GoogleGenAI({ apiKey: ctx.apiKey });
    const response = await ai.models.generateContent({
      model: STANDARD_GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: cleanMime === "image/jpg" ? "image/jpeg" : cleanMime,
                data: rawBase64,
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim() ?? "";
    if (!text) {
      return noStoreJson(
        { error: "No translation could be extracted from this image." },
        502
      );
    }

    const json = extractJsonObject<Partial<ImageTranslationResult>>(text);
    const parsed: ImageTranslationResult = json
      ? {
          detectedLanguage:
            typeof json.detectedLanguage === "string" && json.detectedLanguage
              ? json.detectedLanguage
              : "Detected text",
          headline:
            typeof json.headline === "string" && json.headline
              ? json.headline
              : targetEntry.label,
          summary: typeof json.summary === "string" ? json.summary : "",
          items: Array.isArray(json.items)
            ? json.items
                .filter((x) => x && typeof x === "object")
                .slice(0, 60)
                .map((x) => ({
                  original: typeof x.original === "string" ? x.original : "",
                  translated:
                    typeof x.translated === "string" ? x.translated : "",
                  note: typeof x.note === "string" ? x.note : "",
                  price: typeof x.price === "string" ? x.price : "",
                }))
            : [],
          rawTextTranslated:
            typeof json.rawTextTranslated === "string"
              ? json.rawTextTranslated
              : "",
        }
      : {
          detectedLanguage: sourceHint,
          headline: targetEntry.label,
          summary: text,
          items: [],
          rawTextTranslated: text,
        };

    return noStoreJson({
      ...parsed,
      targetLang: targetEntry.code,
    });
  } catch (err) {
    const info = formatGeminiApiError(
      err,
      "Image translation temporarily unavailable. Please retry."
    );
    console.error("[TranslateImage] Gemini request failed:", info.logDetail);
    return noStoreJson({ error: info.userMessage }, info.status);
  }
}
