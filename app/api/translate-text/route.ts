import { GoogleGenAI } from "@google/genai";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import {
  formatGeminiApiError,
  noStoreJson,
  parseAuthenticatedJsonApi,
  STANDARD_GEMINI_MODEL,
} from "@/lib/security/apiHelpers";
import { createRateLimiter } from "@/lib/security/authCrypto";

const MAX_TEXT_BODY_BYTES = 8_192;

const textLimiterBySubject = createRateLimiter({
  maxRequests: 45,
  windowMs: 60 * 1000,
});
const textLimiterByIp = createRateLimiter({
  maxRequests: 90,
  windowMs: 60 * 1000,
});

export async function POST(request: Request) {
  const ctx = await parseAuthenticatedJsonApi<{
    text?: unknown;
    sourceLang?: unknown;
    targetLang?: unknown;
  }>(request, {
    scope: "translate-text",
    maxBytes: MAX_TEXT_BODY_BYTES,
    subjectLimiter: textLimiterBySubject,
    ipLimiter: textLimiterByIp,
  });

  if (!ctx.ok) return ctx.response;

  const { text, sourceLang, targetLang } = ctx.data;
  const trimmedText = typeof text === "string" ? text.trim() : "";

  if (!trimmedText || trimmedText.length > 2000) {
    return noStoreJson(
      { error: "Text must be between 1 and 2000 characters." },
      400
    );
  }

  const srcCode =
    typeof sourceLang === "string" ? sourceLang.trim().toLowerCase() : "";
  const tgtCode =
    typeof targetLang === "string" ? targetLang.trim().toLowerCase() : "";
  const srcEntry = SUPPORTED_LANGUAGES.find((l) => l.code === srcCode);
  const tgtEntry = SUPPORTED_LANGUAGES.find((l) => l.code === tgtCode);

  if (!srcEntry || !tgtEntry) {
    return noStoreJson({ error: "Unsupported source or target language." }, 400);
  }

  if (srcEntry.code === tgtEntry.code) {
    return noStoreJson({
      translatedText: trimmedText,
      sourceLang: srcEntry.code,
      targetLang: tgtEntry.code,
    });
  }

  const prompt = [
    `Translate the following message naturally from ${srcEntry.label} to ${tgtEntry.label}.`,
    `Preserve exact numbers, phone numbers, addresses, prices, dates, names, and negations.`,
    `Output ONLY the translated text with no quotes, markdown, or extra commentary.`,
    ``,
    trimmedText,
  ].join("\n");

  try {
    const ai = new GoogleGenAI({ apiKey: ctx.apiKey });
    const response = await ai.models.generateContent({
      model: STANDARD_GEMINI_MODEL,
      contents: prompt,
      config: { temperature: 0.2 },
    });

    const translatedText = response.text?.trim() ?? "";
    if (!translatedText) {
      return noStoreJson({ error: "Empty translation returned." }, 502);
    }

    return noStoreJson({
      translatedText,
      sourceLang: srcEntry.code,
      targetLang: tgtEntry.code,
    });
  } catch (err) {
    const info = formatGeminiApiError(
      err,
      "Text translation temporarily unavailable. Please retry."
    );
    console.error("[TranslateText] Gemini request failed:", info.logDetail);
    return noStoreJson({ error: info.userMessage }, info.status);
  }
}
