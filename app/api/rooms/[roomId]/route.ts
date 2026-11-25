import { NextResponse } from "next/server";
import {
  endRoom,
  getOrCreateRoom,
  getPartnerAudioSince,
  getPartnerSignalsSince,
  updateRoomLanguages,
  type ParticipantRole,
} from "@/lib/rooms/roomStore";

export async function GET(
  request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const url = new URL(request.url);
  const roleParam = url.searchParams.get("role");
  const role: ParticipantRole | undefined =
    roleParam === "host" ? "host" : roleParam === "guest" ? "guest" : undefined;

  const room = getOrCreateRoom(roomId, { role });
  if (!room) {
    return NextResponse.json({ error: "Invalid room code." }, { status: 404 });
  }

  const afterAudioSeqParam = url.searchParams.get("afterAudioSeq");
  const audio =
    role && afterAudioSeqParam !== null
      ? getPartnerAudioSince(roomId, role, Number(afterAudioSeqParam) || 0)
      : [];

  const afterSignalSeqParam = url.searchParams.get("afterSignalSeq");
  const signals =
    role && afterSignalSeqParam !== null
      ? getPartnerSignalsSince(roomId, role, Number(afterSignalSeqParam) || 0)
      : [];

  return NextResponse.json(
    { room, audio, signals },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  let body: { hostLang?: string; guestLang?: string } = {};
  try {
    body = (await request.json()) as {
      hostLang?: string;
      guestLang?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const room = updateRoomLanguages(roomId, body);
  if (!room) {
    return NextResponse.json({ error: "Invalid room code." }, { status: 404 });
  }
  return NextResponse.json(
    { room },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const room = endRoom(roomId);
  if (!room) {
    return NextResponse.json(
      { error: "Room not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    { ended: true, room },
    { headers: { "Cache-Control": "no-store" } }
  );
}
