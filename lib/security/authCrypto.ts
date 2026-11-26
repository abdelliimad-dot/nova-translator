import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";

export const CLIENT_SID_COOKIE = "nova_client_sid";
export const ROOM_AUTH_COOKIE = "nova_room_auth";

export const CLIENT_SID_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const ROOM_AUTH_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
export const MIN_AUTH_SECRET_LENGTH = 32;

export interface ClientSidPayload {
  v: 1;
  typ: "sid";
  sid: string;
  iat: number;
  exp: number;
}

export interface RoomAuthPayload {
  v: 1;
  typ: "room";
  roomId: string;
  role: "host" | "guest";
  credId: string;
  iat: number;
  exp: number;
}

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

const WEAK_PLACEHOLDER_PATTERNS = [
  "replace_with",
  "your_secret",
  "your_api_key",
  "changeme",
  "nova_auth_secret",
  "example",
  "default_secret",
];

function isWeakSecretValue(secret: string): boolean {
  const lower = secret.toLowerCase();
  if (WEAK_PLACEHOLDER_PATTERNS.some((p) => lower.includes(p))) {
    return true;
  }
  // Reject trivial single-character or tiny-alphabet repeats
  const uniqueChars = new Set(secret);
  return uniqueChars.size < 8;
}

function deriveHmacKey(rawSecret: string): Buffer {
  return createHmac("sha256", "nova-auth-kdf-v1")
    .update(rawSecret)
    .digest();
}

const globalForAuth = globalThis as unknown as {
  __novaDevEphemeralAuthSecret?: Buffer;
  __novaWarnedDevSecret?: boolean;
};

/**
 * Validate `NOVA_AUTH_SECRET` strictly in production mode.
 * Throws `AuthConfigurationError` if missing, shorter than 32 chars, or weak.
 */
export function assertProductionAuthSecret(): void {
  if (process.env.NODE_ENV !== "production") return;

  const configured = process.env.NOVA_AUTH_SECRET?.trim() ?? "";
  if (!configured) {
    throw new AuthConfigurationError(
      "[NOVA Security] FATAL: NOVA_AUTH_SECRET environment variable is required in production."
    );
  }
  if (configured.length < MIN_AUTH_SECRET_LENGTH) {
    throw new AuthConfigurationError(
      `[NOVA Security] FATAL: NOVA_AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters in production.`
    );
  }
  if (isWeakSecretValue(configured)) {
    throw new AuthConfigurationError(
      "[NOVA Security] FATAL: NOVA_AUTH_SECRET is too weak or uses a placeholder value."
    );
  }
}

/**
 * Resolve the active primary HMAC signing key.
 * - Production: strictly requires valid `NOVA_AUTH_SECRET` (throws `AuthConfigurationError`).
 * - Development/test: uses `NOVA_AUTH_SECRET` if valid, otherwise a process-local CSPRNG key.
 */
function getPrimarySigningKey(): Buffer {
  const configured = process.env.NOVA_AUTH_SECRET?.trim() ?? "";
  if (
    configured.length >= MIN_AUTH_SECRET_LENGTH &&
    !isWeakSecretValue(configured)
  ) {
    return deriveHmacKey(configured);
  }

  if (process.env.NODE_ENV === "production") {
    assertProductionAuthSecret();
    // Unreachable, satisfies TypeScript narrowing
    throw new AuthConfigurationError(
      "[NOVA Security] Missing valid NOVA_AUTH_SECRET in production."
    );
  }

  if (!globalForAuth.__novaDevEphemeralAuthSecret) {
    globalForAuth.__novaDevEphemeralAuthSecret = randomBytes(32);
    if (!globalForAuth.__novaWarnedDevSecret) {
      globalForAuth.__novaWarnedDevSecret = true;
      console.warn(
        "[Security] Dev mode: NOVA_AUTH_SECRET not configured; using process-local CSPRNG key."
      );
    }
  }
  return globalForAuth.__novaDevEphemeralAuthSecret;
}

/**
 * Optional previous key for zero-downtime key rotation via `NOVA_AUTH_SECRET_PREVIOUS`.
 */
function getPreviousSigningKey(): Buffer | null {
  const prev = process.env.NOVA_AUTH_SECRET_PREVIOUS?.trim() ?? "";
  if (prev.length < MIN_AUTH_SECRET_LENGTH || isWeakSecretValue(prev)) {
    return null;
  }
  return deriveHmacKey(prev);
}

