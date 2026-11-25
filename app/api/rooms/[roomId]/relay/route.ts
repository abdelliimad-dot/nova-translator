import { NextResponse } from "next/server";
import {
  relayAudioChunk,
  relayInterrupted,
  relaySignal,
  relayTranscript,
  type ParticipantRole,
  type RoomTranscriptItem,
  type WebRtcSignalKind,
} from "@/lib/rooms/roomStore";

interface RelayPayload {
  role?: ParticipantRole;
  kind?:
    | "transcript"
    | "audio"
    | "interrupted"
    | "offer"
    | "answer"
    | "ice-candidate"
    | "call-ready"
    | "hangup"
    | "webrtc-signal";
  signalKind?: WebRtcSignalKind;
  payload?: unknown;
  item?: RoomTranscriptItem;
  data?: string;
  sampleRate?: number;
  seq?: number;
}

const SIGNAL_KINDS = new Set<WebRtcSignalKind>([
  "offer",
  "answer",
  "ice-candidate",
  "call-ready",
  "hangup",
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  let body: RelayPayload;
  try {
    body = (await request.json()) as RelayPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const role: ParticipantRole = body.role === "host" ? "host" : "guest";

  if (body.kind === "transcript" && body.item) {
    const ok = relayTranscript(roomId, { ...body.item, sender: role });
    if (!ok) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.kind === "audio" && typeof body.data === "string") {
    const seq = relayAudioChunk(
      roomId,
      role,
      body.data,
      body.sampleRate ?? 24000
    );
    if (seq === null) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, seq });
  }

  if (body.kind === "interrupted") {
    const ok = relayInterrupted(roomId, role);
    if (!ok) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  const resolvedSignalKind =
    body.kind === "webrtc-signal"
      ? body.signalKind
      : SIGNAL_KINDS.has(body.kind as WebRtcSignalKind)
        ? (body.kind as WebRtcSignalKind)
        : undefined;

  if (resolvedSignalKind && SIGNAL_KINDS.has(resolvedSignalKind)) {
    const seq = relaySignal(
      roomId,
      role,
      resolvedSignalKind,
      body.payload ?? null
    );
    if (seq === null) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, seq });
  }

  return NextResponse.json(
    { error: "Unsupported relay payload." },
    { status: 400 }
  );
}
