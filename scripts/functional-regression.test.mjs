import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TEST_PORT = Number(process.env.NOVA_FUNC_TEST_PORT || "3205");
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const SECRET = "functional-regression-secret-key-0123456789abcdef";

function loadEnvLocalIfPresent() {
  const envPath = path.join(process.cwd(), ".env.local");
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (!env[key]) env[key] = val;
      }
    }
  }
  return env;
}

function parseSetCookies(headers) {
  const jar = new Map();
  const rawList =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const raw of rawList) {
    const firstSemi = raw.indexOf(";");
    const pair = firstSemi >= 0 ? raw.slice(0, firstSemi) : raw;
    const eq = pair.indexOf("=");
    if (eq > 0) {
      const name = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      if (raw.includes("Max-Age=0")) jar.delete(name);
      else jar.set(name, val);
    }
  }
  return jar;
}

function cookieHeader(jar) {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function waitForServer(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

// Inline copy of extractRoomJoinFromQr regex/hash contract verified against QrScannerModal
function extractRoomJoinFromQr(rawPayload) {
  const trimmed = rawPayload.trim();
  if (!trimmed) return null;
  const pathMatch = /\/(?:room|mode-b)\/([a-zA-Z0-9]{6,20})(?:[/?#]|$)/i.exec(trimmed);
  if (pathMatch?.[1]) {
    let inviteToken;
    const hashIdx = trimmed.indexOf("#");
    if (hashIdx >= 0) {
      const token = new URLSearchParams(trimmed.slice(hashIdx + 1))
        .get("invite")
        ?.trim();
      if (token && token.length >= 8 && token.length <= 128) {
        inviteToken = token;
      }
    }
    return { roomId: pathMatch[1].toUpperCase(), inviteToken };
  }
  if (/^[a-zA-Z0-9]{6,20}$/.test(trimmed)) {
    return { roomId: trimmed.toUpperCase() };
  }
  return null;
}

async function runTests() {
  console.log(`[functional-test] Starting isolated server on ${BASE_URL}...`);
  const env = { ...loadEnvLocalIfPresent(), NOVA_AUTH_SECRET: SECRET, NODE_ENV: "production" };
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const serverProc = spawn(
    process.execPath,
    [nextBin, "start", "-H", "127.0.0.1", "-p", String(TEST_PORT)],
    { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] }
  );

  try {
    await waitForServer(`${BASE_URL}/`);

    // 1. Static assets, manifest, service worker & VAD ONNX/worklet availability
    console.log("[functional-test] 1. Verifying pages, manifest, SW, and Silero VAD assets...");
    for (const asset of [
      "/",
      "/mode-a",
      "/mode-b",
      "/manifest.webmanifest",
      "/sw.js",
      "/vad/silero_vad_v5.onnx",
      "/vad/vad.worklet.bundle.min.js",
      "/vad/ort-wasm-simd-threaded.wasm",
      "/vad/ort-wasm-simd-threaded.mjs",
    ]) {
      const res = await fetch(`${BASE_URL}${asset}`);
      assert.equal(res.status, 200, `Asset ${asset} must return 200 OK`);
    }

    // 2. QR invite extraction contract check
    const qrDecoded = extractRoomJoinFromQr(
      "https://nova.example.com/room/K7M9P2X4Q8R3N5#invite=secretInviteToken12345"
    );
    assert.deepEqual(qrDecoded, {
      roomId: "K7M9P2X4Q8R3N5",
      inviteToken: "secretInviteToken12345",
    });
    assert.equal(extractRoomJoinFromQr("https://evil.com/not-a-room"), null);

    // 3. Full Mode B Two-Phone E2E Flow (Create -> QR Join -> SSE -> Lang Swap -> Out-of-order TurnId Audio -> WebRTC -> End)
    console.log("[functional-test] 2. Testing Mode B room E2E flow with out-of-order turnId audio + WebRTC + SSE...");
    const hostHome = await fetch(`${BASE_URL}/`);
    const hostJar = parseSetCookies(hostHome.headers);

    const createRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(hostJar),
      },
      body: JSON.stringify({ hostLang: "ar", guestLang: "fr" }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    const roomId = created.room.id;
    hostJar.set("nova_room_auth", parseSetCookies(createRes.headers).get("nova_room_auth"));

    // Open Host SSE stream
    const sseAbort = new AbortController();
    const sseRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/events`, {
      headers: { Cookie: cookieHeader(hostJar) },
      signal: sseAbort.signal,
    });
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    const receivedEvents = [];
    let sseBuf = "";
    const pumpSse = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });
          const frames = sseBuf.split("\n\n");
          sseBuf = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (line) {
              receivedEvents.push(JSON.parse(line.slice(6)));
            }
          }
        }
      } catch {
        // Expected on abort
      }
    })();

    // Guest joins via extracted QR fragment invite
    const parsedQr = extractRoomJoinFromQr(
      `${BASE_URL}/room/${roomId}#invite=${created.inviteToken}`
    );
    assert.ok(parsedQr?.inviteToken);
    const guestHome = await fetch(`${BASE_URL}/`);
    const guestJar = parseSetCookies(guestHome.headers);

    const joinRes = await fetch(`${BASE_URL}/api/rooms/${parsedQr.roomId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(guestJar),
      },
      body: JSON.stringify({ inviteToken: parsedQr.inviteToken }),
    });
    assert.equal(joinRes.status, 200);
    guestJar.set("nova_room_auth", parseSetCookies(joinRes.headers).get("nova_room_auth"));

    // Guest switches spoken language fr -> en
    const patchRes = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(guestJar),
      },
      body: JSON.stringify({ guestLang: "en" }),
    });
    assert.equal(patchRes.status, 200);

    // Out-of-order test: audio arrives BEFORE transcript, both keyed deterministically by turnId
    const audioPcmB64 = Buffer.from(new Int16Array([1200, -1200, 900, -900]).buffer).toString("base64");
    const audioRelayRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/relay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(guestJar),
      },
      body: JSON.stringify({
        role: "guest",
        kind: "audio",
        sampleRate: 24000,
        turnId: "guest-turn-42",
        data: audioPcmB64,
      }),
    });
    assert.equal(audioRelayRes.status, 200);

    const transcriptRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/relay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(guestJar),
      },
      body: JSON.stringify({
        role: "guest",
        kind: "transcript",
        item: {
          id: "guest-turn-42",
          sender: "guest",
          sourceText: "Good morning",
          translatedText: "صباح الخير",
          sourceLang: "en",
          targetLang: "ar",
          isFinal: true,
          timestamp: Date.now(),
        },
      }),
    });
    assert.equal(transcriptRes.status, 200);

    // WebRTC call offer/answer relay
    const offerRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/relay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(hostJar),
      },
      body: JSON.stringify({
        role: "host",
        kind: "offer",
        payload: { type: "offer", sdp: "v=0\r\n" },
      }),
    });
    assert.equal(offerRes.status, 200);

    const guestPoll = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
      headers: { Cookie: cookieHeader(guestJar) },
    });
    const guestPollBody = await guestPoll.json();
    assert.equal(guestPollBody.signals.length, 1);
    assert.equal(guestPollBody.signals[0].kind, "offer");

    // Host ends room -> SSE receives room_ended
    const delRes = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
      method: "DELETE",
      headers: { Cookie: cookieHeader(hostJar) },
    });
    assert.equal(delRes.status, 200);

    await new Promise((r) => setTimeout(r, 300));
    sseAbort.abort();
    await pumpSse;

    assert.ok(receivedEvents.some((e) => e.type === "init"), "SSE delivered init");
    assert.ok(
      receivedEvents.some(
        (e) => e.type === "lang_update" && e.room.guestLangCode === "en"
      ),
      "SSE delivered guest language update"
    );
    assert.ok(
      receivedEvents.some(
        (e) => e.type === "audio" && e.turnId === "guest-turn-42"
      ),
      "SSE audio preserved deterministic turnId for replay"
    );
    assert.ok(
      receivedEvents.some((e) => e.type === "room_ended"),
      "SSE delivered room_ended notification"
    );

    // 4. Test voice presets cleanly on /api/session
    if (env.GEMINI_API_KEY) {
      console.log("[functional-test] 3. Verifying /api/session accepts valid voices...");
      for (const voice of ["Aoede", "Puck"]) {
        const res = await fetch(`${BASE_URL}/api/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader(hostJar),
          },
          body: JSON.stringify({ langA: "ar", langB: "fr", voiceName: voice }),
        });
        assert.equal(res.status, 200, `Voice ${voice} must mint session token`);
      }
    }

    console.log("[functional-test] ALL FUNCTIONAL REGRESSION TESTS PASSED!");
  } finally {
    serverProc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 350));
    if (!serverProc.killed) serverProc.kill("SIGKILL");
  }
}

void runTests().catch((err) => {
  console.error("[functional-test] FAILED:", err);
  process.exit(1);
});
