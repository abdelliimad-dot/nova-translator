import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = Number(process.env.NOVA_BENCH_PORT || "3206");
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SECRET = "nova-benchmark-local-secret-0123456789abcdef";

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
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
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

/**
 * 54 Reproducible Translation Benchmark Cases across 9 categories.
 * Note: Text cases send turn content through the exact live Gemini Live WebSocket
 * (`models/gemini-2.5-flash-native-audio-latest`) + `/api/session` prompt pipeline,
 * while acoustic noise/silence trap cases stream raw 16kHz PCM16 via `sendRealtimeInput`.
 */
const BENCHMARK_CASES = [
  // Category 1: Algerian Darija -> French (8 cases)
  { id: 1, category: "Darija->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "صحيت خويا، وين جاي المحطة تاع الترامواي؟" },
  { id: 2, category: "Darija->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "ماعليش، راني جاي دوك فالطريق، عشر دقايق ونكون تما." },
  { id: 3, category: "Darija->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "هادي بزاف غالية، ما تقدرش تنقصلنا شوية فالسومة؟" },
  { id: 4, category: "Darija->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "راني عيان شوية اليوم، حبيت نرقد بكري." },
  { id: 5, category: "Darija->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "واش راك داير فيها هاد اليامات؟ كلش مليح؟" },
  { id: 6, category: "Darija->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "سمحلي خويا، الطاكسي شحال يدي من هنا للمطار؟" },
  { id: 7, category: "Darija->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "ماتقلقش روحك، دروك تفرج بإذن الله." },
  { id: 8, category: "Darija->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "لازم نروحو بكري قبل ما تتعمر الطريق بالزحمة." },

  // Category 2: French -> Arabic / Spoken Register (7 cases)
  { id: 9, category: "FR->AR", langA: "ar", langB: "fr", targetLang: "ar", input: "Excusez-moi, est-ce que cette place est prise ?" },
  { id: 10, category: "FR->AR", langA: "ar", langB: "fr", targetLang: "ar", input: "Je voudrais deux cafés sans sucre et une bouteille d'eau fraîche." },
  { id: 11, category: "FR->AR", langA: "ar", langB: "fr", targetLang: "ar", input: "Mon téléphone n'a presque plus de batterie, je peux charger ici ?" },
  { id: 12, category: "FR->AR", langA: "ar", langB: "fr", targetLang: "ar", input: "À quelle heure part le prochain train pour Alger ?" },
  { id: 13, category: "FR->AR", langA: "ar", langB: "fr", targetLang: "ar", input: "Je suis allergique aux arachides, y en a-t-il dans ce plat ?" },
  { id: 14, category: "FR->AR", langA: "ar", langB: "fr", targetLang: "ar", input: "Franchement, c'est dommage qu'on n'ait pas pu visiter la Casbah." },
  { id: 15, category: "FR->AR", langA: "ar", langB: "fr", targetLang: "ar", input: "Je suis vraiment désolé pour le retard, il y avait un accident sur l'autoroute." },

  // Category 3: Algerian Darija -> English (8 cases)
  { id: 16, category: "Darija->EN", langA: "ar", langB: "en", targetLang: "en", input: "يعطيك الصحة، الماكلة كانت هايلة بزاف." },
  { id: 17, category: "Darija->EN", langA: "ar", langB: "en", targetLang: "en", input: "واش حوالك؟ كلش لاباس فـ الدار؟" },
  { id: 18, category: "Darija->EN", langA: "ar", langB: "en", targetLang: "en", input: "راني مقلق شوية، الطيارة تقلع على الربعة ونص." },
  { id: 19, category: "Darija->EN", langA: "ar", langB: "en", targetLang: "en", input: "علاش راك تزعّف؟ ما قصدتش والو!" },
  { id: 20, category: "Darija->EN", langA: "ar", langB: "en", targetLang: "en", input: "بزاف السخانة اليوم، خلينا نقعدو فالضل." },
  { id: 21, category: "Darija->EN", langA: "ar", langB: "en", targetLang: "en", input: "عندك صرف تاع ألفين دينار؟ ماعنديش مونّي." },
  { id: 22, category: "Darija->EN", langA: "ar", langB: "en", targetLang: "en", input: "مافهمتش واش حاب تقول، عاودلي بالعقل برك." },
  { id: 23, category: "Darija->EN", langA: "ar", langB: "en", targetLang: "en", input: "بارك الله فيك، عاونتني بزاف اليوم." },

  // Category 4: English -> Arabic / Spoken Register (7 cases)
  { id: 24, category: "EN->AR", langA: "ar", langB: "en", targetLang: "ar", input: "My luggage didn't arrive on the carousel; who handles lost bags?" },
  { id: 25, category: "EN->AR", langA: "ar", langB: "en", targetLang: "ar", input: "Could you break a fifty? I only have large bills." },
  { id: 26, category: "EN->AR", langA: "ar", langB: "en", targetLang: "ar", input: "Don't sweat it, we'll figure it out once we get to the hotel." },
  { id: 27, category: "EN->AR", langA: "ar", langB: "en", targetLang: "ar", input: "Wait, are you saying the train already left?" },
  { id: 28, category: "EN->AR", langA: "ar", langB: "en", targetLang: "ar", input: "I need a prescription for this medication because I have allergies." },
  { id: 29, category: "EN->AR", langA: "ar", langB: "en", targetLang: "ar", input: "Is tax and service included in the final price, or charged separately?" },
  { id: 30, category: "EN->AR", langA: "ar", langB: "en", targetLang: "ar", input: "It was a pleasure meeting you. Have a safe flight home!" },

  // Category 5: Arabic + French Code-Switching (6 cases)
  { id: 31, category: "CodeSwitch->EN", langA: "ar", langB: "en", targetLang: "en", input: "الدوسيي راهو ناقصو الـ attestation de résidence، لازم تجيبها غدوة." },
  { id: 32, category: "CodeSwitch->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "الريزو راهو مقطع هنا، ما سمعتكش مليح." },
  { id: 33, category: "CodeSwitch->EN", langA: "ar", langB: "en", targetLang: "en", input: "راني نستنا فيك عند الـ arrêt تاع الـ bus." },
  { id: 34, category: "CodeSwitch->EN", langA: "ar", langB: "en", targetLang: "en", input: "جرب تطفي الـ Bluetooth وتعاود تـ connect-ي غير بـ A2DP." },
  { id: 35, category: "CodeSwitch->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "هاد الـ rendez-vous مهم بزاف، لازم نكونو à l'heure." },
  { id: 36, category: "CodeSwitch->EN", langA: "ar", langB: "en", targetLang: "en", input: "بعثتلك الـ localisation فـ WhatsApp باش ما تتلفش." },

  // Category 6: Numbers, Dates, Names & Addresses (6 cases)
  { id: 37, category: "Entities->EN", langA: "ar", langB: "en", targetLang: "en", input: "المجموع ألفين وأربعمية وخمسين دينار جزائري، أو حوالي سبعطاش يورو.", requiredPattern: /(2,?450|2450).*(17|seventeen)/i },
  { id: 38, category: "Entities->EN", langA: "ar", langB: "en", targetLang: "en", input: "اسمي عبد الرحمن بلقاسم، نسكن في 14 نهج ديدوش مراد، الجزائر الوسطى.", requiredPattern: /14|fourteen/i },
  { id: 39, category: "Entities->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "موعدنا نهار 25 نوفمبر 2026 على الساعة 14:15.", requiredPattern: /25.*2026/i },
  { id: 40, category: "Entities->AR", langA: "ar", langB: "en", targetLang: "ar", input: "Where is boarding gate 12 for flight TK652 to Istanbul?", requiredPattern: /(12|اثني عشر|عشر|إسطنبول|اسطنبول)/i },
  { id: 41, category: "Entities->EN", langA: "ar", langB: "en", targetLang: "en", input: "رقم الهاتف هو 0551 23 45 67 والرمز هو 8492.", requiredPattern: /8492|8[\s-]?4[\s-]?9[\s-]?2/i },
  { id: 42, category: "Entities->AR", langA: "ar", langB: "fr", targetLang: "ar", input: "Le rendez-vous est déplacé à jeudi prochain à quatorze heures trente.", requiredPattern: /(الخميس|14|الثانية|الساعة)/i },

  // Category 7: Questions, Urgent Warnings & Emotional Expressions (6 cases)
  { id: 43, category: "Emotion->EN", langA: "ar", langB: "en", targetLang: "en", input: "حذاري! الطوموبيل راهي جاية من اليسار!" },
  { id: 44, category: "Emotion->EN", langA: "ar", langB: "en", targetLang: "en", input: "والله فرحتلك من قلبي، ألف مبروك على النجاح!" },
  { id: 45, category: "Emotion->AR", langA: "ar", langB: "en", targetLang: "ar", input: "Are you feeling any better today, or does your head still hurt?" },
  { id: 46, category: "Emotion->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "علاش خايف؟ أنا معاك وماتخاف من والو." },
  { id: 47, category: "Emotion->AR", langA: "ar", langB: "fr", targetLang: "ar", input: "Attention ! La marche est très glissante ici !" },
  { id: 48, category: "Emotion->EN", langA: "ar", langB: "en", targetLang: "en", input: "بصراحة راني حيران، ماعرفتش واش نخير." },

  // Category 8: Idioms & Culturally Specific Expressions (4 cases)
  { id: 49, category: "Idiom->EN", langA: "ar", langB: "en", targetLang: "en", input: "اللي فات مات، خلينا نبداو صفحة جديدة." },
  { id: 50, category: "Idiom->EN", langA: "ar", langB: "en", targetLang: "en", input: "على راسي وعيني، ماشي مشكل خلاص." },
  { id: 51, category: "Idiom->AR", langA: "ar", langB: "en", targetLang: "ar", input: "Let's call it a day and pick this up fresh tomorrow morning." },
  { id: 52, category: "Idiom->FR", langA: "ar", langB: "fr", targetLang: "fr", input: "كل تأخيرة فيها خيرة إن شاء الله." },

  // Category 9: Acoustic Anti-Hallucination Audio Traps (2 real 16kHz PCM16 cases)
  { id: 53, category: "NoiseTrap-Audio", langA: "ar", langB: "en", targetLang: "none", mode: "audio_silence", input: "<2.0s digital silence PCM16>" },
  { id: 54, category: "NoiseTrap-Audio", langA: "ar", langB: "en", targetLang: "none", mode: "audio_noise", input: "<2.0s low-level broadband static PCM16>" },
];

const CHATBOT_META_RE =
  /\b(sure, here is|here is the translation|as an ai|i can translate|translated to)\b/i;

function checkTargetScript(text, targetLang) {
  const arChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  if (targetLang === "ar") {
    return arChars >= 3 && arChars > latinChars;
  }
  if (targetLang === "en" || targetLang === "fr") {
    return latinChars >= 4 && latinChars > arChars;
  }
  return false;
}

async function createSessionForPair(cookieJar, langA, langB) {
  const res = await fetch(`${BASE_URL}/api/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(cookieJar),
    },
    body: JSON.stringify({ langA, langB, voiceName: "Aoede" }),
  });
  assert.equal(res.status, 200, `/api/session (${langA}<->${langB}) must return 200`);
  const payload = await res.json();

  const ai = new GoogleGenAI({
    apiKey: payload.token,
    httpOptions: { apiVersion: "v1alpha" },
  });

  let setupDone = false;
  const waiters = new Set();
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
        if (msg.setupComplete) {
          setupDone = true;
          for (const w of waiters) w();
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
          for (const w of waiters) w();
        }
      },
      onerror: (err) => {
        console.error("[bench] WS error:", err?.message || err);
      },
    },
  });

  const setupDeadline = Date.now() + 10000;
  while (!setupDone && Date.now() < setupDeadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(setupDone, "Gemini Live session setupComplete timed out");

  return {
    session,
    state,
    resetTurnState() {
      state.outputText = "";
      state.audioChunks = 0;
      state.audioBytes = 0;
      state.firstAudioAt = null;
      state.turnDone = false;
      state.sentAt = performance.now();
    },
    async waitTurnComplete(timeoutMs = 12000) {
      const end = Date.now() + timeoutMs;
      while (!state.turnDone && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 60));
      }
      return state.turnDone;
    },
    close() {
      waiters.clear();
      session.close();
    },
  };
}

async function runBenchmark() {
  const env = { ...loadEnvLocalIfPresent(), NOVA_AUTH_SECRET: SECRET, NODE_ENV: "production" };
  assert.ok(env.GEMINI_API_KEY, "GEMINI_API_KEY is required in .env.local to run benchmark");

  console.log(`[bench] Starting isolated local server on ${BASE_URL}...`);
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const serverProc = spawn(
    process.execPath,
    [nextBin, "start", "-H", "127.0.0.1", "-p", String(PORT)],
    { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] }
  );

  try {
    await waitForServer(`${BASE_URL}/`);
    const homeRes = await fetch(`${BASE_URL}/`);
    const jar = parseSetCookies(homeRes.headers);

    const results = [];
    // Group cases by (langA, langB) to run cleanly inside separate sessions (resetting after every 8 turns to keep context uncluttered)
    const pairs = [
      ["ar", "fr"],
      ["ar", "en"],
    ];

    for (const [langA, langB] of pairs) {
      const pairCases = BENCHMARK_CASES.filter(
        (c) => c.langA === langA && c.langB === langB
      );
      let conn = null;
      let turnsInConn = 0;

      for (const tc of pairCases) {
        if (!conn || turnsInConn >= 8) {
          conn?.close();
          // Fresh anonymous sid if needed after several sessions
          conn = await createSessionForPair(jar, langA, langB);
          turnsInConn = 0;
        }

        conn.resetTurnState();

        if (tc.mode === "audio_silence" || tc.mode === "audio_noise") {
          const totalSamples = 16000 * 2; // 2.0 seconds @ 16kHz
          const frameSize = 1600; // 100ms chunks
          for (let offset = 0; offset < totalSamples; offset += frameSize) {
            const pcm = new Int16Array(frameSize);
            if (tc.mode === "audio_noise") {
              for (let j = 0; j < frameSize; j++) {
                pcm[j] = Math.round((Math.random() - 0.5) * 180); // very quiet room hum
              }
            }
            conn.session.sendRealtimeInput({
              audio: {
                data: Buffer.from(pcm.buffer).toString("base64"),
                mimeType: "audio/pcm;rate=16000",
              },
            });
            await new Promise((r) => setTimeout(r, 25));
          }
          conn.session.sendRealtimeInput({ audioStreamEnd: true });
          await conn.waitTurnComplete(3500);
          const cleanOut = conn.state.outputText.replace(/<[^>]+>/g, "").trim();
          const silentPass = cleanOut.length === 0 && conn.state.audioBytes === 0;
          results.push({
            ...tc,
            passed: silentPass,
            outputText: cleanOut,
            audioChunks: conn.state.audioChunks,
            audioBytes: conn.state.audioBytes,
            ttfaMs: null,
            noChatbotMeta: true,
          });
          console.log(
            `[bench] #${tc.id} (${tc.category}) pass=${silentPass} outLen=${cleanOut.length} audioBytes=${conn.state.audioBytes}`
          );
          turnsInConn += 1;
          continue;
        }

        conn.session.sendClientContent({
          turns: [{ role: "user", parts: [{ text: tc.input }] }],
          turnComplete: true,
        });

        const completed = await conn.waitTurnComplete(14000);
        const rawOut = conn.state.outputText.trim();
        const ttfaMs =
          conn.state.firstAudioAt !== null
            ? Math.round(conn.state.firstAudioAt - conn.state.sentAt)
            : null;
        const scriptOk = checkTargetScript(rawOut, tc.targetLang);
        const hasAudio = conn.state.audioChunks > 0 && conn.state.audioBytes > 0;
        const noChatbotMeta = !CHATBOT_META_RE.test(rawOut);
        const entityOk = tc.requiredPattern ? tc.requiredPattern.test(rawOut) : true;
        const passed = completed && scriptOk && hasAudio && noChatbotMeta && entityOk;

        results.push({
          id: tc.id,
          category: tc.category,
          langA: tc.langA,
          langB: tc.langB,
          targetLang: tc.targetLang,
          input: tc.input,
          outputText: rawOut,
          audioChunks: conn.state.audioChunks,
          audioBytes: conn.state.audioBytes,
          ttfaMs,
          completed,
          scriptOk,
          hasAudio,
          noChatbotMeta,
          entityOk,
          passed,
        });

        console.log(
          `[bench] #${tc.id} (${tc.category}) pass=${passed} ttfa=${ttfaMs}ms out="${rawOut.slice(0, 70)}"`
        );
        turnsInConn += 1;
      }

      conn?.close();
    }

    const total = results.length;
    const passedCount = results.filter((r) => r.passed).length;
    const ttfaValues = results
      .map((r) => r.ttfaMs)
      .filter((v) => typeof v === "number")
      .sort((a, b) => a - b);

    const avgTtfa =
      ttfaValues.length > 0
        ? Math.round(ttfaValues.reduce((s, v) => s + v, 0) / ttfaValues.length)
        : null;
    const p50Ttfa =
      ttfaValues.length > 0
        ? ttfaValues[Math.floor(ttfaValues.length * 0.5)]
        : null;
    const p95Ttfa =
      ttfaValues.length > 0
        ? ttfaValues[Math.min(ttfaValues.length - 1, Math.floor(ttfaValues.length * 0.95))]
        : null;

    const summary = {
      timestamp: new Date().toISOString(),
      model: "models/gemini-2.5-flash-native-audio-latest",
      totalCases: total,
      passedCases: passedCount,
      passRatePct: Number(((passedCount / total) * 100).toFixed(1)),
      ttfaMsStats: { count: ttfaValues.length, avg: avgTtfa, p50: p50Ttfa, p95: p95Ttfa },
      results,
    };

    fs.writeFileSync(
      path.join(process.cwd(), "docs", "benchmark-results-phase1_2.json"),
      JSON.stringify(summary, null, 2),
      "utf8"
    );

    console.log(
      `[bench] DONE: ${passedCount}/${total} (${summary.passRatePct}%) | TTFA avg=${avgTtfa}ms p50=${p50Ttfa}ms p95=${p95Ttfa}ms`
    );
    assert.ok(total >= 50, "Benchmark must execute at least 50 cases");
  } finally {
    serverProc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 350));
    if (!serverProc.killed) serverProc.kill("SIGKILL");
  }
}

void runBenchmark().catch((err) => {
  console.error("[bench] FAILED:", err);
  process.exit(1);
});
