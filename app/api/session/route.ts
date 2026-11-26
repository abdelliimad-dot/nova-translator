import { GoogleGenAI, Modality } from "@google/genai";
import { NextResponse } from "next/server";
import {
  SUPPORTED_LANGUAGES,
  buildInterpreterSystemPrompt,
} from "@/lib/languages";
import {
  AuthConfigurationError,
  createRateLimiter,
  getClientIp,
  getClientSidFromRequest,
  getRoomAuthFromRequest,
  hashRateLimitKey,
  readBoundedJsonBody,
} from "@/lib/security/authCrypto";

const DEFAULT_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL ||
  "models/gemini-2.5-flash-native-audio-latest";

const ALLOWED_VOICES = new Set(["Aoede", "Kore", "Puck", "Charon", "Fenrir"]);
const MAX_SESSION_BODY_BYTES = 2048;

// Single-process sliding-window rate limiters (non-durable across replicas).
const sessionLimiterBySubject = createRateLimiter({
  maxRequests: 15,
  windowMs: 60 * 1000,
});
const sessionLimiterByIp = createRateLimiter({
  maxRequests: 35,
  windowMs: 60 * 1000,
});

function noStoreJson(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

/**
 * BFF Session Endpoint:
 * Mints a short-lived constrained Ephemeral Token using GEMINI_API_KEY on the server.
 * Requires a verified signed anonymous client session (`nova_client_sid`) or
 * verified Mode B room participant credential (`nova_room_auth`).
 */
export async function POST(request: Request) {
  let clientSid: ReturnType<typeof getClientSidFromRequest> = null;
  let roomAuth: ReturnType<typeof getRoomAuthFromRequest> = null;
  let ipBucketKey: string;
  try {
    clientSid = getClientSidFromRequest(request);
    roomAuth = clientSid ? null : getRoomAuthFromRequest(request);
    ipBucketKey = hashRateLimitKey("session-ip", getClientIp(request));
  } catch (err) {
    if (err instanceof AuthConfigurationError) {
      console.error(err.message);
      return noStoreJson(
        { error: "Server security configuration error." },
        503
      );
    }
    throw err;
  }

  if (!clientSid && !roomAuth) {
    return noStoreJson(
      { error: "Authentication required to start a translation session." },
      401
    );
  }

  const subjectKey = clientSid
    ? `sid:${clientSid.sid}`
    : `room:${roomAuth!.roomId}:${roomAuth!.credId}`;

  const subjectLimit = sessionLimiterBySubject.check(subjectKey);
  if (!subjectLimit.allowed) {
    return noStoreJson(
      { error: "Too many session requests. Please wait a moment and retry." },
      429,
      { "Retry-After": String(subjectLimit.retryAfterSeconds) }
    );
  }

  const ipLimit = sessionLimiterByIp.check(ipBucketKey);
  if (!ipLimit.allowed) {
    return noStoreJson(
      { error: "Too many requests from this network. Please retry shortly." },
      429,
      { "Retry-After": String(ipLimit.retryAfterSeconds) }
    );
  }

  const parsed = await readBoundedJsonBody<{
    langA?: unknown;
    langB?: unknown;
    voiceName?: unknown;
  }>(request, MAX_SESSION_BODY_BYTES);

  if (!parsed.ok) {
    return noStoreJson({ error: parsed.error }, parsed.status);
  }

  const { langA: rawLangA, langB: rawLangB, voiceName: rawVoice } = parsed.data;

  if (typeof rawLangA !== "string" || typeof rawLangB !== "string") {
    return noStoreJson(
      { error: "Both langA and langB language codes are required." },
      400
    );
  }

  const codeA = rawLangA.trim().toLowerCase();
  const codeB = rawLangB.trim().toLowerCase();

  const langEntryA = SUPPORTED_LANGUAGES.find((lang) => lang.code === codeA);
  const langEntryB = SUPPORTED_LANGUAGES.find((lang) => lang.code === codeB);

  if (!langEntryA || !langEntryB) {
    return noStoreJson(
      { error: "Unsupported language code specified." },
      400
    );
  }

  let voiceName = "Aoede";
  if (rawVoice !== undefined) {
    if (typeof rawVoice !== "string" || !ALLOWED_VOICES.has(rawVoice)) {
      return noStoreJson({ error: "Unsupported voice selection." }, 400);
    }
    voiceName = rawVoice;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return noStoreJson(
      { error: "Translation service is temporarily unavailable." },
      503
    );
  }

  const systemInstruction = buildInterpreterSystemPrompt(
    langEntryA.label,
    langEntryB.label
  );

  const now = Date.now();
  const expireTime = new Date(now + 10 * 60 * 1000).toISOString(); // 10 minutes
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString(); // 60 seconds
  const model = DEFAULT_LIVE_MODEL;

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
        lockAdditionalFields: [
          "tools",
          "safetySettings",
          "realtimeInputConfig",
          "generationConfig",
          "proactivity",
        ],
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
      return noStoreJson(
        { error: "Failed to initialize translation session." },
        502
      );
    }

    return noStoreJson({
      token: token.name,
      model,
      expiresAt: expireTime,
      langA: langEntryA.code,
      langB: langEntryB.code,
      voiceName,
      systemInstruction,
    });
  } catch (err) {
    console.error(
      "[Session] Ephemeral token creation failed:",
      err instanceof Error ? err.name : "UnknownError"
    );
    return noStoreJson(
      { error: "Failed to initialize translation session." },
      502
    );
  }
}
