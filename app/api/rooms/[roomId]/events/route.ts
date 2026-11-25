import { NextResponse } from "next/server";
import {
  isValidRoomId,
  subscribeToRoom,
  type ParticipantRole,
  type RoomServerEvent,
} from "@/lib/rooms/roomStore";

export async function GET(
  request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  if (!isValidRoomId(roomId)) {
    return NextResponse.json(
      { error: "Invalid room code." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const url = new URL(request.url);
  const roleParam = url.searchParams.get("role");
  const role: ParticipantRole = roleParam === "host" ? "host" : "guest";

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Flush an initial padding comment (>8KB) immediately so Cloudflare Tunnel
      // and mobile proxies push headers + initial SSE events without buffering.
      controller.enqueue(encoder.encode(`: ${" ".repeat(8192)}\n\n`));

      const sendEvent = (event: RoomServerEvent) => {
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      unsubscribe = subscribeToRoom(roomId, role, sendEvent);
      if (!unsubscribe) {
        sendEvent({ type: "error", error: "Invalid room code." });
        controller.close();
        return;
      }

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 15000);

      request.signal.addEventListener("abort", () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "identity",
    },
  });
}
