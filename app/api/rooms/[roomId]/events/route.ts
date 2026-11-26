import { NextResponse } from "next/server";
import {
  AuthConfigurationError,
  getRoomAuthFromRequest,
} from "@/lib/security/authCrypto";
import {
  authorizeRoomAccess,
  isValidRoomId,
  normalizeRoomId,
  subscribeToRoom,
  type RoomServerEvent,
} from "@/lib/rooms/roomStore";

export async function GET(
  request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId: rawRoomId } = await context.params;
  if (!isValidRoomId(rawRoomId)) {
    return NextResponse.json(
      { error: "Invalid room code format." },
      { status: 400 }
    );
  }

  const roomId = normalizeRoomId(rawRoomId);
  let auth: ReturnType<typeof getRoomAuthFromRequest> = null;
  try {
    auth = getRoomAuthFromRequest(request, roomId);
  } catch (err) {
    if (err instanceof AuthConfigurationError) {
      console.error(err.message);
      return NextResponse.json(
        { error: "Server security configuration error." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw err;
  }
  if (!auth) {
    return NextResponse.json(
      { error: "Room authentication is required." },
      { status: 401 }
    );
  }

  const access = authorizeRoomAccess(roomId, auth);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      };

      // Initial padding to flush proxy/CDN SSE buffers cleanly
      safeEnqueue(`: ${" ".repeat(8192)}\n\n`);

      cleanup = subscribeToRoom(
        access.room,
        access.role,
        auth.credId,
        (event: RoomServerEvent) => {
          safeEnqueue(`data: ${JSON.stringify(event)}\n\n`);
        },
        closeStream
      );

      keepAlive = setInterval(() => {
        safeEnqueue(": ping\n\n");
      }, 15000);

      request.signal.addEventListener("abort", () => {
        if (keepAlive) clearInterval(keepAlive);
        cleanup?.();
        cleanup = null;
        closeStream();
      });
    },
    cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      cleanup?.();
      cleanup = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
