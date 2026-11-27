import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(process.cwd(), specifier.slice(2));
      for (const ext of ["", ".ts", ".tsx", ".mjs", ".js"]) {
        const candidate = `${base}${ext}`;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const PORT = Number(process.env.NOVA_AUD02_PORT || "3217");
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SECRET = "aud02-language-sync-secret-0123456789abcdef";

function parseCookies(headers) {
  const jar = new Map();
  const rawList =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const raw of rawList) {
    const pair = raw.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return jar;
}

function cookieHeader(jar) {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function waitForServer(url, proc, getLogs, timeoutMs = 25000) {
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

function makeRoom(hostLangCode, guestLangCode) {
  return {
    id: "AUD02SYNCRM1",
    hostLangCode,
    guestLangCode,
    hostLangLabel: hostLangCode,
    guestLangLabel: guestLangCode,
    hostConnected: true,
    guestConnected: true,
    ended: false,
    createdAt: 1,
    lastActivityAt: 1,
    latestAudioSeq: 0,
    latestSignalSeq: 0,
    messages: [],
  };
}

async function runSyncControllerBehaviorTests() {
  console.log("[aud02-test] 1. Testing RoomLanguageSyncController state machine & races...");
  const {
    RoomLanguageSyncController,
    resolveAuthoritativeRoomLanguages,
  } = await import("../lib/rooms/roomSessionSync.ts");

  let role = "host";
  let sessionActive = true;
  let speaking = false;
  let connectDelayMs = 25;
  const createdClients = [];
  const beforeReplaceEvents = [];
  const statusEvents = [];
  const staleCallbackAttempts = [];

  const controller = new RoomLanguageSyncController({
    getRole: () => role,
    isSessionActive: () => sessionActive,
    isSpeaking: () => speaking,
    createTranslator: (langs, epoch) => {
      const record = {
        epoch,
        pairKey: langs.pairKey,
        connected: false,
        disconnected: false,
        audioStreamEnds: 0,
        callbacksFired: 0,
      };
      const handle = {
        async connect() {
          await new Promise((r) => setTimeout(r, connectDelayMs));
          if (!record.disconnected) {
            record.connected = true;
            controller.handleTranslatorStatus(epoch, handle, "connected");
          }
        },
        disconnect() {
          record.disconnected = true;
        },
        sendAudioStreamEnd() {
          record.audioStreamEnds += 1;
        },
        emitTranscriptIfCurrent() {
          if (!controller.isCurrentCallback(epoch, handle)) {
            staleCallbackAttempts.push(epoch);
            return false;
          }
          record.callbacksFired += 1;
          return true;
        },
      };
      createdClients.push({ record, handle });
      return handle;
    },
    onBeforeReplace: ({ previousClient, hadActiveSpeech }) => {
      beforeReplaceEvents.push({ hadActiveSpeech });
      if (hadActiveSpeech) previousClient?.sendAudioStreamEnd();
    },
    onActiveClientChanged: () => {},
    onStatusChange: (status, detail) => {
      statusEvents.push({ status, detail });
    },
  });

  // 1. Start initial session as Host: ar <-> en (NOT ready until setupComplete / connected status)
  const initial = await controller.beginFreshSession(makeRoom("ar", "en"));
  assert.equal(controller.isReadyForAudio(), false, "Audio must NOT be ready before setupComplete");
  await initial.client.connect();
  assert.equal(controller.isReadyForAudio(), true);
  assert.equal(controller.getActivePairKey(), "ar->en");

  // 2. Host changes language during active speech -> flushes sendAudioStreamEnd & switches cleanly
  speaking = true;
  await controller.syncWithRoomSnapshot(makeRoom("fr", "en"));
  assert.equal(createdClients[0].record.audioStreamEnds, 1, "Previous client flushes active speech");
  assert.equal(createdClients[0].record.disconnected, true, "Previous client disconnected cleanly");
  assert.equal(beforeReplaceEvents.at(-1).hadActiveSpeech, true);
  assert.equal(controller.getActivePairKey(), "fr->en");
  assert.equal(statusEvents.at(-1).status, "connected");

  // 3. Stale callback arriving AFTER replacement MUST be ignored
  assert.equal(
    createdClients[0].handle.emitTranscriptIfCurrent(),
    false,
    "Old replaced session callbacks must be ignored"
  );
  assert.equal(
    createdClients[1].handle.emitTranscriptIfCurrent(),
    true,
    "Active session callbacks accepted cleanly"
  );

  // 4. Rapid successive partner language changes coalesce cleanly (en -> es -> de -> tr)
  speaking = false;
  connectDelayMs = 40;
  const p1 = controller.syncWithRoomSnapshot(makeRoom("fr", "es"));
  const p2 = controller.syncWithRoomSnapshot(makeRoom("fr", "de"));
  const p3 = controller.syncWithRoomSnapshot(makeRoom("fr", "tr"));
  await Promise.all([p1, p2, p3]);
  assert.equal(controller.getActivePairKey(), "fr->tr", "Final authoritative pair wins");
  const liveConnectedCount = createdClients.filter((c) => !c.record.disconnected).length;
  assert.equal(liveConnectedCount, 1, "Zero duplicate active translator sessions allowed");

  // 5. Language change during simulated audio playback invokes before-replace stop/cleanup
  const prevBeforeCount = beforeReplaceEvents.length;
  await controller.syncWithRoomSnapshot(makeRoom("fr", "ja"));
  assert.equal(beforeReplaceEvents.length, prevBeforeCount + 1);
  assert.equal(controller.getActivePairKey(), "fr->ja");

  // 6. Teardown & Reconnection after a language update while stopped uses newest authoritative pair
  controller.teardownCurrentClient();
  sessionActive = false;
  const stoppedRoom = makeRoom("ar", "tr");
  await controller.syncWithRoomSnapshot(stoppedRoom);
  assert.equal(controller.getActiveClient(), null, "Stopped session does not auto-connect early");
  sessionActive = true;
  const reconnected = await controller.beginFreshSession(controller.getLatestRoom());
  assert.equal(reconnected.langs.pairKey, "ar->tr", "Reconnecting uses updated authoritative pair");

  // 7. Guest role computes inverse authoritative perspective cleanly
  role = "guest";
  const guestAuth = resolveAuthoritativeRoomLanguages("guest", makeRoom("ar", "tr"));
  assert.equal(guestAuth.pairKey, "tr->ar");
}

async function runHttpSseSyncTests() {
  console.log(`[aud02-test] 2. Testing end-to-end PATCH -> SSE lang_update -> Guest & Host sync on ${BASE_URL}...`);
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  let logs = "";
  const proc = spawn(
    process.execPath,
    [nextBin, "start", "-H", "127.0.0.1", "-p", String(PORT)],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "production", NOVA_AUTH_SECRET: SECRET },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  proc.stdout.on("data", (d) => { logs += d.toString(); });
  proc.stderr.on("data", (d) => { logs += d.toString(); });

  const { RoomLanguageSyncController } = await import("../lib/rooms/roomSessionSync.ts");

  try {
    await waitForServer(`${BASE_URL}/`, proc, () => logs);

    // Host creates room ar <-> en
    const hostHome = await fetch(`${BASE_URL}/`);
    const hostJar = parseCookies(hostHome.headers);
    const cr = await fetch(`${BASE_URL}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(hostJar) },
      body: JSON.stringify({ hostLang: "ar", guestLang: "en" }),
    });
    assert.equal(cr.status, 201);
    const created = await cr.json();
    const roomId = created.room.id;
    hostJar.set("nova_room_auth", parseCookies(cr.headers).get("nova_room_auth"));

    // Guest joins room
    const guestHome = await fetch(`${BASE_URL}/`);
    const guestJar = parseCookies(guestHome.headers);
    const jn = await fetch(`${BASE_URL}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar) },
      body: JSON.stringify({ inviteToken: created.inviteToken }),
    });
    assert.equal(jn.status, 200);
    guestJar.set("nova_room_auth", parseCookies(jn.headers).get("nova_room_auth"));

    // Attach active Host & Guest RoomLanguageSyncControllers driven by real SSE streams
    const hostCtrl = new RoomLanguageSyncController({
      getRole: () => "host",
      isSessionActive: () => true,
      isSpeaking: () => false,
      createTranslator: () => ({ async connect() {}, disconnect() {}, sendAudioStreamEnd() {} }),
      onBeforeReplace: () => {},
      onActiveClientChanged: () => {},
    });
    const guestCtrl = new RoomLanguageSyncController({
      getRole: () => "guest",
      isSessionActive: () => true,
      isSpeaking: () => false,
      createTranslator: () => ({ async connect() {}, disconnect() {}, sendAudioStreamEnd() {} }),
      onBeforeReplace: () => {},
      onActiveClientChanged: () => {},
    });

    await hostCtrl.beginFreshSession(created.room);
    await guestCtrl.beginFreshSession(created.room);

    const sseAbort = new AbortController();
    const pumpSse = async (jar, ctrl) => {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}/events`, {
        headers: { Cookie: cookieHeader(jar) },
        signal: sseAbort.signal,
      });
      assert.equal(res.status, 200);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const f of frames) {
            const line = f.split("\n").find((l) => l.startsWith("data: "));
            if (line) {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "lang_update" || ev.type === "init") {
                await ctrl.syncWithRoomSnapshot(ev.room);
              }
            }
          }
        }
      } catch {
        // Expected abort
      }
    };

    const pHost = pumpSse(hostJar, hostCtrl);
    const pGuest = pumpSse(guestJar, guestCtrl);

    // Wait briefly for initial SSE connect
    await new Promise((r) => setTimeout(r, 200));

    // A. Host switches hostLang ar -> fr
    const patchHost = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(hostJar) },
      body: JSON.stringify({ hostLang: "fr" }),
    });
    assert.equal(patchHost.status, 200);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(hostCtrl.getActivePairKey(), "fr->en");
    assert.equal(guestCtrl.getActivePairKey(), "en->fr", "Guest active translator synced on Host language change");

    // B. Guest switches guestLang en -> tr -> Host translator MUST update automatically!
    const patchGuest = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar) },
      body: JSON.stringify({ guestLang: "tr" }),
    });
    assert.equal(patchGuest.status, 200);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(guestCtrl.getActivePairKey(), "tr->fr");
    assert.equal(hostCtrl.getActivePairKey(), "fr->tr", "Host active translator synced on Guest language change");

    // C. Unauthorized cross-role PATCH rejected cleanly (403) without altering active sessions
    const unauthGuestPatch = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar) },
      body: JSON.stringify({ hostLang: "de" }),
    });
    assert.equal(unauthGuestPatch.status, 403);
    const unauthHostPatch = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(hostJar) },
      body: JSON.stringify({ guestLang: "de" }),
    });
    assert.equal(unauthHostPatch.status, 403);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(hostCtrl.getActivePairKey(), "fr->tr");
    assert.equal(guestCtrl.getActivePairKey(), "tr->fr");

    sseAbort.abort();
    await Promise.all([pHost, pGuest]);
  } finally {
    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }
}

async function main() {
  await runSyncControllerBehaviorTests();
  await runHttpSseSyncTests();
  console.log("[aud02-test] ALL AUD-02 MODE B LANGUAGE SYNC TESTS PASSED!");
}

void main().catch((err) => {
  console.error("[aud02-test] FAILED:", err);
  process.exit(1);
});
