import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Deterministic mock registry used ONLY for external `@google/genai` Live WebSocket
// and `next/*` navigation/link shims during SSR render check.
// Production `lib/ai/geminiLiveClient.ts`, `lib/rooms/roomSessionSync.ts`, and
// `components/RoomClient.tsx` execute directly without modification.
const liveMockState = {
  failNextConnect: null,
  sessions: [],
};

function installModuleHooks() {
  const virtualGenAiCode = `
    export const Modality = { AUDIO: "AUDIO" };
    export class GoogleGenAI {
      constructor() {}
      get live() {
        const reg = globalThis.__NOVA_LIVE_MOCK__;
        return {
          connect: async (opts) => {
            if (reg.failNextConnect) {
              const err = reg.failNextConnect;
              reg.failNextConnect = null;
              throw err;
            }
            const entry = {
              id: reg.sessions.length + 1,
              opts,
              sentAudioFrames: [],
              sentStreamEnds: 0,
              closed: false,
              sessionObj: null,
            };
            entry.sessionObj = {
              sendRealtimeInput(payload) {
                if (payload?.audio) entry.sentAudioFrames.push(payload.audio);
                if (payload?.audioStreamEnd) entry.sentStreamEnds += 1;
              },
              close() {
                entry.closed = true;
              },
            };
            reg.sessions.push(entry);
            return entry.sessionObj;
          },
        };
      }
    }
  `;

  const virtualNextNav = `
    export function useParams() { return { roomId: "PINCHECK123456" }; }
    export function useSearchParams() { return new URLSearchParams(); }
    export function useRouter() { return { replace() {}, push() {} }; }
  `;

  const virtualNextLink = `
    import React from "react";
    export default function Link(props) {
      return React.createElement("a", { href: props.href, className: props.className }, props.children);
    }
  `;

  globalThis.__NOVA_LIVE_MOCK__ = liveMockState;

  const vGenAiUrl = pathToFileURL(path.join(process.cwd(), "__virtual__", "genai.mjs")).href;
  const vNextNavUrl = pathToFileURL(path.join(process.cwd(), "__virtual__", "next-navigation.mjs")).href;
  const vNextLinkUrl = pathToFileURL(path.join(process.cwd(), "__virtual__", "next-link.mjs")).href;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@google/genai") {
        return { shortCircuit: true, url: vGenAiUrl };
      }
      if (specifier === "next/navigation") {
        return { shortCircuit: true, url: vNextNavUrl };
      }
      if (specifier === "next/link") {
        return { shortCircuit: true, url: vNextLinkUrl };
      }
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
    load(url, context, nextLoad) {
      if (url === vGenAiUrl) {
        return { shortCircuit: true, format: "module", source: virtualGenAiCode };
      }
      if (url === vNextNavUrl) {
        return { shortCircuit: true, format: "module", source: virtualNextNav };
      }
      if (url === vNextLinkUrl) {
        return { shortCircuit: true, format: "module", source: virtualNextLink };
      }
      if (url.startsWith("file:///") && url.endsWith(".tsx")) {
        const src = fs.readFileSync(fileURLToPath(url), "utf8");
        const transpiled = ts.transpileModule(src, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            target: ts.ScriptTarget.ES2022,
          },
        });
        return { shortCircuit: true, format: "module", source: transpiled.outputText };
      }
      return nextLoad(url, context);
    },
  });
}

installModuleHooks();