function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function fromBase64Url(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  try {
    return Buffer.from(input, "base64url");
  } catch {
    return null;
  }
}

/**
 * Constant-time string comparison via SHA-256 normalization + timingSafeEqual.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const hashA = createHmac("sha256", "nova-ct-cmp-v1").update(a).digest();
  const hashB = createHmac("sha256", "nova-ct-cmp-v1").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Derive a privacy-preserving, non-reversible rate-limit key hash so raw IP
 * addresses are not retained in memory or logs.
 */
export function hashRateLimitKey(namespace: string, identifier: string): string {
  return `${namespace}:${createHmac("sha256", getPrimarySigningKey())
    .update(`${namespace}:${identifier}`)
    .digest("base64url")
    .slice(0, 24)}`;
}

/**
 * Sign a structured payload as `<base64url(json)>.<base64url(hmac-sha256)>`.
 */
export function signToken<T extends object>(payload: T): string {
  const body = toBase64Url(JSON.stringify(payload));
  const sig = toBase64Url(
    createHmac("sha256", getPrimarySigningKey()).update(body).digest()
  );
  return `${body}.${sig}`;
}

export interface VerifiedTokenResult<T> {
  payload: T;
  usedPreviousKey: boolean;
}

function verifyWithSpecificKey<T extends { exp?: number }>(
  body: string,
  actualSigBuf: Buffer,
  key: Buffer
): T | null {
  const expectedSigBuf = createHmac("sha256", key).update(body).digest();
  if (actualSigBuf.length !== expectedSigBuf.length) {
    return null;
  }
  if (!timingSafeEqual(expectedSigBuf, actualSigBuf)) {
    return null;
  }

  const decoded = fromBase64Url(body);
  if (!decoded) return null;

  try {
    const parsed = JSON.parse(decoded.toString("utf8")) as T;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.exp !== "number" || Date.now() >= parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Verify an HMAC-signed token against active (and optionally previous rotation) key.
 */
export function verifyTokenWithRotation<T extends { exp?: number }>(
  token: string | undefined | null
): VerifiedTokenResult<T> | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  if (!body || !sig || body.length > 4096 || sig.length > 128) return null;

  const actualSigBuf = fromBase64Url(sig);
  if (!actualSigBuf) return null;

  const primaryKey = getPrimarySigningKey();
  const primaryPayload = verifyWithSpecificKey<T>(body, actualSigBuf, primaryKey);
  if (primaryPayload) {
    return { payload: primaryPayload, usedPreviousKey: false };
  }

  const previousKey = getPreviousSigningKey();
  if (previousKey) {
    const previousPayload = verifyWithSpecificKey<T>(
      body,
      actualSigBuf,
      previousKey
    );
    if (previousPayload) {
      return { payload: previousPayload, usedPreviousKey: true };
    }
  }

  return null;
}

export function verifyToken<T extends { exp?: number }>(
  token: string | undefined | null
): T | null {
  return verifyTokenWithRotation<T>(token)?.payload ?? null;
}

export function issueClientSidToken(
  ttlMs = CLIENT_SID_TTL_MS
): { token: string; payload: ClientSidPayload } {
  const now = Date.now();
  const payload: ClientSidPayload = {
    v: 1,
    typ: "sid",
    sid: randomBytes(16).toString("base64url"),
    iat: now,
    exp: now + ttlMs,
  };
  return { token: signToken(payload), payload };
}

export function verifyClientSidTokenWithMeta(
  token: string | undefined | null
): VerifiedTokenResult<ClientSidPayload> | null {
  const result = verifyTokenWithRotation<ClientSidPayload>(token);
  if (!result) return null;
  const { payload } = result;
  if (payload.v !== 1 || payload.typ !== "sid") return null;
  if (typeof payload.sid !== "string" || payload.sid.length < 16) return null;
  return result;
}

export function verifyClientSidToken(
  token: string | undefined | null
): ClientSidPayload | null {
  return verifyClientSidTokenWithMeta(token)?.payload ?? null;
}

export function issueRoomAuthToken(
  roomId: string,
  role: "host" | "guest",
  credId: string,
  ttlMs = ROOM_AUTH_TTL_MS
): { token: string; payload: RoomAuthPayload } {
  const now = Date.now();
  const payload: RoomAuthPayload = {
    v: 1,
    typ: "room",
    roomId,
    role,
    credId,
    iat: now,
    exp: now + ttlMs,
  };
  return { token: signToken(payload), payload };
}

export function verifyRoomAuthToken(
  token: string | undefined | null,
  expectedRoomId?: string
): RoomAuthPayload | null {
  const payload = verifyToken<RoomAuthPayload>(token);
  if (!payload || payload.v !== 1 || payload.typ !== "room") return null;
  if (payload.role !== "host" && payload.role !== "guest") return null;
  if (typeof payload.roomId !== "string" || !payload.roomId) return null;
  if (typeof payload.credId !== "string" || payload.credId.length < 8) {
    return null;
  }
  if (expectedRoomId && payload.roomId !== expectedRoomId) return null;
  return payload;
}

/**
 * Parse a named cookie value from an HTTP `Cookie` request header cleanly.
 */
export function getCookieFromHeader(
  cookieHeader: string | null,
  cookieName: string
): string | null {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex <= 0) continue;
    const name = pair.slice(0, eqIndex).trim();
    if (name !== cookieName) continue;
    const rawValue = pair.slice(eqIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

export function getClientSidFromRequest(
  request: Request
): ClientSidPayload | null {
  const raw = getCookieFromHeader(
    request.headers.get("cookie"),
    CLIENT_SID_COOKIE
  );
  return verifyClientSidToken(raw);
}

export function getRoomAuthFromRequest(
  request: Request,
  expectedRoomId?: string
): RoomAuthPayload | null {
  const raw = getCookieFromHeader(
    request.headers.get("cookie"),
    ROOM_AUTH_COOKIE
  );
  return verifyRoomAuthToken(raw, expectedRoomId);
}

/**
 * Parse and validate an IPv4/IPv6 candidate from proxy headers (strips optional
 * brackets/port suffixes cleanly and normalizes IPv4-mapped IPv6 addresses).
 */
export function normalizeIpCandidate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let candidate = raw.trim();
  if (!candidate || candidate.length > 96) return null;

  // Handle quoted or bracketed [IPv6]:port forms
  if (candidate.startsWith("[")) {
    const closeIdx = candidate.indexOf("]");
    if (closeIdx <= 1) return null;
    candidate = candidate.slice(1, closeIdx);
  } else {
    // Strip IPv4:port (exactly one colon and valid dotted quad before it)
    const firstColon = candidate.indexOf(":");
    const lastColon = candidate.lastIndexOf(":");
    if (firstColon > 0 && firstColon === lastColon) {
      const maybeV4 = candidate.slice(0, firstColon);
      if (isIP(maybeV4) === 4) {
        candidate = maybeV4;
      }
    }
  }

  const version = isIP(candidate);
  if (version === 0) return null;

  const lower = candidate.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const mappedV4 = lower.slice(7);
    if (isIP(mappedV4) === 4) return mappedV4;
  }

  return lower;
}

