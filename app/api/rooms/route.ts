import { NextResponse } from "next/server";
import {
  AuthConfigurationError,
  createRateLimiter,
  getClientIp,
  getClientSidFromRequest,
  hashRateLimitKey,
  isHttpsRequest,
  issueRoomAuthToken,
  readBoundedJsonBody,
  ROOM_AUTH_COOKIE,
  ROOM_AUTH_TTL_MS,
  serializeCookie,
} from "@/lib/security/authCrypto";
import {
  createRoom,
  isStrictSupportedLanguageCode,
  toSnapshot,
} from "@/lib/rooms/roomStore";

const MAX_CREATE_BODY_BYTES = 1024;

// Single-process sliding-window rate limiters (non-durable across replicas).
const createRoomLimiterBySid = createRateLimiter({
  maxRequests: 15,
  windowMs: 5 * 60 * 1000,
});
const createRoomLimiterByIp = createRateLimiter({
  maxRequests: 30,
  windowMs: 5 * 60 * 1000,
});

function noStoreJson(body: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export async function POST(request: Request) {
  let clientSid: ReturnType<typeof getClientSidFromRequest> = null;
  let ipBucketKey: string;
  try {
    clientSid = getClientSidFromRequest(request);
    ipBucketKey = hashRateLimitKey("rooms-ip", getClientIp(request));
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

  if (!clientSid) {
    return noStoreJson(
      { error: "Authentication required to create a room." },
      401
    );
  }

  const sidLimit = createRoomLimiterBySid.check(`sid:${clientSid.sid}`);
  if (!sidLimit.allowed) {
    return noStoreJson(
      { error: "Too many rooms created recently. Please wait and retry." },
      429,
      { "Retry-After": String(sidLimit.retryAfterSeconds) }
    );
  }

  const ipLimit = createRoomLimiterByIp.check(ipBucketKey);
  if (!ipLimit.allowed) {
    return noStoreJson(
      { error: "Too many requests from this network. Please retry shortly." },
      429,
      { "Retry-After": String(ipLimit.retryAfterSeconds) }
    );
  }

  const parsed = await readBoundedJsonBody<{
    hostLang?: unknown;
    guestLang?: unknown;
  }>(request, MAX_CREATE_BODY_BYTES);

  if (!parsed.ok) {
    return noStoreJson({ error: parsed.error }, parsed.status);
  }

  const { hostLang, guestLang } = parsed.data;
  if (
    !isStrictSupportedLanguageCode(hostLang) ||
    !isStrictSupportedLanguageCode(guestLang)
  ) {
    return noStoreJson(
      { error: "Valid hostLang and guestLang language codes are required." },
      400
    );
  }

  const room = createRoom(hostLang, guestLang);
  const { token } = issueRoomAuthToken(
    room.id,
    "host",
    room.hostCredId,
    ROOM_AUTH_TTL_MS
  );

  const response = noStoreJson(
    {
      room: toSnapshot(room),
      role: "host" as const,
      inviteToken: room.inviteToken,
      passcode: room.passcode,
    },
    201
  );

  response.headers.append(
    "Set-Cookie",
    serializeCookie(ROOM_AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: isHttpsRequest(request),
      path: "/",
      maxAgeSeconds: Math.floor(ROOM_AUTH_TTL_MS / 1000),
    })
  );

  return response;
}
