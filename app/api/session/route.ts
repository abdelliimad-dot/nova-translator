import { GoogleGenAI, Modality } from "@google/genai";
import { NextResponse } from "next/server";
import { buildInterpreterSystemPrompt } from "@/lib/languages";

const DEFAULT_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL || "models/gemini-2.5-flash-native-audio-latest";

const ALLOWED_VOICES = new Set(["Aoede", "Kore", "Puck", "Charon", "Fenrir"]);

function sanitizeVoiceName(value: unknown): string {
  if (typeof value === "string" && ALLOWED_VOICES.has(value)) {
    return value;
  }
  return "Aoede";
}

function sanitizeLanguageName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[^\p{L}\p{N}\s\-()]/gu, "").trim();
  if (!cleaned || cleaned.length > 48) return fallback;
  return cleaned;
}

/**
 * BFF Session Endpoint:
 * Mints a short-lived constrained Ephemeral Token using GEMINI_API_KEY on the server.
 * The raw GEMINI_API_KEY is never sent to the browser.
 */
export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is missing on the server." },
      { status: 500 }
    );
  }

  let body: { langA?: unknown; langB?: unknown; voiceName?: unknown } = {};
  try {
    body = (await request.json()) as {
      langA?: unknown;
      langB?: unknown;
      voiceName?: unknown;
    };
  } catch {
    // Allow empty body -> defaults
  }

  const langA = sanitizeLanguageName(body.langA, "Arabic");
  const langB = sanitizeLanguageName(body.langB, "English");
  const voiceName = sanitizeVoiceName(body.voiceName);
  const systemInstruction = buildInterpreterSystemPrompt(langA, langB);
  const model = DEFAULT_LIVE_MODEL;

  const now = Date.now();
  const expireTime = new Date(now + 15 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 90 * 1000).toISOString();

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            temperature: 0.35,
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            thinkingConfig: {
              thinkingBudget: 0,
            },
            contextWindowCompression: {
              triggerTokens: "12000",
              slidingWindow: {
                targetTokens: "4000",
              },
            },
            systemInstruction,
          },
        },
      },
    });

    if (!token.name) {
      return NextResponse.json(
        { error: "Failed to mint ephemeral session token." },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        token: token.name,
        model,
        expiresAt: expireTime,
        langA,
        langB,
        voiceName,
        systemInstruction,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to initialize Gemini session.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
