import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, Modality } from "@google/genai";
import { BENCHMARK_CASES_108 } from "./datasets/phase2a-benchmark-108.mjs";

const PORT = Number(process.env.NOVA_P2C_PORT || "3215");
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SECRET = "nova-phase2c-repeatability-secret-0123456789abcdef";

function getArgValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const RUN_TAG = getArgValue("--tag", "phase2b-repeat");
const REPEATS = Number(getArgValue("--repeats", "3"));
const TARGET_IDS = [17, 24, 36, 37, 41, 55, 64, 65, 78, 81, 83, 101, 103, 107];

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

const CHATBOT_META_RE =
  /\b(sure,? here is|here'?s the translation|voici la traduction|as an ai|i can translate|note:|translation:)\b/i;
const FR_MARKERS =
  /\b(le|la|les|l|un|une|des|et|est|sont|vous|nous|tu|je|j|on|il|elle|de|du|d|pour|dans|sur|que|qui|pas|ne|n|avec|chez|à|où|ici|demain|aujourd'hui|bonjour|merci|combien|mon|ma|mes|ton|ta|cette|ce|cet|ça|s'il)\b/gi;
const EN_MARKERS =
  /\b(the|a|an|is|are|was|were|you|i|we|they|it|to|of|in|on|at|for|that|this|with|have|has|do|did|don't|didn't|can|could|would|should|what|where|when|how|why|please|thank|my|your|here|there|tomorrow|today)\b/gi;
const NEG_PATTERNS = {
  ar: /(^|[\s،؟.!])(ما|ماشي|مش|مكالاه|مات|لا|لم|لن|ليس|بدون|بلا|غير|مازال|ماعنديش|مافهمتش|ماتقلقش|والو)/u,
  fr: /\b(ne|n|pas|plus|rien|aucun|aucune|jamais|sans|non|ni)\b/i,
  en: /\b(not|no|never|without|neither|nor|none|nothing|don't|doesn't|didn't|won't|can't|cannot|couldn't|shouldn't|wouldn't|wasn't|weren't|isn't|aren't)\b/i,
};

function checkTargetLanguagePurity(text, targetLang) {
  const arChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  if (targetLang === "ar") return arChars >= 3 && arChars > latinChars;
  if (latinChars < 2 || arChars > latinChars) return false;
  const frHits = (text.match(FR_MARKERS) || []).length + (text.match(/[éèêëàâçùûîïôœ]/g) || []).length;
  const enHits = (text.match(EN_MARKERS) || []).length;
  if (targetLang === "fr" && text.trim().split(/\s+/).length >= 3 && enHits > frHits + 1 && frHits === 0) return false;
  if (targetLang === "en" && text.trim().split(/\s+/).length >= 3 && frHits > enHits + 1 && enHits === 0) return false;
  return true;
}

function normalizeForConceptMatch(str) {
  return str
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
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
    if (synonyms.some((syn) => norm.includes(normalizeForConceptMatch(syn)))) matched += 1;
  }
  return { matched, total: conceptGroups.length, ratio: matched / conceptGroups.length };
}