/**
 * Fallback rate-limit bucket used when no trustworthy proxy IP header exists.
 * Coalesces untrusted/headerless callers onto a single bounded key so attackers
 * cannot evade rate limiting by omitting headers or forging custom proxy headers.
 */
export const UNATTRIBUTED_IP_BUCKET = "unattributed-client";

/**
 * Extract a trustworthy client IP identifier for rate limiting.
 *
 * Security model:
 * - Never trusts client-spoofable `CF-Connecting-IP` or `X-Real-IP` unless
 *   explicitly enabled via `NOVA_TRUST_CLOUDFLARE_PROXY=true` or
 *   `NOVA_TRUST_X_REAL_IP=true`.
 * - On Railway / Envoy / standard multi-hop edge proxies, inspects
 *   `X-Forwarded-For` from the RIGHTMOST trusted proxy hop boundary
 *   (`NOVA_TRUSTED_PROXY_HOPS`, default `1`), immune to spoofed leftmost entries.
 * - Rejects malformed strings and falls back safely to `UNATTRIBUTED_IP_BUCKET`
 *   so rate limiting can never be silently bypassed or disabled.
 */
export function getClientIp(request: Request): string {
  const trustCloudflare =
    process.env.NOVA_TRUST_CLOUDFLARE_PROXY?.trim().toLowerCase() === "true";
  if (trustCloudflare) {
    const cfIp = normalizeIpCandidate(request.headers.get("cf-connecting-ip"));
    if (cfIp) return cfIp;
  }

  const trustXRealIp =
    process.env.NOVA_TRUST_X_REAL_IP?.trim().toLowerCase() === "true";
  if (trustXRealIp) {
    const realIp = normalizeIpCandidate(request.headers.get("x-real-ip"));
    if (realIp) return realIp;
  }

  const hopsRaw = Number(process.env.NOVA_TRUSTED_PROXY_HOPS ?? "1");
  const trustedProxyHops =
    Number.isFinite(hopsRaw) && hopsRaw >= 1
      ? Math.min(10, Math.floor(hopsRaw))
      : 1;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parsedHops = forwarded
      .split(",")
      .map((s) => normalizeIpCandidate(s))
      .filter((ip): ip is string => ip !== null);

    if (parsedHops.length > 0) {
      const targetIndex = Math.max(0, parsedHops.length - trustedProxyHops);
      return parsedHops[targetIndex];
    }
  }

  return UNATTRIBUTED_IP_BUCKET;
}

