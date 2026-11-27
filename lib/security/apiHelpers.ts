import { NextResponse } from "next/server";
import {
  AuthConfigurationError,
  createRateLimiter,
  getClientIp,
  getClientSidFromRequest,
  getRoomAuthFromRequest,
  hashRateLimitKey,
  readBoundedJsonBody,
} from "@/lib/security/authCrypto";

export const STANDARD_GEMINI_MODEL =
  process.env.GEMINI_STANDARD_MODEL?.trim() || "gemini-3.8-flash";

export const STANDARD_GEMINI_FALLBACK_MODELS = [
  STANDARD_GEMINI_MODEL,
  "gemini-3.7-flash",
  "gemini-3.5-flash",
] as const;

/**
 * Strips markdown code fences (```json ... ```) and safely parses the JSON object,
 * returning null if Gemini responded with plain text instead of strict JSON.
 */
export function extractJsonObject<T>(rawText: string): T | null {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function formatGeminiApiError(
  err: unknown,
  fallbackMessage: string
): { status: number; userMessage: string; logDetail: string } {
  const statusRaw =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : NaN;
  const name = err instanceof Error ? err.name : "UnknownError";
  const rawMsg = err instanceof Error ? err.message : String(err ?? "");
  const safeDetail = rawMsg.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]").slice(0, 180);

  if (statusRaw === 429) {
    return {
      status: 429,
      userMessage: "Translation service is busy right now. Please wait a moment and retry.",
      logDetail: `${name} (429): ${safeDetail}`,
    };
  }
  if (statusRaw === 400) {
    return {
      status: 400,
      userMessage: "The submitted content or image could not be processed. Try another photo.",
      logDetail: `${name} (400): ${safeDetail}`,
    };
  }
  if (statusRaw === 404) {
    return {
      status: 502,
      userMessage: "Configured AI model is unavailable. Please retry shortly.",
      logDetail: `${name} (404): ${safeDetail}`,
    };
  }

  return {
    status: 502,
    userMessage: fallbackMessage,
    logDetail: `${name}${Number.isFinite(statusRaw) ? ` (${statusRaw})` : ""}: ${safeDetail}`,
  };
}

export function noStoreJson(
  body: unknown,
  status = 200,
  extraHeaders?: HeadersInit
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

type SlidingLimiter = ReturnType<typeof createRateLimiter>;

export type AuthenticatedApiContext<T> =
  | { ok: true; data: T; apiKey: string }
  | { ok: false; response: NextResponse };

/**
 * Validates anonymous client session (`nova_client_sid`) or room auth (`nova_room_auth`),
 * enforces subject + IP rate limits, parses a bounded JSON body, and resolves GEMINI_API_KEY.
 */
export async function parseAuthenticatedJsonApi<T>(
  request: Request,
  options: {
    scope: string;
    maxBytes: number;
    subjectLimiter: SlidingLimiter;
    ipLimiter: SlidingLimiter;
  }
): Promise<AuthenticatedApiContext<T>> {
  let clientSid: ReturnType<typeof getClientSidFromRequest> = null;
  let roomAuth: ReturnType<typeof getRoomAuthFromRequest> = null;
  let ipBucketKey: string;

  try {
    clientSid = getClientSidFromRequest(request);
    roomAuth = clientSid ? null : getRoomAuthFromRequest(request);
    ipBucketKey = hashRateLimitKey(`${options.scope}-ip`, getClientIp(request));
  } catch (err) {
    if (err instanceof AuthConfigurationError) {
      console.error(err.message);
      return {
        ok: false,
        response: noStoreJson(
          { error: "Server security configuration error." },
          503
        ),
      };
    }
    throw err;
  }

  if (!clientSid && !roomAuth) {
    return {
      ok: false,
      response: noStoreJson(
        { error: "Authentication required for NOVA translation services." },
        401
      ),
    };
  }

  const subjectKey = clientSid
    ? `${options.scope}:sid:${clientSid.sid}`
    : `${options.scope}:room:${roomAuth!.roomId}:${roomAuth!.credId}`;

  const subjectCheck = options.subjectLimiter.check(subjectKey);
  if (!subjectCheck.allowed) {
    return {
      ok: false,
      response: noStoreJson(
        { error: "Too many requests. Please wait a moment and retry." },
        429,
        { "Retry-After": String(subjectCheck.retryAfterSeconds) }
      ),
    };
  }

  const ipCheck = options.ipLimiter.check(ipBucketKey);
  if (!ipCheck.allowed) {
    return {
      ok: false,
      response: noStoreJson(
        { error: "Too many requests from this network. Please retry shortly." },
        429,
        { "Retry-After": String(ipCheck.retryAfterSeconds) }
      ),
    };
  }

  const parsed = await readBoundedJsonBody<T>(request, options.maxBytes);
  if (!parsed.ok) {
    return {
      ok: false,
      response: noStoreJson({ error: parsed.error }, parsed.status),
    };
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      response: noStoreJson(
        { error: "Translation service is temporarily unavailable." },
        503
      ),
    };
  }

  return { ok: true, data: parsed.data, apiKey };
}
