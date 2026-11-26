import { NextResponse } from "next/server";
import {
  AuthConfigurationError,
  createRateLimiter,
  getClientIp,
  getRoomAuthFromRequest,
  hashRateLimitKey,
  isHttpsRequest,
  issueRoomAuthToken,
  readBoundedJsonBody,
  ROOM_AUTH_COOKIE,
  ROOM_AUTH_TTL_MS,
  serializeCookie,
} from "@/lib/security/authCrypto";
import {
  isValidRoomId,
  joinRoomAsGuest,
  normalizeRoomId,
  toSnapshot,
} from "@/lib/rooms/roomStore";

const MAX_JOIN_BODY_BYTES = 1024;

// Single-process sliding-window rate limiter against passcode brute-force attempts.
const joinRoomLimiterByIp = createRateLimiter({
  maxRequests: 10,
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

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId: rawRoomId } = await context.params;
  if (!isValidRoomId(rawRoomId)) {
    return noStoreJson({ error: "Invalid room code format." }, 400);
  }

  const roomId = normalizeRoomId(rawRoomId);
  let existingAuth: ReturnType<typeof getRoomAuthFromRequest> = null;
  let joinIpKey: string;
  try {
    existingAuth = getRoomAuthFromRequest(request, roomId);
    joinIpKey = hashRateLimitKey(`join:${roomId}`, getClientIp(request));
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

  // Rate limit credential verification attempts per hashed IP+room
  if (!existingAuth) {
    const limit = joinRoomLimiterByIp.check(joinIpKey);
    if (!limit.allowed) {
      return noStoreJson(
        { error: "Too many join attempts. Please wait before trying again." },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) }
      );
    }
  }

  const parsed = await readBoundedJsonBody<{
    inviteToken?: unknown;
    passcode?: unknown;
  }>(request, MAX_JOIN_BODY_BYTES);

  if (!parsed.ok) {
    return noStoreJson({ error: parsed.error }, parsed.status);
  }

  const inviteToken =
    typeof parsed.data.inviteToken === "string"
      ? parsed.data.inviteToken
      : undefined;
  const passcode =
    typeof parsed.data.passcode === "string" ? parsed.data.passcode : undefined;

  if (!existingAuth && !inviteToken && !passcode) {
    return noStoreJson(
      { error: "An invite token or room passcode is required to join." },
      400
    );
  }

  const joined = joinRoomAsGuest(roomId, {
    inviteToken,
    passcode,
    existingAuth,
  });

  if (!joined.ok) {
    return noStoreJson(
      { error: joined.error },
      joined.status,
      joined.retryAfterSeconds
        ? { "Retry-After": String(joined.retryAfterSeconds) }
        : undefined
    );
  }

  const { token } = issueRoomAuthToken(
    joined.room.id,
    joined.role,
    joined.credId,
    ROOM_AUTH_TTL_MS
  );

  const response = noStoreJson({
    room: toSnapshot(joined.room),
    role: joined.role,
    ...(joined.role === "host"
      ? {
          inviteToken: joined.room.inviteToken,
          passcode: joined.room.passcode,
        }
      : {}),
  });

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
