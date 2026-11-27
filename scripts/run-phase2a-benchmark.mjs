import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, Modality } from "@google/genai";
import { BENCHMARK_CASES_108 } from "./datasets/phase2a-benchmark-108.mjs";

const PORT = Number(process.env.NOVA_P2A_PORT || "3208");
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SECRET = "nova-phase2a-benchmark-secret-0123456789abcdef";

function getArgValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const RUN_TAG = getArgValue("--tag", "baseline");

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

function computeStats(values) {
  if (!values || values.length === 0) {
    return { count: 0, avg: null, p50: null, p95: null, min: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const avg = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return {
    count: sorted.length,
    avg,
    p50,
    p95,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

const CHATBOT_META_RE =
  /\b(sure,? here is|here'?s the translation|voici la traduction|as an ai|i can translate|note:|translation:)\b/i;

const FR_MARKERS =
  /\b(le|la|les|l|un|une|des|et|est|sont|vous|nous|tu|je|j|on|il|elle|de|du|d|pour|dans|sur|que|qui|pas|ne|n|avec|chez|à|où|ici|demain|aujourd'hui|bonjour|merci|combien|mon|ma|mes|ton|ta|cette|ce|cet|ça|s'il)\b/gi;
const EN_MARKERS =
  /\b(the|a|an|is|are|was|were|you|i|we|they|it|to|of|in|on|at|for|that|this|with|have|has|do|did|don't|didn't|can|could|would|should|what|where|when|how|why|please|thank|my|your|here|there|tomorrow|today)\b/gi;

function checkTargetLanguagePurity(text, targetLang) {
  const arChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;

  if (targetLang === "ar") {
    return arChars >= 3 && arChars > latinChars;
  }
  if (latinChars < 2 || arChars > latinChars) return false;

  const frHits = (text.match(FR_MARKERS) || []).length + (text.match(/[éèêëàâçùûîïôœ]/g) || []).length;
  const enHits = (text.match(EN_MARKERS) || []).length;

  if (targetLang === "fr") {
    if (text.trim().split(/\s+/).length >= 3 && enHits > frHits + 1 && frHits === 0) {
      return false;
    }
    return true;
  }
  if (targetLang === "en") {
    if (text.trim().split(/\s+/).length >= 3 && frHits > enHits + 1 && enHits === 0) {
      return false;
    }
    return true;
  }
  return false;
}

const NEG_PATTERNS = {
  ar: /(^|[\s،؟.!])(ما|ماشي|مش|مكالاه|مات|لا|لم|لن|ليس|بدون|بلا|غير|مازال|ماعنديش|مافهمتش|ماتقلقش|والو)/u,
  fr: /\b(ne|n|pas|plus|rien|aucun|aucune|jamais|sans|non|ni)\b/i,
  en: /\b(not|no|never|without|neither|nor|none|nothing|don't|doesn't|didn't|won't|can't|cannot|couldn't|shouldn't|wouldn't|wasn't|weren't|isn't|aren't)\b/i,
};

function checkNegationFidelity(text, polarity, targetLang) {
  if (polarity !== "negative") return true;
  const re = NEG_PATTERNS[targetLang];
  if (!re) return true;
  return re.test(text);
}

function normalizeForConceptMatch(str) {
  return str
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // strip Arabic diacritics
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[,.;:!?؟،"«»()]/g, " ");
}

function scoreConceptGroups(text, conceptGroups) {
  if (!conceptGroups || conceptGroups.length === 0) {
    return { matched: 0, total: 0, ratio: 1 };
  }
  const norm = normalizeForConceptMatch(text);
  let matched = 0;
  for (const synonyms of conceptGroups) {
    const hit = synonyms.some((syn) => norm.includes(normalizeForConceptMatch(syn)));
    if (hit) matched += 1;
  }
  return {
    matched,
    total: conceptGroups.length,
    ratio: matched / conceptGroups.length,
  };
}

async function openGeminiSession(cookieJar, langA, langB) {
  const tMintStart = performance.now();
  const res = await fetch(`${BASE_URL}/api/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(cookieJar),
    },
    body: JSON.stringify({ langA, langB, voiceName: "Aoede" }),
  });
  assert.equal(res.status, 200, `/api/session (${langA}<->${langB}) must succeed`);
  const payload = await res.json();
  const tokenMintMs = Math.round(performance.now() - tMintStart);

  const ai = new GoogleGenAI({
    apiKey: payload.token,
    httpOptions: { apiVersion: "v1alpha" },
  });

  let setupDone = false;
  const tWsStart = performance.now();
  let wsSetupMs = null;

  const state = {
    outputText: "",
    audioChunks: 0,
    audioBytes: 0,
    firstAudioAt: null,
    turnDone: false,
    sentAt: 0,
  };

  const session = await ai.live.connect({
    model: payload.model,
    config: {
      responseModalities: [Modality.AUDIO],
      temperature: 0.35,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      thinkingConfig: { thinkingBudget: 0 },
      contextWindowCompression: {
        triggerTokens: "12000",
        slidingWindow: { targetTokens: "4000" },
      },
      systemInstruction: payload.systemInstruction,
    },
    callbacks: {
      onmessage: (msg) => {
        if (msg.setupComplete && !setupDone) {
          setupDone = true;
          wsSetupMs = Math.round(performance.now() - tWsStart);
        }
        const sc = msg.serverContent;
        if (!sc) return;
        if (sc.outputTranscription?.text) {
          state.outputText += sc.outputTranscription.text;
        }
        if (sc.modelTurn?.parts) {
          for (const p of sc.modelTurn.parts) {
            if (p.inlineData?.data) {
              if (!state.firstAudioAt) state.firstAudioAt = performance.now();
              state.audioChunks += 1;
              state.audioBytes += Buffer.from(p.inlineData.data, "base64").length;
            }
          }
        }
        if (sc.turnComplete) {
          state.turnDone = true;
        }
      },
      onerror: (err) => {
        console.error("[p2a-bench] WS error:", err?.message || err);
      },
    },
  });

  const setupDeadline = Date.now() + 10000;
  while (!setupDone && Date.now() < setupDeadline) {
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.ok(setupDone, "Gemini Live setupComplete timed out");

  return {
    session,
    state,
    tokenMintMs,
    wsSetupMs,
    resetTurn() {
      state.outputText = "";
      state.audioChunks = 0;
      state.audioBytes = 0;
      state.firstAudioAt = null;
      state.turnDone = false;
      state.sentAt = performance.now();
    },
    async waitTurn(timeoutMs = 15000) {
      const end = Date.now() + timeoutMs;
      while (!state.turnDone && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return state.turnDone;
    },
    close() {
      session.close();
    },
  };
}

async function measureLocalRelayAndDecodeLatency(cookieJar) {
  console.log("[p2a-bench] Measuring Mode B relay -> SSE & PCM decode micro-latencies...");
  const createRes = await fetch(`${BASE_URL}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader(cookieJar) },
    body: JSON.stringify({ hostLang: "ar", guestLang: "fr" }),
  });
  const created = await createRes.json();
  const roomId = created.room.id;
  const hostJar = new Map(cookieJar);
  hostJar.set("nova_room_auth", parseSetCookies(createRes.headers).get("nova_room_auth"));

  const guestHome = await fetch(`${BASE_URL}/`);
  const guestJar = parseSetCookies(guestHome.headers);
  const joinRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar) },
    body: JSON.stringify({ inviteToken: created.inviteToken }),
  });
  guestJar.set("nova_room_auth", parseSetCookies(joinRes.headers).get("nova_room_auth"));

  const pendingTimestamps = new Map();
  const relayDeltas = [];

  const sseAbort = new AbortController();
  const sseRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/events`, {
    headers: { Cookie: cookieHeader(hostJar) },
    signal: sseAbort.signal,
  });
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = "";
  const pump = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuf += decoder.decode(value, { stream: true });
        const frames = sseBuf.split("\n\n");
        sseBuf = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (line) {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "audio" && ev.turnId && pendingTimestamps.has(ev.turnId)) {
              relayDeltas.push(Math.round((performance.now() - pendingTimestamps.get(ev.turnId)) * 100) / 100);
            }
          }
        }
      }
    } catch {
      // expected on abort
    }
  })();

  const pcmSampleB64 = Buffer.from(new Int16Array(3840).buffer).toString("base64"); // 160ms @ 24kHz
  for (let i = 0; i < 15; i++) {
    const tid = `lat-turn-${i}`;
    pendingTimestamps.set(tid, performance.now());
    await fetch(`${BASE_URL}/api/rooms/${roomId}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader(guestJar) },
      body: JSON.stringify({
        role: "guest",
        kind: "audio",
        sampleRate: 24000,
        turnId: tid,
        data: pcmSampleB64,
      }),
    });
    await new Promise((r) => setTimeout(r, 35));
  }
  await new Promise((r) => setTimeout(r, 250));
  sseAbort.abort();
  await pump;
  await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
    method: "DELETE",
    headers: { Cookie: cookieHeader(hostJar) },
  });

  // Decode micro-benchmark: 3840 Int16 samples -> Float32 + 3ms fade
  const sampleInt16 = new Int16Array(3840);
  const targetF32 = new Float32Array(3840);
  const decodeStart = performance.now();
  for (let iter = 0; iter < 500; iter++) {
    for (let i = 0; i < 3840; i++) targetF32[i] = sampleInt16[i] / 32768;
    for (let i = 0; i < 72; i++) {
      targetF32[i] *= i / 72;
      targetF32[3839 - i] *= i / 72;
    }
  }
  const decodeAvgMs = Number(((performance.now() - decodeStart) / 500).toFixed(4));

  return {
    relaySseMsStats: computeStats(relayDeltas),
    pcmDecode3840AvgMs: decodeAvgMs,
  };
}

