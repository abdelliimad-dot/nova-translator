import { NextResponse } from "next/server";
import { createRoom } from "@/lib/rooms/roomStore";

export async function POST(request: Request) {
  let body: { hostLang?: string; guestLang?: string } = {};
  try {
    body = (await request.json()) as {
      hostLang?: string;
      guestLang?: string;
    };
  } catch {
    // Allow default languages
  }

  const room = createRoom(body.hostLang, body.guestLang);
  return NextResponse.json(
    { room },
    {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
