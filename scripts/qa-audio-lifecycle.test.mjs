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

const PORT = Number(process.env.NOVA_QA_PORT || "3209");
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SECRET = "nova-phase2b-qa-suite-secret-0123456789abcdef";

function computeStats(values) {
  if (!values || values.length === 0) {
    return { count: 0, avg: null, p50: null, p95: null, min: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const avg = Number((sorted.reduce((s, v) => s + v, 0) / sorted.length).toFixed(3));
  const p50 = Number(sorted[Math.floor(sorted.length * 0.5)].toFixed(3));
  const p95 = Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(3));
  return {
    count: sorted.length,
    avg,
    p50,
    p95,
    min: Number(sorted[0].toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
  };
}

// =============================================================================
// Controlled Web Audio / DOM / MediaDevices Harness for Real TS Module Testing
// =============================================================================
function installBrowserAudioHarness() {
  const listeners = new Map();
  let visibility = "visible";

  globalThis.document = {
    get visibilityState() {
      return visibility;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    _emit(type) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    _setVisibility(v) {
      visibility = v;
      this._emit("visibilitychange");
    },
    _listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };

  const trackedContexts = [];
  class MockAudioContext {
    constructor(opts = {}) {
      this.latencyHint = opts.latencyHint;
      this.sampleRate = 48000;
      this.currentTime = 1.0;
      this.state = "suspended";
      this._listeners = new Map();
      this.createdBuffers = 0;
      this.createdSources = [];
      this.createdOscillators = [];
      this.createdPanners = [];
      this.destination = {
        maxChannelCount: 2,
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      };
      trackedContexts.push(this);
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      this._listeners.get(type)?.delete(fn);
    }
    _emitState(next) {
      this.state = next;
      for (const fn of this._listeners.get("statechange") ?? []) fn();
    }
    async resume() {
      this.state = "running";
      for (const fn of this._listeners.get("statechange") ?? []) fn();
    }
    async close() {
      this.state = "closed";
    }
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime() {},
          setTargetAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        channelCount: 2,
        channelCountMode: "explicit",
        connect() {},
        disconnect() {},
      };
    }
    createStereoPanner() {
      const node = {
        panValues: [],
        pan: {
          value: 0,
          setValueAtTime: (v) => {
            node.pan.value = v;
            node.panValues.push(v);
          },
          setTargetAtTime: (v) => {
            node.pan.value = v;
            node.panValues.push(v);
          },
        },
        disconnected: false,
        connect() {},
        disconnect() {
          node.disconnected = true;
        },
      };
      this.createdPanners.push(node);
      return node;
    }
    createChannelSplitter() {
      return { connect() {}, disconnect() {} };
    }
    createAnalyser() {
      return {
        fftSize: 256,
        connect() {},
        disconnect() {},
        getByteTimeDomainData(arr) {
          arr.fill(128);
        },
      };
    }
    createBuffer(channels, length, sampleRate) {
      this.createdBuffers += 1;
      const ch = new Float32Array(length);
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData() {
          return ch;
        },
      };
    }
    createBufferSource() {
      const src = {
        buffer: null,
        connectedTarget: null,
        startedAt: null,
        stopped: false,
        onended: null,
        connect(target) {
          src.connectedTarget = target;
        },
        disconnect() {},
        start(t = 0) {
          src.startedAt = t;
        },
        stop() {
          src.stopped = true;
        },
      };
      this.createdSources.push(src);
      return src;
    }
    createOscillator() {
      const osc = {
        type: "sine",
        frequency: { setValueAtTime() {} },
        startedAt: null,
        stopped: false,
        onended: null,
        connect() {},
        disconnect() {},
        start(t = 0) {
          osc.startedAt = t;
        },
        stop() {
          osc.stopped = true;
        },
      };
      this.createdOscillators.push(osc);
      return osc;
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
  }

  let permissionDenied = false;
  let requestedConstraintsLog = [];
  let activeTracks = [];

  const mockNav = {
    mediaDevices: {
      async enumerateDevices() {
        return [
          {
            deviceId: "bt-hfp-1",
            groupId: "g1",
            kind: "audioinput",
            label: "Hands-Free AirPods Pro BT",
            toJSON: () => ({}),
          },
          {
            deviceId: "builtin-bottom-mic",
            groupId: "g2",
            kind: "audioinput",
            label: "Built-in Bottom Microphone",
            toJSON: () => ({}),
          },
        ];
      },
      async getUserMedia(constraints) {
        requestedConstraintsLog.push(constraints);
        if (permissionDenied) {
          const err = new Error("Permission denied");
          err.name = "NotAllowedError";
          throw err;
        }
        const devId = constraints?.audio?.deviceId?.exact || "builtin-bottom-mic";
        const trackListeners = new Map();
        const track = {
          kind: "audio",
          readyState: "live",
          enabled: true,
          label:
            devId === "bt-hfp-1"
              ? "Hands-Free AirPods Pro BT"
              : "Built-in Bottom Microphone",
          getSettings: () => ({ deviceId: devId, groupId: "g2", sampleRate: 48000, channelCount: 1 }),
          addEventListener(type, fn) {
            if (!trackListeners.has(type)) trackListeners.set(type, new Set());
            trackListeners.get(type).add(fn);
          },
          removeEventListener(type, fn) {
            trackListeners.get(type)?.delete(fn);
          },
          stop() {
            track.readyState = "ended";
          },
          _simulateUnexpectedEnd() {
            track.readyState = "ended";
            for (const fn of trackListeners.get("ended") ?? []) fn();
          },
          clone() {
            return { ...track };
          },
        };
        activeTracks.push(track);
        return {
          getTracks: () => [track],
          getAudioTracks: () => [track],
        };
      },
    },
  };

  globalThis.window = {
    AudioContext: MockAudioContext,
    location: { origin: BASE_URL },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: mockNav,
    configurable: true,
  });

  return {
    trackedContexts,
    setPermissionDenied(val) {
      permissionDenied = val;
    },
    getConstraintsLog() {
      return requestedConstraintsLog;
    },
    clearConstraintsLog() {
      requestedConstraintsLog = [];
    },
    getActiveTracks() {
      return activeTracks;
    },
  };
}

