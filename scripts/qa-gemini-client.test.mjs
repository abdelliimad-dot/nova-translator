import assert from "node:assert/strict";
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

// Stub fetch + GoogleGenAI Live WebSocket cleanly inside isolated module loader?
// Because GeminiLiveTranslatorClient constructs GoogleGenAI directly, we verify:
// 1. Live connect() against invalid/unauthorized /api/session fails cleanly to status="error".
// 2. Real GeminiLiveTranslatorClient class methods: sendPcm16Frame / sendAudioStreamEnd safe when disconnected,
//    speakerOverride / swapChannels routing, and handleServerMessage partial-turn flush + hasAudio flag + goAway + reconnect + disconnect cleanup.

async function runGeminiLifecycleTests() {
  // Stub window/btoa for Node if needed (Node 24 has btoa globally)
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Auth required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

  const { GeminiLiveTranslatorClient } = await import(
    "../lib/ai/geminiLiveClient.ts"
  );

  // 1. Startup failure on 401 -> sets status="error", fires onError, rejects cleanly
  const statuses = [];
  const errors = [];
  const cFail = new GeminiLiveTranslatorClient({
    langACode: "ar",
    langALabel: "Arabic",
    langBCode: "en",
    langBLabel: "English",
    callbacks: {
      onStatusChange: (s) => statuses.push(s),
      onError: (e) => errors.push(e),
    },
  });
  await assert.rejects(() => cFail.connect(), /Auth required/);
  assert.equal(statuses.at(-1), "error");
  assert.equal(errors.at(-1), "Auth required");

  // 2. Sending frames when idle/disconnected is a safe no-op (zero uncaught exceptions)
  cFail.sendPcm16Frame(new Int16Array([100, -100]));
  cFail.sendAudioStreamEnd();
  cFail.disconnect();

  // 3. Verify partial final turn flush, hasAudio=false flagging, goAway reconnect, and disconnect timer cancellation
  const emittedTurns = [];
  const goAwayEvents = [];
  const reconnectStatuses = [];
  const mockClosedSessions = [];

  const cLifecycle = new GeminiLiveTranslatorClient({
    langACode: "ar",
    langALabel: "Arabic",
    langBCode: "fr",
    langBLabel: "French",
    callbacks: {
      onStatusChange: (s) => reconnectStatuses.push(s),
      onTranscriptUpdate: (t) => emittedTurns.push(t),
      onGoAway: (left) => goAwayEvents.push(left),
    },
  });

  // Inject controlled live session + simulate server messages deterministically
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ error: "Simulated outage" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  };

  cLifecycle.session = {
    sendRealtimeInput() {},
    close() {
      mockClosedSessions.push(true);
    },
  };
  cLifecycle.status = "connected";
  cLifecycle.manualDisconnect = false;

  // Turn A: outputTranscription WITHOUT audio parts -> hasAudio must be false
  cLifecycle.handleServerMessage({ setupComplete: {} });
  cLifecycle.handleServerMessage({
    serverContent: {
      inputTranscription: { text: "Carrément!" },
      outputTranscription: { text: "Totally!" },
      turnComplete: true,
    },
  });
  const finalNoAudio = emittedTurns.find((t) => t.isFinal && t.translatedText === "Totally!");
  assert.ok(finalNoAudio, "Final transcript emitted even when audio is missing");
  assert.equal(finalNoAudio.hasAudio, false, "Missing audio turn explicitly flagged with hasAudio=false");

  // Turn B: partial utterance buffered BEFORE goAway -> must flush isFinal=true instead of silently dropping
  cLifecycle.handleServerMessage({
    serverContent: {
      inputTranscription: { text: "صحيت خويا" },
      outputTranscription: { text: "Merci mon frère" },
    },
  });
  cLifecycle.handleServerMessage({ goAway: { timeLeft: "5s" } });
  assert.equal(goAwayEvents[0], "5s");
  assert.ok(
    emittedTurns.some((t) => t.isFinal && t.translatedText.includes("Merci mon frère")),
    "Buffered final utterance flushed on goAway before reconnect"
  );
  assert.equal(
    reconnectStatuses.at(-1),
    "reconnecting",
    "goAway transitions client into reconnecting state cleanly"
  );

  // Manual disconnect cancels pending reconnect timer cleanly without spawning network calls
  cLifecycle.disconnect();
  assert.equal(mockClosedSessions.length, 1);
  await new Promise((r) => setTimeout(r, 950));
  assert.equal(fetchCalls, 0, "Manual disconnect cancels scheduled reconnect timer cleanly");

  console.log("[qa-gemini-client] ALL GEMINI CLIENT LIFECYCLE CHECKS PASSED!");
}

void runGeminiLifecycleTests().catch((err) => {
  console.error("[qa-gemini-client] FAILED:", err);
  process.exit(1);
});
