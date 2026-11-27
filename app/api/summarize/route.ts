import { GoogleGenAI } from "@google/genai";
import {
  extractJsonObject,
  formatGeminiApiError,
  noStoreJson,
  parseAuthenticatedJsonApi,
  STANDARD_GEMINI_MODEL,
} from "@/lib/security/apiHelpers";
import { createRateLimiter } from "@/lib/security/authCrypto";

const MAX_SUMMARY_BODY_BYTES = 65_536;

const summaryLimiterBySubject = createRateLimiter({
  maxRequests: 20,
  windowMs: 60 * 1000,
});
const summaryLimiterByIp = createRateLimiter({
  maxRequests: 40,
  windowMs: 60 * 1000,
});

export interface ConversationSummaryPayload {
  title: string;
  summary: string;
  keyPoints: string[];
  pricesAndNumbers: string[];
  timesAndPlaces: string[];
  decisions: string[];
}

export async function POST(request: Request) {
  const ctx = await parseAuthenticatedJsonApi<{
    turns?: unknown;
    uiLocale?: unknown;
    langALabel?: unknown;
    langBLabel?: unknown;
  }>(request, {
    scope: "summarize",
    maxBytes: MAX_SUMMARY_BODY_BYTES,
    subjectLimiter: summaryLimiterBySubject,
    ipLimiter: summaryLimiterByIp,
  });

  if (!ctx.ok) return ctx.response;

  const { turns, uiLocale, langALabel, langBLabel } = ctx.data;
  if (!Array.isArray(turns) || turns.length === 0) {
    return noStoreJson(
      { error: "At least one conversation turn is required to summarize." },
      400
    );
  }

  const cleanLines = turns
    .slice(-120)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const t = item as {
        speakerLabel?: unknown;
        sourceText?: unknown;
        translatedText?: unknown;
      };
      const label =
        typeof t.speakerLabel === "string" ? t.speakerLabel.slice(0, 80) : "Speaker";
      const src =
        typeof t.sourceText === "string" ? t.sourceText.trim().slice(0, 600) : "";
      const trn =
        typeof t.translatedText === "string"
          ? t.translatedText.trim().slice(0, 600)
          : "";
      if (!src && !trn) return null;
      return `[${label}] ${src}${trn ? ` -> ${trn}` : ""}`;
    })
    .filter((x): x is string => Boolean(x));

  if (cleanLines.length === 0) {
    return noStoreJson({ error: "No valid transcript text to summarize." }, 400);
  }

  const outLang = uiLocale === "ar" ? "Arabic" : "English";
  const pairDesc =
    typeof langALabel === "string" && typeof langBLabel === "string"
      ? `${langALabel} <-> ${langBLabel}`
      : "bilingual conversation";

  const prompt = [
    `Summarize this ${pairDesc} conversation concisely in ${outLang}.`,
    `Extract only facts explicitly stated in the transcript—never invent prices, addresses, or decisions.`,
    `Return ONLY valid JSON with this exact schema:`,
    `{`,
    `  "title": "Short 3-6 word topic title in ${outLang}",`,
    `  "summary": "2-3 sentence summary in ${outLang}",`,
    `  "keyPoints": ["Concise takeaway bullets in ${outLang}"],`,
    `  "pricesAndNumbers": ["Exact prices, amounts, phone numbers, codes mentioned (empty [] if none)"],`,
    `  "timesAndPlaces": ["Exact times, dates, addresses, landmarks mentioned (empty [] if none)"],`,
    `  "decisions": ["Agreements, action items, or next steps (empty [] if none)"]`,
    `}`,
    ``,
    `Transcript:`,
    cleanLines.join("\n"),
  ].join("\n");

  const normalizeList = (raw: unknown): string[] =>
    Array.isArray(raw)
      ? raw
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
          .slice(0, 12)
      : [];

  try {
    const ai = new GoogleGenAI({ apiKey: ctx.apiKey });
    const response = await ai.models.generateContent({
      model: STANDARD_GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim() ?? "";
    if (!text) {
      return noStoreJson({ error: "Empty summary returned." }, 502);
    }

    const json = extractJsonObject<Partial<ConversationSummaryPayload>>(text);
    const summaryData: ConversationSummaryPayload = json
      ? {
          title:
            typeof json.title === "string" && json.title.trim()
              ? json.title.trim()
              : outLang === "Arabic"
                ? "ملخص المحادثة"
                : "Conversation Summary",
          summary: typeof json.summary === "string" ? json.summary.trim() : text,
          keyPoints: normalizeList(json.keyPoints),
          pricesAndNumbers: normalizeList(json.pricesAndNumbers),
          timesAndPlaces: normalizeList(json.timesAndPlaces),
          decisions: normalizeList(json.decisions),
        }
      : {
          title: outLang === "Arabic" ? "ملخص المحادثة" : "Conversation Summary",
          summary: text,
          keyPoints: [],
          pricesAndNumbers: [],
          timesAndPlaces: [],
          decisions: [],
        };

    return noStoreJson(summaryData);
  } catch (err) {
    const info = formatGeminiApiError(
      err,
      "Conversation summary temporarily unavailable."
    );
    console.error("[Summarize] Gemini request failed:", info.logDetail);
    return noStoreJson({ error: info.userMessage }, info.status);
  }
}
