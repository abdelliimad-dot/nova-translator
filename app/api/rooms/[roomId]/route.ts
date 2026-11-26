import { NextResponse } from "next/server";
import {
  AuthConfigurationError,
  getRoomAuthFromRequest,
  isHttpsRequest,
  readBoundedJsonBody,
  ROOM_AUTH_COOKIE,
  serializeCookie,
} from "@/lib/security/authCrypto";
import {
  authorizeRoomAccess,
  endRoom,
  getPartnerAudioSince,
  getPartnerSignalsSince,
  isStrictSupportedLanguageCode,
  isValidRoomId,
  normalizeRoomId,
  touchRoomParticipantPoll,
  updateRoomLanguages,
} from "@/lib/rooms/roomStore";

const MAX_PATCH_BODY_BYTES = 512;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function safeGetRoomAuth(request: Request, roomId: string) {
  try {
    return {
      ok: true as const,
      auth: getRoomAuthFromRequest(request, roomId),
    };
  } catch (err) {
    if (err instanceof AuthConfigurationError) {
      console.error(err.message);
      return {
        ok: false as const,
        response: noStoreJson(
          { error: "Server security configuration error." },
          503
        ),
      };
    }
    throw err;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId: rawRoomId } = await context.params;
  if (!isValidRoomId(rawRoomId)) {
    return noStoreJson({ error: "Invalid room code format." }, 400);
  }

  const roomId = normalizeRoomId(rawRoomId);
  const authRes = safeGetRoomAuth(request, roomId);
  if (!authRes.ok) return authRes.response;
  const auth = authRes.auth;
  if (!auth) {
    return noStoreJson(
      { error: "Room authentication is required." },
      401
    );
  }

  const access = authorizeRoomAccess(roomId, auth);
  if (!access.ok) {
    return noStoreJson({ error: access.error }, access.status);
  }

  const url = new URL(request.url);
  const afterAudioSeqRaw = Number(url.searchParams.get("afterAudioSeq") ?? "0");
  const afterAudioSeq =
    Number.isFinite(afterAudioSeqRaw) && afterAudioSeqRaw >= 0
      ? Math.floor(afterAudioSeqRaw)
      : 0;
  const afterSignalSeqRaw = Number(
    url.searchParams.get("afterSignalSeq") ?? "0"
  );
  const afterSignalSeq =
    Number.isFinite(afterSignalSeqRaw) && afterSignalSeqRaw >= 0
      ? Math.floor(afterSignalSeqRaw)
      : 0;

  const snapshot = touchRoomParticipantPoll(access.room, access.role);
  const audio = getPartnerAudioSince(access.room, access.role, afterAudioSeq);
  const signals = getPartnerSignalsSince(
    access.room,
    access.role,
    afterSignalSeq
  );

  return noStoreJson({
    room: snapshot,
    role: access.role,
    audio,
    signals,
    ...(access.role === "host"
      ? {
          inviteToken: access.room.inviteToken,
          passcode: access.room.passcode,
        }
      : {}),
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId: rawRoomId } = await context.params;
  if (!isValidRoomId(rawRoomId)) {
    return noStoreJson({ error: "Invalid room code format." }, 400);
  }

  const roomId = normalizeRoomId(rawRoomId);
  const authRes = safeGetRoomAuth(request, roomId);
  if (!authRes.ok) return authRes.response;
  const auth = authRes.auth;
  if (!auth) {
    return noStoreJson({ error: "Room authentication is required." }, 401);
  }

  const access = authorizeRoomAccess(roomId, auth);
  if (!access.ok) {
    return noStoreJson({ error: access.error }, access.status);
  }

  const parsed = await readBoundedJsonBody<{
    hostLang?: unknown;
    guestLang?: unknown;
  }>(request, MAX_PATCH_BODY_BYTES);

  if (!parsed.ok) {
    return noStoreJson({ error: parsed.error }, parsed.status);
  }

  const { hostLang, guestLang } = parsed.data;

  // Enforce role-bound mutation: a participant may only update their own language
  if (access.role === "host") {
    if (guestLang !== undefined) {
      return noStoreJson(
        { error: "Host cannot modify partner language." },
        403
      );
    }
    if (!isStrictSupportedLanguageCode(hostLang)) {
      return noStoreJson({ error: "Invalid hostLang code." }, 400);
    }
    const updated = updateRoomLanguages(access.room, { hostLang });
    return noStoreJson({ room: updated, role: access.role });
  }

  if (hostLang !== undefined) {
    return noStoreJson(
      { error: "Guest cannot modify host language." },
      403
    );
  }
  if (!isStrictSupportedLanguageCode(guestLang)) {
    return noStoreJson({ error: "Invalid guestLang code." }, 400);
  }

  const updated = updateRoomLanguages(access.room, { guestLang });
  return noStoreJson({ room: updated, role: access.role });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId: rawRoomId } = await context.params;
  if (!isValidRoomId(rawRoomId)) {
    return noStoreJson({ error: "Invalid room code format." }, 400);
  }

  const roomId = normalizeRoomId(rawRoomId);
  const authRes = safeGetRoomAuth(request, roomId);
  if (!authRes.ok) return authRes.response;
  const auth = authRes.auth;
  if (!auth) {
    return noStoreJson({ error: "Room authentication is required." }, 401);
  }

  const access = authorizeRoomAccess(roomId, auth);
  if (!access.ok) {
    return noStoreJson({ error: access.error }, access.status);
  }

  if (access.role !== "host") {
    return noStoreJson(
      { error: "Only the room host can end the room for everyone." },
      403
    );
  }

  const endedSnapshot = endRoom(access.room);
  const response = noStoreJson({ ok: true, ended: true, room: endedSnapshot });
  response.headers.append(
    "Set-Cookie",
    serializeCookie(ROOM_AUTH_COOKIE, "", {
      httpOnly: true,
      sameSite: "Lax",
      secure: isHttpsRequest(request),
      path: "/",
      maxAgeSeconds: 0,
    })
  );
  return response;
}
