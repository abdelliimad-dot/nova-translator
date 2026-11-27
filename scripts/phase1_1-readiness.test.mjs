import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT_A = Number(process.env.NOVA_P11_PORT_A || "3201");
const PORT_B = Number(process.env.NOVA_P11_PORT_B || "3202");
const NEXT_BIN = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

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
      if (raw.includes("Max-Age=0")) {
        jar.delete(name);
      } else {
        jar.set(name, val);
      }
    }
  }
  return jar;
}

function cookieHeader(jar) {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function waitForServer(url, proc, getLogs, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Server exited early (${proc.exitCode}):\n${getLogs()}`);
    }
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}\n${getLogs()}`);
}

function startNextServer(port, extraEnv = {}) {
  const env = { ...loadEnvLocalIfPresent(), ...extraEnv, NODE_ENV: "production" };
  let logs = "";
  const proc = spawn(
    process.execPath,
    [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] }
  );
  proc.stdout.on("data", (d) => {
    logs += d.toString();
  });
  proc.stderr.on("data", (d) => {
    logs += d.toString();
  });
  return {
    proc,
    url: `http://127.0.0.1:${port}`,
    getLogs: () => logs,
    async stop() {
      if (proc.exitCode === null) {
        proc.kill("SIGTERM");
        await new Promise((r) => setTimeout(r, 350));
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }
    },
  };
}

async function testMissingSecretFailsProductionStart() {
  console.log("[phase1.1] 1. Testing production startup failure without NOVA_AUTH_SECRET...");
  const s = startNextServer(PORT_A, { NOVA_AUTH_SECRET: "" });
  const exitResult = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("TIMEOUT"), 15000);
    s.proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  await s.stop();
  assert.notEqual(exitResult, "TIMEOUT", "Server must fail fast instead of staying open");
  assert.notEqual(exitResult, 0, "Production server must exit non-zero without NOVA_AUTH_SECRET");
  assert.ok(
    s.getLogs().includes("NOVA_AUTH_SECRET"),
    "Startup error must clearly identify NOVA_AUTH_SECRET"
  );

  console.log("[phase1.1]    Testing weak/short NOVA_AUTH_SECRET rejection...");
  const weak = startNextServer(PORT_A, { NOVA_AUTH_SECRET: "replace_with_short" });
  const weakExit = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("TIMEOUT"), 15000);
    weak.proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  await weak.stop();
  assert.notEqual(weakExit, "TIMEOUT");
  assert.notEqual(weakExit, 0, "Weak short secret must be rejected at startup");
}