function loadEnvLocalIfPresent() {
  const envPath = path.join(process.cwd(), ".env.local");
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0 && !env[trimmed.slice(0, eq).trim()]) {
        env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
      }
    }
  }
  return env;
}

function parseSetCookies(headers) {
  const jar = new Map();
  const rawList = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const raw of rawList) {
    const pair = raw.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) {
      if (raw.includes("Max-Age=0")) jar.delete(pair.slice(0, eq).trim());
      else jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  return jar;
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function waitForServer(url, timeoutMs = 25000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
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

async function runQaSuite() {
  const harness = installBrowserAudioHarness();

  const { StereoEngine } = await import("../lib/audio/stereoEngine.ts");
  const { MicManager, listMicDevices } = await import("../lib/audio/micManager.ts");
  const {
    appendTurnAudioChunk,
    clearTurnAudioCache,
    hasCachedTurnAudio,
  } = await import("../lib/audio/replayHelper.ts");
  const { detectLanguageSide } = await import("../lib/languages.ts");

  console.log("[qa-suite] 1. Testing Audio Pipeline (MicManager + StereoEngine + Replay LRU)...");

  // 1A. MicManager device ranking & Mode A vs Mode B AEC constraints
  const listed = await listMicDevices();
  assert.equal(listed.recommendedDeviceId, "builtin-bottom-mic", "Built-in mic prioritized over BT HFP");

  const micMgr = new MicManager();
  harness.clearConstraintsLog();
  let trackEndedFired = false;
  const infoModeA = await micMgr.acquireMic(undefined, {
    voiceCallAec: false,
    onTrackEnded: () => {
      trackEndedFired = true;
    },
  });
  assert.equal(infoModeA.isBluetoothRisk, false);
  const cModeA = harness.getConstraintsLog().at(-1);
  assert.equal(cModeA.audio.echoCancellation, false, "Mode A locks AEC=false for A2DP stereo");

  // Unexpected mic shutdown event
  harness.getActiveTracks().at(-1)._simulateUnexpectedEnd();
  assert.equal(trackEndedFired, true, "onTrackEnded callback triggered cleanly on unexpected mic end");

  harness.clearConstraintsLog();
  const infoModeB = await micMgr.acquireMic(undefined, { voiceCallAec: true });
  assert.equal(infoModeB.deviceId, "builtin-bottom-mic");
  const cModeB = harness.getConstraintsLog().at(-1);
  assert.equal(cModeB.audio.echoCancellation, true, "Mode B enables AEC=true to suppress speakerphone echo");

  // Permission denial error path
  harness.setPermissionDenied(true);
  await assert.rejects(() => micMgr.acquireMic(), /Permission denied/);
  harness.setPermissionDenied(false);
  micMgr.releaseMic();

  // 1B. StereoEngine channel isolation, invalid inputs, stopAll(), lifecycle visibility recovery
  const engine = new StereoEngine();
  const ctx = engine.unlockSync();
  assert.equal(ctx.state, "running", "unlockSync synchronously resumes suspended AudioContext");

  const lifecycleStates = [];
  const detachLifecycle = engine.attachLifecycleRecovery((st) => lifecycleStates.push(st));
  ctx._emitState("interrupted");
  assert.equal(lifecycleStates.at(-1), "interrupted");
  ctx._emitState("suspended");
  globalThis.document._setVisibility("visible");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ctx.state, "running", "Returning to foreground auto-resumes suspended AudioContext");
  detachLifecycle();
  assert.equal(globalThis.document._listenerCount("visibilitychange"), 0, "Zero document listener leaks after detach");

  // Channel isolation: enqueue right (+1.0) followed immediately by left (-1.0)
  const sampleChunk = new Int16Array(2400).fill(4000);
  engine.enqueuePcm16(sampleChunk, "right", 24000);
  engine.enqueuePcm16(sampleChunk, "left", 24000);
  const streamSources = ctx.createdSources.filter((s) => s.connectedTarget?.pan);
  assert.equal(streamSources.length, 2);
  assert.notEqual(
    streamSources[0].connectedTarget,
    streamSources[1].connectedTarget,
    "Left and Right turns must use isolated StereoPannerNode branches"
  );
  assert.equal(streamSources[0].connectedTarget.pan.value, 1.0);
  assert.equal(streamSources[1].connectedTarget.pan.value, -1.0);

  // Invalid / empty / NaN sampleRate resilience
  engine.enqueuePcm16(new Int16Array(0), "left", 24000);
  engine.enqueuePcm16(new Int16Array([100, -100]), "left", NaN);
  assert.equal(ctx.createdSources.filter((s) => s.connectedTarget?.pan).at(-1).buffer.sampleRate, 24000, "Invalid sampleRate safely normalized to 24000Hz");

  // Interrupted turn cleanup
  engine.stopAll();
  assert.equal(engine.getDiagnostics().activeSources, 0, "stopAll() clears all active AudioBufferSourceNodes");

  // Beep test cleanup
  engine.playBeepTestSequence();
  const beepOscs = ctx.createdOscillators.slice(-2);
  assert.equal(beepOscs.length, 2);
  for (const osc of beepOscs) osc.onended?.();
  assert.ok(ctx.createdPanners.slice(-2).every((p) => p.disconnected), "Beep panners disconnect on playback end");
  await engine.dispose();

  // 1C. Replay LRU bounded cache (MAX 36) & prefix clean
  clearTurnAudioCache();
  for (let i = 0; i < 45; i++) {
    appendTurnAudioChunk(`modea:turn-${i}`, new Int16Array([500, -500]), 24000);
  }
  assert.equal(hasCachedTurnAudio("modea:turn-0"), false, "LRU evicts oldest turns beyond 36");
  assert.equal(hasCachedTurnAudio("modea:turn-44"), true);
  clearTurnAudioCache("modea:");
  assert.equal(hasCachedTurnAudio("modea:turn-44"), false);

  // 1D. Language routing edge cases (Darija+FR, Arabic+digits, same-script FR/EN/ES, AR/UR)
  assert.equal(detectLanguageSide("راني رايح للـ bus على 8", "ar", "fr"), "A");
  assert.equal(detectLanguageSide("الساعة 14:30", "ar", "en"), "A");
  assert.equal(detectLanguageSide("Excusez-moi, est-ce que c'est loin ?", "fr", "en"), "A");
  assert.equal(detectLanguageSide("Excuse me, how much does this cost?", "fr", "en"), "B");
  assert.equal(detectLanguageSide("پاکستان میں موسم اچھا ہے", "ar", "ur"), "B");

  // ---------------------------------------------------------------------------
  // 2. Long-Session & Repeated Start/Stop Memory/Scheduling Stress (30 Cycles, 300 Enqueues)
  // ---------------------------------------------------------------------------
  console.log("[qa-suite] 2. Running 30-cycle / 300-turn Audio Engine stress & leak verification...");
  const stressEngine = new StereoEngine();
  const scheduleMicroTimes = [];
  const startHeap = process.memoryUsage().heapUsed;

  for (let cycle = 0; cycle < 30; cycle++) {
    const sCtx = stressEngine.unlockSync();
    const detach = stressEngine.attachLifecycleRecovery();
    for (let t = 0; t < 10; t++) {
      const ch = t % 2 === 0 ? "left" : "right";
      const t0 = performance.now();
      stressEngine.enqueuePcm16(sampleChunk, ch, 24000);
      scheduleMicroTimes.push(performance.now() - t0);
      appendTurnAudioChunk(`modea:stress-${cycle}-${t}`, sampleChunk, 24000);
      // Simulate playback drain cleanly on some turns, interrupt on last cycle turns
      if (t < 8) {
        const latestSrc = sCtx.createdSources.at(-1);
        latestSrc.onended?.();
      }
    }
    stressEngine.stopAll();
    assert.equal(stressEngine.getDiagnostics().activeSources, 0, "Zero active source leak per cycle");
    detach();
    assert.equal(globalThis.document._listenerCount("visibilitychange"), 0, "Zero visibility listener leak per cycle");
  }
  await stressEngine.dispose();
  clearTurnAudioCache("modea:stress-");
  const endHeap = process.memoryUsage().heapUsed;
  const heapDeltaKb = Math.round((endHeap - startHeap) / 1024);

  // ---------------------------------------------------------------------------
  // 3. Real HTTP + SSE Mode B & /api/session Lifecycle + Failure Recovery Checks
  // ---------------------------------------------------------------------------
  console.log(`[qa-suite] 3. Testing Mode B HTTP/SSE lifecycle, reconnect, and timing on ${BASE_URL}...`);
  const env = { ...loadEnvLocalIfPresent(), NOVA_AUTH_SECRET: SECRET, NODE_ENV: "production" };
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const serverProc = spawn(
    process.execPath,
    [nextBin, "start", "-H", "127.0.0.1", "-p", String(PORT)],
    { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] }
  );

  const sessionMintTimes = [];
  const relayRoundTripTimes = [];

  try {
    await waitForServer(`${BASE_URL}/`);
    const hostHome = await fetch(`${BASE_URL}/`);
    const hostJar = parseSetCookies(hostHome.headers);

    // Measure 5 clean /api/session calls (if key present)
    if (env.GEMINI_API_KEY) {
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const r = await fetch(`${BASE_URL}/api/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookieHeader(hostJar) },
          body: JSON.stringify({ langA: "ar", langB: "fr", voiceName: "Aoede" }),
        });
        assert.equal(r.status, 200);
        sessionMintTimes.push(performance.now() - t0);
      }
    }

    // Host creates room -> Guest joins -> Reconnect with cookie + deduplicate seq
    const createRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(hostJar) },
      body: JSON.stringify({ hostLang: "ar", guestLang: "en" }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    const roomId = created.room.id;
    hostJar.set("nova_room_auth", parseSetCookies(createRes.headers).get("nova_room_auth"));

    const guestHome = await fetch(`${BASE_URL}/`);
    const guestJar = parseSetCookies(guestHome.headers);
    const joinRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar) },
      body: JSON.stringify({ inviteToken: created.inviteToken }),
    });
    assert.equal(joinRes.status, 200);
    guestJar.set("nova_room_auth", parseSetCookies(joinRes.headers).get("nova_room_auth"));

    // Simulate Guest SSE opening & abrupt abort (network transition Wi-Fi->4G), then Poll recovery + seq cursor
    const sse1 = new AbortController();
    const sse1Res = await fetch(`${BASE_URL}/api/rooms/${roomId}/events`, {
      headers: { Cookie: cookieHeader(guestJar) },
      signal: sse1.signal,
    });
    assert.equal(sse1Res.status, 200);
    sse1.abort();

    // Host relays malformed audio chunk (400) & valid chunks (seq 1..10) while Guest polls with cursor
    const badAudio = await fetch(`${BASE_URL}/api/rooms/${roomId}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(hostJar) },
      body: JSON.stringify({ role: "host", kind: "audio", sampleRate: 24000, data: "not!base64***" }),
    });
    assert.equal(badAudio.status, 400, "Invalid base64 PCM rejected cleanly");

    const b64 = Buffer.from(sampleChunk.buffer).toString("base64");
    for (let s = 0; s < 10; s++) {
      const t0 = performance.now();
      const okAudio = await fetch(`${BASE_URL}/api/rooms/${roomId}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader(hostJar) },
        body: JSON.stringify({
          role: "host",
          kind: "audio",
          sampleRate: 24000,
          turnId: `host-t-${s}`,
          data: b64,
        }),
      });
      assert.equal(okAudio.status, 200);
      relayRoundTripTimes.push(performance.now() - t0);
    }

    // Poll recovery starting at afterAudioSeq=0 receives seq 1..10; second poll afterAudioSeq=10 receives [] (zero duplicates!)
    const poll1 = await (await fetch(`${BASE_URL}/api/rooms/${roomId}?afterAudioSeq=0`, {
      headers: { Cookie: cookieHeader(guestJar) },
    })).json();
    assert.equal(poll1.audio.length, 10);
    const maxSeq = poll1.audio.at(-1).seq;

    const poll2 = await (await fetch(`${BASE_URL}/api/rooms/${roomId}?afterAudioSeq=${maxSeq}`, {
      headers: { Cookie: cookieHeader(guestJar) },
    })).json();
    assert.equal(poll2.audio.length, 0, "Incremental afterAudioSeq prevents duplicate playback after reconnect");

    // Re-open SSE seamlessly on Guest after network recovery
    const sse2 = new AbortController();
    const sse2Res = await fetch(`${BASE_URL}/api/rooms/${roomId}/events`, {
      headers: { Cookie: cookieHeader(guestJar) },
      signal: sse2.signal,
    });
    assert.equal(sse2Res.status, 200, "Guest SSE reconnects cleanly using HttpOnly cookie after drop");
    sse2.abort();

    // Host ends room -> guest poll gets 410 cleanly
    const del = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
      method: "DELETE",
      headers: { Cookie: cookieHeader(hostJar) },
    });
    assert.equal(del.status, 200);
    const afterEndPoll = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
      headers: { Cookie: cookieHeader(guestJar) },
    });
    assert.equal(afterEndPoll.status, 410, "Ended room returns 410 cleanly on guest poll");

    const qaSummary = {
      timestamp: new Date().toISOString(),
      audioScheduleLatencyMsStats: computeStats(scheduleMicroTimes),
      sessionMintMsStats: computeStats(sessionMintTimes),
      relayPostMsStats: computeStats(relayRoundTripTimes),
      stressCycles: 30,
      stressTurns: 300,
      heapDeltaKbDuring30Cycles: heapDeltaKb,
      leakedVisibilityListeners: globalThis.document._listenerCount("visibilitychange"),
      allPassed: true,
    };

    fs.writeFileSync(
      path.join(process.cwd(), "docs", "qa-audio-lifecycle-metrics.json"),
      JSON.stringify(qaSummary, null, 2),
      "utf8"
    );
    console.log("[qa-suite] METRICS:", JSON.stringify(qaSummary));
    console.log("[qa-suite] ALL AUTOMATED AUDIO & LIFECYCLE QA CHECKS PASSED!");
  } finally {
    serverProc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 350));
    if (!serverProc.killed) serverProc.kill("SIGKILL");
  }
}

void runQaSuite().catch((err) => {
  console.error("[qa-suite] FAILED:", err);
  process.exit(1);
});
