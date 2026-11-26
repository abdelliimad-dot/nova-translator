import { NextResponse } from "next/server";
import {
  AuthConfigurationError,
  createRateLimiter,
  getRoomAuthFromRequest,
  readBoundedJsonBody,
} from "@/lib/security/authCrypto";
import {
  authorizeRoomAccess,
  isValidRoomId,
  normalizeRoomId,
  relayAudioChunk,
  relayInterrupted,
  relaySignal,
  relayTranscript,
} from "@/lib/rooms/roomStore";

const MAX_RELAY_BODY_BYTES = 131_072; // 128 KB max JSON payload

// Single-process sliding-window rate limiter per participant credential.
const relayLimiterByCred = createRateLimiter({
  maxRequests: 240,
  windowMs: 60 * 1000,
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
  let auth: ReturnType<typeof getRoomAuthFromRequest> = null;
  try {
    auth = getRoomAuthFromRequest(request, roomId);
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
  if (!auth) {
    return noStoreJson({ error: "Room authentication is required." }, 401);
  }

  const access = authorizeRoomAccess(roomId, auth);
  if (!access.ok) {
    return noStoreJson({ error: access.error }, access.status);
  }

  const limit = relayLimiterByCred.check(`relay:${roomId}:${auth.credId}`);
  if (!limit.allowed) {
    return noStoreJson(
      { error: "Too many relay events. Please slow down." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) }
    );
  }

  const parsed = await readBoundedJsonBody<{
    role?: unknown;
    kind?: unknown;
    item?: unknown;
    sampleRate?: unknown;
    data?: unknown;
    turnId?: unknown;
    signalKind?: unknown;
    payload?: unknown;
  }>(request, MAX_RELAY_BODY_BYTES);

  if (!parsed.ok) {
    return noStoreJson({ error: parsed.error }, parsed.status);
  }

  const body = parsed.data;

  // Enforce verified server role — reject caller role spoofing attempts explicitly
  if (body.role !== undefined && body.role !== access.role) {
    return noStoreJson(
      { error: "Cannot relay events under another participant role." },
      403
    );
  }

  const senderRole = access.role;

  if (body.kind === "transcript") {
    if (!body.item || typeof body.item !== "object" || Array.isArray(body.item)) {
      return noStoreJson({ error: "Missing transcript item." }, 400);
    }
    const result = relayTranscript(
      access.room,
      senderRole,
      body.item as Record<string, unknown>
    );
    if (!result.ok) {
      return noStoreJson({ error: result.error }, result.status ?? 400);
    }
    return noStoreJson({ ok: true });
  }

  if (body.kind === "audio") {
    const result = relayAudioChunk(
      access.room,
      senderRole,
      body.sampleRate,
      body.data,
      body.turnId
    );
    if (!result.ok) {
      return noStoreJson({ error: result.error }, 400);
    }
    return noStoreJson({ ok: true, seq: result.packet.seq });
  }

  if (body.kind === "interrupted") {
    relayInterrupted(access.room, senderRole);
    return noStoreJson({ ok: true });
  }

  if (
    body.kind === "webrtc-signal" ||
    body.kind === "offer" ||
    body.kind === "answer" ||
    body.kind === "ice-candidate" ||
    body.kind === "call-ready" ||
    body.kind === "hangup"
  ) {
    const signalKind =
      body.kind === "webrtc-signal" ? body.signalKind : body.kind;
    const result = relaySignal(
      access.room,
      senderRole,
      signalKind,
      body.payload
    );
    if (!result.ok) {
      return noStoreJson({ error: result.error }, 400);
    }
    return noStoreJson({ ok: true, seq: result.packet.seq });
  }

  return noStoreJson({ error: "Unknown relay kind." }, 400);
}