async function runBenchmark() {
  const env = { ...loadEnvLocalIfPresent(), NOVA_AUTH_SECRET: SECRET, NODE_ENV: "production" };
  assert.ok(env.GEMINI_API_KEY, "GEMINI_API_KEY required in .env.local");

  console.log(`[p2a-bench:${RUN_TAG}] Starting isolated server on ${BASE_URL}...`);
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const serverProc = spawn(
    process.execPath,
    [nextBin, "start", "-H", "127.0.0.1", "-p", String(PORT)],
    { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] }
  );

  try {
    await waitForServer(`${BASE_URL}/`);
    const homeRes = await fetch(`${BASE_URL}/`);
    const cookieJar = parseSetCookies(homeRes.headers);

    const relayAndDecodeMetrics = await measureLocalRelayAndDecodeLatency(cookieJar);

    // Group cases by (langA, langB) keeping multi-speaker paired cases 105 & 106 sequential in same session
    const pairKeys = Array.from(
      new Set(BENCHMARK_CASES_108.map((c) => `${c.langA}:${c.langB}`))
    );

    const results = [];
    const tokenMintLatencies = [];
    const wsSetupLatencies = [];

    for (const pairKey of pairKeys) {
      const [langA, langB] = pairKey.split(":");
      const subset = BENCHMARK_CASES_108.filter(
        (c) => c.langA === langA && c.langB === langB
      );

      let conn = null;
      let turnsUsed = 0;

      for (const tc of subset) {
        // Never split a paired multi-speaker turn across reconnect boundary
        const shouldReset =
          !conn || (!tc.pairedTurnWithPrev && turnsUsed >= 10);
        if (shouldReset) {
          conn?.close();
          conn = await openGeminiSession(cookieJar, langA, langB);
          tokenMintLatencies.push(conn.tokenMintMs);
          if (conn.wsSetupMs !== null) wsSetupLatencies.push(conn.wsSetupMs);
          turnsUsed = 0;
        }

        conn.resetTurn();

        if (tc.mode === "audio_silence" || tc.mode === "audio_noise") {
          const totalSamples = 16000 * 2;
          const frameSize = 1600;
          for (let off = 0; off < totalSamples; off += frameSize) {
            const pcm = new Int16Array(frameSize);
            if (tc.mode === "audio_noise") {
              for (let j = 0; j < frameSize; j++) {
                pcm[j] = Math.round((Math.random() - 0.5) * 180);
              }
            }
            conn.session.sendRealtimeInput({
              audio: {
                data: Buffer.from(pcm.buffer).toString("base64"),
                mimeType: "audio/pcm;rate=16000",
              },
            });
            await new Promise((r) => setTimeout(r, 20));
          }
          conn.session.sendRealtimeInput({ audioStreamEnd: true });
          await conn.waitTurn(3500);

          const cleanOut = conn.state.outputText.replace(/<[^>]+>/g, "").trim();
          const silentPass = cleanOut.length === 0 && conn.state.audioBytes === 0;
          results.push({
            id: tc.id,
            group: tc.group,
            category: tc.category,
            langA: tc.langA,
            langB: tc.langB,
            sourceLang: tc.sourceLang,
            targetLang: tc.targetLang,
            input: tc.input,
            reference: tc.reference,
            outputText: cleanOut,
            audioChunks: conn.state.audioChunks,
            audioBytes: conn.state.audioBytes,
            ttfaMs: null,
            completed: true,
            langPurityOk: silentPass,
            negationOk: true,
            noChatbotMeta: true,
            noForbiddenLiteral: true,
            conceptMatched: 0,
            conceptTotal: 0,
            conceptRatio: 1,
            passed: silentPass,
          });
          console.log(`[${RUN_TAG}] #${tc.id} (${tc.category}) pass=${silentPass} outLen=${cleanOut.length}`);
          turnsUsed += 1;
          continue;
        }

        conn.session.sendClientContent({
          turns: [{ role: "user", parts: [{ text: tc.input }] }],
          turnComplete: true,
        });

        const completed = await conn.waitTurn(15000);
        const rawOut = conn.state.outputText.trim();
        const ttfaMs =
          conn.state.firstAudioAt !== null
            ? Math.round(conn.state.firstAudioAt - conn.state.sentAt)
            : null;

        const hasAudio = conn.state.audioChunks > 0 && conn.state.audioBytes > 0;
        const langPurityOk = checkTargetLanguagePurity(rawOut, tc.targetLang);
        const negationOk = checkNegationFidelity(rawOut, tc.polarity, tc.targetLang);
        const noChatbotMeta = !CHATBOT_META_RE.test(rawOut);
        const noForbiddenLiteral = tc.forbiddenRegex
          ? !tc.forbiddenRegex.test(rawOut)
          : true;
        const concepts = scoreConceptGroups(rawOut, tc.conceptGroups);

        // Strict composite rubric pass:
        // All concepts present (or >=75% if >=4 concepts in long sentence) + purity + negation + audio + no meta/literalism
        const minConceptRatio = tc.conceptGroups.length >= 4 ? 0.75 : 1.0;
        const completenessOk = concepts.ratio >= minConceptRatio;

        const passed =
          completed &&
          hasAudio &&
          langPurityOk &&
          negationOk &&
          noChatbotMeta &&
          noForbiddenLiteral &&
          completenessOk;

        results.push({
          id: tc.id,
          group: tc.group,
          category: tc.category,
          langA: tc.langA,
          langB: tc.langB,
          sourceLang: tc.sourceLang,
          targetLang: tc.targetLang,
          polarity: tc.polarity,
          input: tc.input,
          reference: tc.reference,
          outputText: rawOut,
          audioChunks: conn.state.audioChunks,
          audioBytes: conn.state.audioBytes,
          ttfaMs,
          completed,
          hasAudio,
          langPurityOk,
          negationOk,
          noChatbotMeta,
          noForbiddenLiteral,
          conceptMatched: concepts.matched,
          conceptTotal: concepts.total,
          conceptRatio: Number(concepts.ratio.toFixed(2)),
          completenessOk,
          passed,
        });

        if (!passed) {
          console.log(
            `[${RUN_TAG}] #${tc.id} FAIL (${tc.category}) purity=${langPurityOk} neg=${negationOk} concepts=${concepts.matched}/${concepts.total} literal=${noForbiddenLiteral} meta=${noChatbotMeta} out="${rawOut}"`
          );
        } else if (tc.id % 10 === 0 || tc.id >= 97) {
          console.log(
            `[${RUN_TAG}] #${tc.id} (${tc.category}) pass=true ttfa=${ttfaMs}ms out="${rawOut.slice(0, 72)}"`
          );
        }

        turnsUsed += 1;
      }

      conn?.close();
    }

    // Aggregate per group & overall
    const byGroup = {};
    const byCategory = {};
    for (const r of results) {
      for (const [bucketMap, key] of [
        [byGroup, r.group],
        [byCategory, r.category],
      ]) {
        if (!bucketMap[key]) {
          bucketMap[key] = {
            total: 0,
            passed: 0,
            conceptRatioSum: 0,
            langPurityPass: 0,
            negationTotal: 0,
            negationPass: 0,
            ttfaList: [],
          };
        }
        const b = bucketMap[key];
        b.total += 1;
        if (r.passed) b.passed += 1;
        b.conceptRatioSum += r.conceptRatio;
        if (r.langPurityOk) b.langPurityPass += 1;
        if (r.polarity === "negative") {
          b.negationTotal += 1;
          if (r.negationOk) b.negationPass += 1;
        }
        if (r.ttfaMs !== null) b.ttfaList.push(r.ttfaMs);
      }
    }

    const finalizeSummary = (map) =>
      Object.fromEntries(
        Object.entries(map).map(([k, b]) => [
          k,
          {
            total: b.total,
            passed: b.passed,
            passRatePct: Number(((b.passed / b.total) * 100).toFixed(1)),
            avgConceptCompletenessPct: Number(
              ((b.conceptRatioSum / b.total) * 100).toFixed(1)
            ),
            langPurityPct: Number(((b.langPurityPass / b.total) * 100).toFixed(1)),
            negationAccuracyPct:
              b.negationTotal > 0
                ? Number(((b.negationPass / b.negationTotal) * 100).toFixed(1))
                : null,
            ttfaMs: computeStats(b.ttfaList),
          },
        ])
      );

    const passedTotal = results.filter((r) => r.passed).length;
    const allTtfa = results.map((r) => r.ttfaMs).filter((v) => v !== null);
    const outObj = {
      tag: RUN_TAG,
      timestamp: new Date().toISOString(),
      model: "models/gemini-2.5-flash-native-audio-latest",
      totalCases: results.length,
      passedCases: passedTotal,
      strictPassRatePct: Number(((passedTotal / results.length) * 100).toFixed(1)),
      latencyBreakdown: {
        tokenMintMsStats: computeStats(tokenMintLatencies),
        wsSetupMsStats: computeStats(wsSetupLatencies),
        geminiTtfaMsStats: computeStats(allTtfa),
        relaySseMsStats: relayAndDecodeMetrics.relaySseMsStats,
        pcmDecode3840AvgMs: relayAndDecodeMetrics.pcmDecode3840AvgMs,
        dspConstantsMs: {
          vadFrameMs: 32,
          vadMinSpeechBalancedMs: 320,
          vadEndRedemptionMs: 520,
          pttEndDelayMs: 0,
          stereoEngineJitterMs: 45,
        },
      },
      byGroup: finalizeSummary(byGroup),
      byCategory: finalizeSummary(byCategory),
      failures: results.filter((r) => !r.passed),
      results,
    };

    const outPath = path.join(
      process.cwd(),
      "docs",
      `benchmark-phase2a-${RUN_TAG}.json`
    );
    fs.writeFileSync(outPath, JSON.stringify(outObj, null, 2), "utf8");
    console.log(
      `[p2a-bench:${RUN_TAG}] RESULT: ${passedTotal}/${results.length} (${outObj.strictPassRatePct}%) | TTFA mean=${outObj.latencyBreakdown.geminiTtfaMsStats.avg}ms p50=${outObj.latencyBreakdown.geminiTtfaMsStats.p50}ms p95=${outObj.latencyBreakdown.geminiTtfaMsStats.p95}ms`
    );
  } finally {
    serverProc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 350));
    if (!serverProc.killed) serverProc.kill("SIGKILL");
  }
}

void runBenchmark().catch((err) => {
  console.error(`[p2a-bench:${RUN_TAG}] ERROR:`, err);
  process.exit(1);
});