function makeRoom(hostLangCode, guestLangCode) {
  return {
    id: "INTGRSYNC12345",
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

function makeFakePcmBase64() {
  return Buffer.from(new Int16Array([300, -300, 450, -450]).buffer).toString("base64");
}

async function testRealRoomClientSsrMount() {
  console.log("[aud03-int] 1. Exercising real RoomClient React component SSR render...");
  const React = (await import("react")).default;
  const ReactDOMServer = (await import("react-dom/server")).default;
  const RoomClient = (await import("../components/RoomClient.tsx")).default;

  const html = ReactDOMServer.renderToString(React.createElement(RoomClient));
  assert.ok(html.includes("Connecting to room PINCHECK123456"), "RoomClient renders initial connecting state cleanly");
  assert.ok(html.includes("Back to Mode B"), "RoomClient includes accessible return link");
}

async function testAllTenIntegrationScenarios() {
  console.log("[aud03-int] 2. Exercising real GeminiLiveTranslatorClient + RoomLanguageSyncController integration...");
  const realFetch = globalThis.fetch;
  const { GeminiLiveTranslatorClient } = await import("../lib/ai/geminiLiveClient.ts");
  const { RoomLanguageSyncController } = await import("../lib/rooms/roomSessionSync.ts");

  let failTokenFetch = false;
  globalThis.fetch = async (url) => {
    if (String(url) === "/api/session") {
      if (failTokenFetch) {
        return new Response(JSON.stringify({ error: "Upstream session unavailable" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          token: "eph-mock-token",
          model: "models/gemini-2.5-flash-native-audio-latest",
          systemInstruction: "mock-prompt",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  // Mirror RoomClient's exact state holders & transition handlers
  let role = "host";
  let isRunning = false;
  let isStarting = false;
  let isSpeaking = false;
  let liveStatus = "idle";
  let statusError = null;
  let activeClient = null;
  let stopPlaybackCalls = 0;
  const playedAudio = [];
  const emittedTranscripts = [];

  const stopAudioSession = (preserveErrorStatus = false) => {
    isStarting = false;
    isRunning = false;
    controller.teardownCurrentClient();
    activeClient = null;
    stopPlaybackCalls += 1;
    if (!preserveErrorStatus) {
      liveStatus = "disconnected";
    }
  };

  const controller = new RoomLanguageSyncController({
    getRole: () => role,
    isSessionActive: () => isRunning || isStarting,
    isSpeaking: () => isSpeaking,
    createTranslator: (langs, callbackEpoch) => {
      let handleRef = null;
      const isCurrent = () =>
        handleRef !== null && controller.isCurrentCallback(callbackEpoch, handleRef);

      const client = new GeminiLiveTranslatorClient({
        langACode: langs.myLang.code,
        langALabel: langs.myLang.label,
        langBCode: langs.partnerLang.code,
        langBLabel: langs.partnerLang.label,
        speakerOverride: "A",
        callbacks: {
          onStatusChange: (s, detail) => {
            if (!handleRef) return;
            controller.handleTranslatorStatus(callbackEpoch, handleRef, s, detail);
          },
          onTranscriptUpdate: (turn) => {
            if (!isCurrent()) return;
            emittedTranscripts.push({
              pair: langs.pairKey,
              id: turn.id,
              translatedText: turn.translatedText,
              isFinal: turn.isFinal,
            });
          },
          onAudioOutput: (pcm16, sampleRate, _ch, turnId) => {
            if (!isCurrent()) return;
            playedAudio.push({ pair: langs.pairKey, len: pcm16.length, sampleRate, turnId });
          },
          onInterrupted: () => {
            if (!isCurrent()) return;
            stopPlaybackCalls += 1;
          },
          onError: (msg) => {
            if (!isCurrent()) return;
            statusError = msg;
          },
        },
      });
      handleRef = client;
      return client;
    },
    onBeforeReplace: ({ previousClient, hadActiveSpeech }) => {
      if (hadActiveSpeech) {
        previousClient?.sendAudioStreamEnd();
        isSpeaking = false;
      }
      stopPlaybackCalls += 1;
    },
    onActiveClientChanged: (client) => {
      activeClient = client;
    },
    onStatusChange: (status, detail) => {
      liveStatus = status;
      if (status === "reconnecting" || status === "connected") {
        statusError = null;
      } else if (status === "error") {
        if (detail) statusError = detail;
        if (isRunning || isStarting) {
          stopAudioSession(true);
        }
      }
    },
    onFatalError: (msg) => {
      liveStatus = "error";
      statusError = msg;
      stopAudioSession(true);
    },
  });

  const sendVadFrame = () => {
    if (controller.isReadyForAudio()) {
      activeClient?.sendPcm16Frame(new Int16Array([100, -100]));
    }
  };

  // --- Scenario 1 & 2: Initial session readiness BEFORE vs AFTER setupComplete ---
  isStarting = true;
  const { client: c1 } = await controller.beginFreshSession(makeRoom("ar", "en"));
  await c1.connect();
  isStarting = false;
  isRunning = true;

  const mockWs1 = liveMockState.sessions.at(-1);
  // Simulate WS onopen BEFORE setupComplete
  mockWs1.opts.callbacks.onopen();
  assert.equal(liveStatus, "connecting", "Must NOT display connected on WS onopen before setupComplete");
  assert.equal(controller.isReadyForAudio(), false);
  sendVadFrame();
  assert.equal(mockWs1.sentAudioFrames.length, 0, "Audio frames blocked prior to setupComplete");

  // Trigger setupComplete -> becomes connected + accepts audio
  mockWs1.opts.callbacks.onmessage({ setupComplete: {} });
  assert.equal(liveStatus, "connected", "setupComplete transitions UI to connected");
  assert.equal(controller.isReadyForAudio(), true);
  sendVadFrame();
  assert.equal(mockWs1.sentAudioFrames.length, 1, "Audio frames transmitted once ready");

  // --- Scenario 3, 5, 9: Replacement status progression & stale session callback/audio blocking ---
  isSpeaking = true;
  await controller.syncWithRoomSnapshot(makeRoom("ar", "fr"));
  const mockWs2 = liveMockState.sessions.at(-1);
  assert.equal(mockWs1.sentStreamEnds, 1, "Active utterance flushed on language replacement");
  assert.equal(mockWs1.closed, true, "Previous translator closed cleanly");
  const stopCountAtSwap = stopPlaybackCalls;

  // Even after new WS onopen fires, UI MUST remain reconnecting until new setupComplete!
  mockWs2.opts.callbacks.onopen();
  assert.equal(liveStatus, "reconnecting", "Replacement stays reconnecting until new setupComplete");
  assert.equal(controller.isReadyForAudio(), false);

  // Fire stale callbacks from OLD session mockWs1 AFTER replacement -> MUST be ignored!
  const b64 = makeFakePcmBase64();
  mockWs1.opts.callbacks.onmessage({
    setupComplete: {},
    serverContent: {
      inputTranscription: { text: "مرحبا" },
      outputTranscription: { text: "STALE_ENGLISH" },
      modelTurn: { parts: [{ inlineData: { data: b64, mimeType: "audio/pcm;rate=24000" } }] },
      turnComplete: true,
    },
  });
  mockWs1.opts.callbacks.onerror(new Event("error"));
  assert.equal(liveStatus, "reconnecting", "Old session events cannot overwrite replacement status");
  assert.equal(emittedTranscripts.length, 0, "Stale transcript dropped");
  assert.equal(playedAudio.length, 0, "Old session audio dropped cleanly");
  assert.equal(stopPlaybackCalls, stopCountAtSwap);

  // Complete new session setupComplete -> transitions cleanly to connected + new French pair
  mockWs2.opts.callbacks.onmessage({ setupComplete: {} });
  assert.equal(liveStatus, "connected");
  assert.equal(controller.getActivePairKey(), "ar->fr");
  mockWs2.opts.callbacks.onmessage({
    serverContent: {
      inputTranscription: { text: "السلام" },
      outputTranscription: { text: "Salut" },
      modelTurn: { parts: [{ inlineData: { data: b64, mimeType: "audio/pcm;rate=24000" } }] },
      turnComplete: true,
    },
  });
  assert.equal(emittedTranscripts.at(-1).translatedText, "Salut");
  assert.equal(playedAudio.at(-1).pair, "ar->fr");

  // --- Scenario 4 & 8: Failed replacement produces error state (NOT stuck reconnecting), retry works without duplicates ---
  failTokenFetch = true;
  await controller.syncWithRoomSnapshot(makeRoom("ar", "es"));
  failTokenFetch = false;
  assert.equal(liveStatus, "error", "Failed replacement transitions explicitly to error state (not stuck reconnecting)");
  assert.equal(isRunning, false);
  assert.equal(controller.getActiveClient(), null);
  assert.ok(statusError && statusError.includes("Upstream session unavailable"));

  // Reconnect cleanly after failure using latest updated pair ("ar->es")
  isStarting = true;
  const { client: cRetry } = await controller.beginFreshSession(controller.getLatestRoom());
  await cRetry.connect();
  isStarting = false;
  isRunning = true;
  const mockWsRetry = liveMockState.sessions.at(-1);
  mockWsRetry.opts.callbacks.onmessage({ setupComplete: {} });
  assert.equal(liveStatus, "connected");
  assert.equal(controller.getActivePairKey(), "ar->es");
  assert.equal(
    liveMockState.sessions.filter((s) => !s.closed).length,
    1,
    "Reconnect after failure leaves strictly 1 live session (zero duplicates)"
  );

  // --- Scenario 7: Mic track-ended preserves error state ---
  statusError = "Microphone disconnected or preempted";
  liveStatus = "error";
  stopAudioSession(true);
  assert.equal(liveStatus, "error");
  assert.equal(statusError, "Microphone disconnected or preempted");

  // --- Intentional normal stop produces "disconnected" (NOT "error") ---
  statusError = null;
  isStarting = true;
  const { client: cNormal } = await controller.beginFreshSession(makeRoom("ar", "en"));
  await cNormal.connect();
  isStarting = false;
  isRunning = true;
  liveMockState.sessions.at(-1).opts.callbacks.onmessage({ setupComplete: {} });
  stopAudioSession(false);
  assert.equal(liveStatus, "disconnected", "Intentional stop never shows fatal error");

  // --- Scenario 6: Unmount/teardown during initialization cleans up cleanly ---
  let releaseDelayedConnect;
  liveMockState.failNextConnect = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === "/api/session") {
      await new Promise((r) => {
        releaseDelayedConnect = r;
      });
      return new Response(
        JSON.stringify({ token: "late-token", model: "models/gemini-2.5-flash-native-audio-latest" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return origFetch(url);
  };
  isStarting = true;
  const { client: cUnmount } = await controller.beginFreshSession(makeRoom("ar", "fr"));
  const pConnect = cUnmount.connect();
  // User unmounts BEFORE /api/session responds
  stopAudioSession(false);
  releaseDelayedConnect();
  await pConnect;
  globalThis.fetch = realFetch;
  assert.equal(controller.getActiveClient(), null, "Unmount mid-init leaves no orphaned active client");
  assert.equal(liveStatus, "disconnected", "Unmount cleanly ends disconnected rather than error");
}

async function testRoleAuthAndSseSyncIntegration() {
  console.log("[aud03-int] 3. Verifying HTTP Room authorization + SSE lang_update integration...");
  const port = Number(process.env.NOVA_AUD03_PORT || "3218");
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  let logs = "";
  const proc = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production", NOVA_AUTH_SECRET: "aud03-integration-secret-key-0123456789" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => (logs += d));
  proc.stderr.on("data", (d) => (logs += d));

  const parseCookies = (headers) => {
    const jar = new Map();
    for (const raw of headers.getSetCookie?.() ?? []) {
      const pair = raw.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return jar;
  };
  const cookieHeader = (jar) => Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");

  try {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`Server exited ${proc.exitCode}: ${logs}`);
      try {
        if ((await fetch(`${baseUrl}/`)).status < 500) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }

    const hHome = await fetch(`${baseUrl}/`);
    const hostJar = parseCookies(hHome.headers);
    const cr = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(hostJar) },
      body: JSON.stringify({ hostLang: "ar", guestLang: "en" }),
    });
    assert.equal(cr.status, 201);
    const created = await cr.json();
    hostJar.set("nova_room_auth", parseCookies(cr.headers).get("nova_room_auth"));

    const gHome = await fetch(`${baseUrl}/`);
    const guestJar = parseCookies(gHome.headers);
    const jn = await fetch(`${baseUrl}/api/rooms/${created.room.id}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar) },
      body: JSON.stringify({ inviteToken: created.inviteToken }),
    });
    assert.equal(jn.status, 200);
    guestJar.set("nova_room_auth", parseCookies(jn.headers).get("nova_room_auth"));

    const forbidden = await fetch(`${baseUrl}/api/rooms/${created.room.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar) },
      body: JSON.stringify({ hostLang: "de" }),
    });
    assert.equal(forbidden.status, 403, "Guest cannot modify Host language");

    const allowed = await fetch(`${baseUrl}/api/rooms/${created.room.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar) },
      body: JSON.stringify({ guestLang: "fr" }),
    });
    assert.equal(allowed.status, 200);
    const updatedBody = await allowed.json();
    assert.equal(updatedBody.room.guestLangCode, "fr");
  } finally {
    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }
}

async function main() {
  await testRealRoomClientSsrMount();
  await testAllTenIntegrationScenarios();
  await testRoleAuthAndSseSyncIntegration();
  console.log("[aud03-int] ALL ROOMCLIENT INTEGRATION & STATUS READINESS TESTS PASSED!");
}

void main().catch((err) => {
  console.error("[aud03-int] FAILED:", err);
  process.exit(1);
});