async function runSuite() {
  await testMissingSecretFailsProductionStart();

  const SECRET_OLD = "alpha-phase11-secret-material-9f8e7d6c5b4a3210-v1";
  const SECRET_NEW = "beta-phase11-rotated-secret-key-0123456789abcdef-v2";

  console.log("[phase1.1] 2. Testing multi-instance behavior, key rotation, and restart persistence...");
  const instA = startNextServer(PORT_A, { NOVA_AUTH_SECRET: SECRET_OLD });
  const instB = startNextServer(PORT_B, {
    NOVA_AUTH_SECRET: SECRET_NEW,
    NOVA_AUTH_SECRET_PREVIOUS: SECRET_OLD,
  });

  try {
    await Promise.all([
      waitForServer(`${instA.url}/`, instA.proc, instA.getLogs),
      waitForServer(`${instB.url}/`, instB.proc, instB.getLogs),
    ]);

    // Cookie issued by Instance A (SECRET_OLD) accepted & migrated on Instance B (SECRET_NEW + PREVIOUS)
    const homeA = await fetch(`${instA.url}/`);
    assert.equal(homeA.status, 200);
    const jarA = parseSetCookies(homeA.headers);
    assert.ok(jarA.has("nova_client_sid"));

    const homeB = await fetch(`${instB.url}/`, {
      headers: { Cookie: cookieHeader(jarA) },
    });
    assert.equal(homeB.status, 200);
    const rotatedCookiesB = parseSetCookies(homeB.headers);
    assert.ok(
      rotatedCookiesB.has("nova_client_sid"),
      "Proxy must seamlessly migrate previous-key session cookie onto new secret"
    );
    const rotatedSid = rotatedCookiesB.get("nova_client_sid");
    assert.notEqual(rotatedSid, jarA.get("nova_client_sid"));

    // Invalid vs valid Gemini session checks across rotated cookie
    const invalidSess = await fetch(`${instB.url}/api/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(rotatedCookiesB),
      },
      body: JSON.stringify({ langA: "invalid_free_text", langB: "en" }),
    });
    assert.equal(invalidSess.status, 400);

    const validSess = await fetch(`${instB.url}/api/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(rotatedCookiesB),
      },
      body: JSON.stringify({ langA: "ar", langB: "en", voiceName: "Aoede" }),
    });
    assert.ok(
      validSess.status === 200 || validSess.status === 503,
      `Expected valid /api/session status 200 (with key) or 503 (without key), got ${validSess.status}`
    );

    // X-Forwarded-For leftmost spoofing resistance on IP rate limit
    let sawXff429 = false;
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`${instB.url}/api/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader(rotatedCookiesB),
          "X-Forwarded-For": `203.0.113.${i}, 198.51.100.77`,
        },
        body: JSON.stringify({ langA: "zz", langB: "en" }),
      });
      if (r.status === 429) {
        sawXff429 = true;
        break;
      }
    }
    assert.ok(
      sawXff429,
      "Spoofing varying leftmost X-Forwarded-For hops must NOT bypass IP/subject rate limiter"
    );

    // Create Mode B room on Instance A -> prove Instance B (process-local store) does NOT have it
    const createRes = await fetch(`${instA.url}/api/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(jarA),
      },
      body: JSON.stringify({ hostLang: "ar", guestLang: "fr" }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    const roomId = createBody.room.id;
    const hostJar = new Map(jarA);
    hostJar.set("nova_room_auth", parseSetCookies(createRes.headers).get("nova_room_auth"));

    // Confirm multi-instance isolation limitation when no Redis/DB store is attached
    const crossInstJoin = await fetch(`${instB.url}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteToken: createBody.inviteToken }),
    });
    assert.equal(
      crossInstJoin.status,
      404,
      "Confirmed: process-local store is isolated per instance until shared DB/Redis is added"
    );

    // ------------------------------------------------------------------
    // 3. Concurrent room joins + one-time QR invite + transcript tamper
    // ------------------------------------------------------------------
    console.log("[phase1.1] 3. Testing concurrent joins, one-time QR invite, and transcript ownership...");
    const concurrentResults = await Promise.all(
      Array.from({ length: 5 }, (_, idx) =>
        fetch(`${instA.url}/api/rooms/${roomId}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            idx < 2
              ? { inviteToken: createBody.inviteToken }
              : { passcode: createBody.passcode }
          ),
        })
      )
    );
    const statuses = concurrentResults.map((r) => r.status);
    const successResponses = concurrentResults.filter((r) => r.status === 200);
    assert.equal(
      successResponses.length,
      1,
      `Only ONE concurrent join may win active guest seat (got statuses: ${statuses.join(",")})`
    );
    assert.ok(
      statuses.filter((s) => s === 409 || s === 403).length === 4,
      "Other concurrent join attempts rejected cleanly"
    );

    const winnerJar = new Map();
    winnerJar.set(
      "nova_room_auth",
      parseSetCookies(successResponses[0].headers).get("nova_room_auth")
    );

    // One-time inviteToken replay attempt blocked even after host checks room
    const replayInvite = await fetch(`${instA.url}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteToken: createBody.inviteToken }),
    });
    assert.equal(
      replayInvite.status,
      403,
      "Used QR inviteToken cannot be replayed once redeemed"
    );

    // Host writes transcript -> Guest tries overwriting Host's message id
    const hostMsgRes = await fetch(`${instA.url}/api/rooms/${roomId}/relay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(hostJar),
      },
      body: JSON.stringify({
        role: "host",
        kind: "transcript",
        item: {
          id: "host-turn-locked-1",
          sender: "host",
          sourceText: "Hello",
          translatedText: "مرحبا",
          sourceLang: "ar",
          targetLang: "fr",
          isFinal: true,
          timestamp: Date.now(),
        },
      }),
    });
    assert.equal(hostMsgRes.status, 200);

    const guestOverwrite = await fetch(`${instA.url}/api/rooms/${roomId}/relay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(winnerJar),
      },
      body: JSON.stringify({
        role: "guest",
        kind: "transcript",
        item: {
          id: "host-turn-locked-1",
          sender: "guest",
          sourceText: "TAMPERED",
          translatedText: "TAMPERED",
          sourceLang: "fr",
          targetLang: "ar",
          isFinal: true,
          timestamp: Date.now(),
        },
      }),
    });
    assert.equal(
      guestOverwrite.status,
      403,
      "Guest cannot overwrite Host transcript entry by colliding message ID"
    );

    // Per-room brute-force PIN lockout across changing IPs/cookies
    const bfRoomRes = await fetch(`${instA.url}/api/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(jarA),
      },
      body: JSON.stringify({ hostLang: "en", guestLang: "es" }),
    });
    assert.equal(bfRoomRes.status, 201);
    const bfRoomId = (await bfRoomRes.json()).room.id;
    let sawPerRoom429 = false;
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`${instA.url}/api/rooms/${bfRoomId}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `198.51.100.${i + 1}`,
        },
        body: JSON.stringify({ passcode: "WRONG9" }),
      });
      if (r.status === 429) {
        sawPerRoom429 = true;
        break;
      }
    }
    assert.ok(
      sawPerRoom429,
      "Distributed brute-force attempts across distinct IPs hit per-room lockout (429)"
    );

    // Server restart behavior: cookies remain valid under NOVA_AUTH_SECRET, room store resets cleanly to 404
    console.log("[phase1.1] 4. Testing server restart behavior with persistent NOVA_AUTH_SECRET...");
    await instA.stop();
    const instARestarted = startNextServer(PORT_A, { NOVA_AUTH_SECRET: SECRET_OLD });
    try {
      await waitForServer(`${instARestarted.url}/`, instARestarted.proc, instARestarted.getLogs);

      // Existing client cookie survives restart
      const postRestartSess = await fetch(`${instARestarted.url}/api/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader(jarA),
        },
        body: JSON.stringify({ langA: "invalid", langB: "en" }),
      });
      assert.equal(
        postRestartSess.status,
        400,
        "Client session cookie remains cryptographically valid across restart (fails on bad input, not 401)"
      );

      // Previously created in-memory room returns 404 cleanly (never silently recreated)
      const roomAfterRestart = await fetch(`${instARestarted.url}/api/rooms/${roomId}`, {
        headers: { Cookie: cookieHeader(hostJar) },
      });
      assert.equal(
        roomAfterRestart.status,
        404,
        "Restart clears volatile room store without zombie auto-creation"
      );
    } finally {
      await instARestarted.stop();
    }

    console.log("[phase1.1] ALL PRODUCTION READINESS TESTS PASSED!");
  } finally {
    await Promise.all([instA.stop(), instB.stop()]);
  }
}

void runSuite().catch((err) => {
  console.error("[phase1.1] FAILED:", err);
  process.exit(1);
});