async function openGeminiSession(cookieJar, langA, langB) {
  const res = await fetch(`${BASE_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader(cookieJar) },
    body: JSON.stringify({ langA, langB, voiceName: "Aoede" }),
  });
  assert.equal(res.status, 200, `/api/session (${langA}<->${langB}) must succeed`);
  const payload = await res.json();
  const ai = new GoogleGenAI({ apiKey: payload.token, httpOptions: { apiVersion: "v1alpha" } });

  let setupDone = false;
  const state = { outputText: "", audioChunks: 0, audioBytes: 0, firstAudioAt: null, turnDone: false, sentAt: 0 };
  const session = await ai.live.connect({
    model: payload.model,
    config: {
      responseModalities: [Modality.AUDIO],
      temperature: 0.35,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      thinkingConfig: { thinkingBudget: 0 },
      contextWindowCompression: { triggerTokens: "12000", slidingWindow: { targetTokens: "4000" } },
      systemInstruction: payload.systemInstruction,
    },
    callbacks: {
      onmessage: (msg) => {
        if (msg.setupComplete) setupDone = true;
        const sc = msg.serverContent;
        if (!sc) return;
        if (sc.outputTranscription?.text) state.outputText += sc.outputTranscription.text;
        if (sc.modelTurn?.parts) {
          for (const p of sc.modelTurn.parts) {
            if (p.inlineData?.data) {
              if (!state.firstAudioAt) state.firstAudioAt = performance.now();
              state.audioChunks += 1;
              state.audioBytes += Buffer.from(p.inlineData.data, "base64").length;
            }
          }
        }
        if (sc.turnComplete) state.turnDone = true;
      },
      onerror: (err) => console.error("[p2c-repeat] WS error:", err?.message || err),
    },
  });

  const setupDeadline = Date.now() + 10000;
  while (!setupDone && Date.now() < setupDeadline) await new Promise((r) => setTimeout(r, 40));
  assert.ok(setupDone, "Gemini Live setupComplete timed out");

  return {
    session,
    state,
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
      while (!state.turnDone && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
      return state.turnDone;
    },
    close() {
      session.close();
    },
  };
}

async function main() {
  const env = loadEnvLocalIfPresent();
  assert.ok(env.GEMINI_API_KEY, "GEMINI_API_KEY is required");
  assert.ok(fs.existsSync(path.join(process.cwd(), ".next/BUILD_ID")), ".next build required");

  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const server = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...env, NODE_ENV: "production", NOVA_AUTH_SECRET: SECRET, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[next-err] ${d}`));

  try {
    await waitForServer(`${BASE_URL}/`);
    const homeRes = await fetch(`${BASE_URL}/`);
    const cookieJar = parseSetCookies(homeRes.headers);

    const cases = BENCHMARK_CASES_108.filter((c) => TARGET_IDS.includes(c.id));
    const report = [];

    for (const tc of cases) {
      const runs = [];
      for (let rep = 1; rep <= REPEATS; rep++) {
        // Fresh session per repetition to avoid context carryover inflating or biasing repetition
        const conn = await openGeminiSession(cookieJar, tc.langA, tc.langB);
        conn.resetTurn();
        if (tc.mode === "audio_silence" || tc.mode === "audio_noise") {
          const totalSamples = 16000 * 2;
          const frameSize = 1600;
          for (let off = 0; off < totalSamples; off += frameSize) {
            const pcm = new Int16Array(frameSize);
            if (tc.mode === "audio_noise") {
              for (let j = 0; j < frameSize; j++) pcm[j] = Math.round((Math.random() - 0.5) * 180);
            }
            conn.session.sendRealtimeInput({
              audio: { data: Buffer.from(pcm.buffer).toString("base64"), mimeType: "audio/pcm;rate=16000" },
            });
            await new Promise((r) => setTimeout(r, 20));
          }
          conn.session.sendRealtimeInput({ audioStreamEnd: true });
          await conn.waitTurn(3500);
          const cleanOut = conn.state.outputText.replace(/<[^>]+>/g, "").trim();
          const silentPass = cleanOut.length === 0 && conn.state.audioBytes === 0;
          runs.push({ rep, passed: silentPass, outputText: cleanOut, audioBytes: conn.state.audioBytes, ttfaMs: null });
        } else {
          conn.session.sendClientContent({ turns: [{ role: "user", parts: [{ text: tc.input }] }], turnComplete: true });
          const completed = await conn.waitTurn(15000);
          const rawOut = conn.state.outputText.trim();
          const ttfaMs = conn.state.firstAudioAt !== null ? Math.round(conn.state.firstAudioAt - conn.state.sentAt) : null;
          const hasAudio = conn.state.audioChunks > 0 && conn.state.audioBytes > 0;
          const langPurityOk = checkTargetLanguagePurity(rawOut, tc.targetLang);
          const negationOk = tc.polarity === "negative" && NEG_PATTERNS[tc.targetLang] ? NEG_PATTERNS[tc.targetLang].test(rawOut) : true;
          const noChatbotMeta = !CHATBOT_META_RE.test(rawOut);
          const noForbiddenLiteral = tc.forbiddenRegex ? !tc.forbiddenRegex.test(rawOut) : true;
          const concepts = scoreConceptGroups(rawOut, tc.conceptGroups);
          const minConceptRatio = tc.conceptGroups.length >= 4 ? 0.75 : 1.0;
          const completenessOk = concepts.ratio >= minConceptRatio;
          const passed = completed && hasAudio && langPurityOk && negationOk && noChatbotMeta && noForbiddenLiteral && completenessOk;
          runs.push({ rep, passed, outputText: rawOut, audioBytes: conn.state.audioBytes, ttfaMs, comp: `${concepts.matched}/${concepts.total}`, hasAudio, negationOk, langPurityOk });
        }
        conn.close();
      }
      const passCount = runs.filter((r) => r.passed).length;
      const audioCount = runs.filter((r) => (tc.mode === "audio_noise" ? r.passed : r.hasAudio)).length;
      report.push({ id: tc.id, category: tc.category, sourceLang: tc.sourceLang, targetLang: tc.targetLang, passCount, repeats: REPEATS, audioCount, runs });
      console.log(`[${RUN_TAG}] #${tc.id} (${tc.category} ${tc.sourceLang}->${tc.targetLang}): ${passCount}/${REPEATS} pass | audio=${audioCount}/${REPEATS}`);
      for (const r of runs) {
        console.log(`    rep ${r.rep}: ${r.passed ? "PASS" : "FAIL"} (${r.comp || "silent"}) ttfa=${r.ttfaMs}ms audio=${r.audioBytes}B | ${r.outputText}`);
      }
    }

    const outPath = path.join(process.cwd(), "docs", `repeatability-${RUN_TAG}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ tag: RUN_TAG, timestamp: new Date().toISOString(), repeats: REPEATS, report }, null, 2));
    console.log(`[p2c-repeat] Saved -> ${outPath}`);
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("[p2c-repeat] FAILED:", err);
  process.exit(1);
});