export function isHttpsRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    const hops = forwardedProto
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (hops.length > 0) {
      return hops[hops.length - 1] === "https";
    }
  }
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  path?: string;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (typeof options.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }
  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Generate a URL-safe cryptographically random token string.
 */
export function generateRandomToken(numBytes = 18): string {
  return randomBytes(numBytes).toString("base64url");
}

const READABLE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateReadableCode(length: number): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += READABLE_ALPHABET[bytes[i] % READABLE_ALPHABET.length];
  }
  return code;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Single-process in-memory sliding-window rate limiter.
 *
 * NOTE: Non-durable across server restarts and NOT shared across horizontal
 * instances without an external backing store (Redis or atomic DB RPC).
 */
export function createRateLimiter(options: {
  maxRequests: number;
  windowMs: number;
  maxBuckets?: number;
}) {
  const { maxRequests, windowMs, maxBuckets = 5000 } = options;
  const buckets = new Map<string, number[]>();

  function pruneOld(now: number): void {
    if (buckets.size <= maxBuckets) return;
    for (const [key, timestamps] of buckets.entries()) {
      const fresh = timestamps.filter((t) => now - t < windowMs);
      if (fresh.length === 0) {
        buckets.delete(key);
      } else {
        buckets.set(key, fresh);
      }
      if (buckets.size <= maxBuckets) break;
    }
  }

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const existing = buckets.get(key) ?? [];
      const fresh = existing.filter((t) => now - t < windowMs);

      if (fresh.length >= maxRequests) {
        buckets.set(key, fresh);
        const oldest = fresh[0] ?? now;
        const retryAfterMs = Math.max(1000, windowMs - (now - oldest));
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        };
      }

      fresh.push(now);
      buckets.set(key, fresh);
      pruneOld(now);

      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - fresh.length),
        retryAfterSeconds: 0,
      };
    },
    reset(): void {
      buckets.clear();
    },
  };
}

/**
 * Read an HTTP request JSON body with an explicit byte-size cap before parsing.
 */
export async function readBoundedJsonBody<T = Record<string, unknown>>(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; data: T } | { ok: false; status: 400 | 413 | 415; error: string }> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      status: 415,
      error: "Content-Type must be application/json",
    };
  }

  const declaredLen = request.headers.get("content-length");
  if (declaredLen !== null) {
    const parsedLen = Number(declaredLen);
    if (Number.isFinite(parsedLen) && parsedLen > maxBytes) {
      return {
        ok: false,
        status: 413,
        error: "Request body exceeds maximum allowed size",
      };
    }
  }

  let rawBytes: Uint8Array;
  try {
    const ab = await request.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      return {
        ok: false,
        status: 413,
        error: "Request body exceeds maximum allowed size",
      };
    }
    rawBytes = new Uint8Array(ab);
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Failed to read request body",
    };
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes).trim();
  if (!text) {
    return {
      ok: false,
      status: 400,
      error: "Request body must be a valid JSON object",
    };
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        status: 400,
        error: "Request body must be a JSON object",
      };
    }
    return { ok: true, data: parsed as T };
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Malformed JSON request body",
    };
  }
}
