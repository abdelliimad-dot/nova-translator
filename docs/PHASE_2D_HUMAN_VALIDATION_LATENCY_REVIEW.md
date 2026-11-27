# NOVA — Phase 2D: Human Translation Validation & Latency Review

**Scope:** Local-only freeze verification, offline human-review package creation, residual-case adjudication analysis, and zero-cost statistical/component TTFA investigation (no deployments, no DB writes, no commits/pushes, no prompt/model/dataset/rubric changes, and zero unbudgeted extra API benchmark runs).  
**Date:** 2026-11-26  
**Candidate Under Review:** Phase 2C (Frozen)

---

## 1. Phase 2C Frozen-Version Details

All Phase 2C source files, benchmark datasets, scoring scripts, and JSON outputs remain untouched in the local workspace. The exact reproducible snapshot manifest was recorded in [phase2c-freeze-manifest.json](./snapshots/phase2c-freeze-manifest.json).

- **Git Base Commit (`HEAD`):** `fc1bba5dbc94c6986e4d514646f7a958f0bec0dc` (Phase 2A/2B/2C edits remain uncommitted local workspace state per local-only rules).
- **Gemini Model Configured (`app/api/session/route.ts`):** `models/gemini-2.5-flash-native-audio-latest` (`responseModalities: [Modality.AUDIO]`, `temperature: 0.35`, `thinkingConfig: { thinkingBudget: 0 }`, `contextWindowCompression: { triggerTokens: "12000", slidingWindow: { targetTokens: "4000" } }`, `voiceName: "Aoede"` default).
- **Frozen Prompt Function (`lib/languages.ts` -> `buildInterpreterSystemPrompt`):**
  - `buildInterpreterSystemPrompt` SHA-256: `46533177d937d0dc6a14883aee6f0fc0906fd7456d63c78c64da6973e5d69106`
  - Baseline `HEAD` SHA-256 (for diff provenance): `dfc67700f973649ef92c31cd1eba7f8270867ca1756bd7eba776bea93dbe583f`
  - `lib/languages.ts` full file (`8,333` bytes) SHA-256: `744cacad1c6176f7ad950d5f9d19578525dfe461828af2d1dc1b69d1ee2b4095`

Exact frozen Phase 2C `buildInterpreterSystemPrompt` implementation (`lib/languages.ts`):

```ts
export function buildInterpreterSystemPrompt(
  langA: string,
  langB: string
): string {
  const isArabicInvolved =
    /arabic/i.test(langA) || /arabic/i.test(langB);
  const dialectGuidance = isArabicInvolved
    ? ` For Arabic, understand both Modern Standard Arabic (Fusha) and spoken regional dialects—especially North African / Algerian Darija (including negated forms like ماشي / ما...ش / والو, Maghrebi vocabulary, and French/English loanwords)—effortlessly; when translating into Arabic, speak in clear Modern Standard Arabic (Fusha) using standard Arabic vocabulary rather than regional dialect slang or transliterated foreign loanwords.`
    : "";

  return (
    `You are a professional simultaneous voice interpreter between ${langA} and ${langB}.${dialectGuidance} ` +
    `Translate strictly by natural conversational meaning and intent, NEVER word-for-word or literally—render greetings, idioms, and everyday expressions into smooth, idiomatic target speech. ` +
    `STRICT FIDELITY: Preserve exact polarity and negations (never invert negative statements such as "ماشي أنا" / "ne...pas" / "don't" into affirmative), numbers, dates, times, names, forms of address, and final self-corrected choices without omitting key meaning. ` +
    `VOCAL DELIVERY & PROSODY: Speak like a warm, attentive human conversation partner—use natural human cadence, relaxed phrasing, and expressive emotional intonation mirroring the speaker's tone, NEVER flat or robotic. ` +
    `On EVERY utterance independently, detect which language is spoken: if ${langA}, output ONLY the spoken translation in ${langB}; if ${langB}, output ONLY the spoken translation in ${langA}. Never stick to the previous turn's direction. ` +
    `STRICT ANTI-HALLUCINATION RULE: If input is background noise, breathing, silence, coughs, clicks, <noise>, or unintelligible speech, output NOTHING and stay completely silent. ` +
    `Never guess or invent words, answer questions, add commentary, or break character.`
  );
}
```

---

## 2. Reproducibility Verification

Cryptographic SHA-256 digests and exact artifact inventory verified against local files on disk (zero edits to code, dataset, rubric, or results):

| Artifact | Bytes | SHA-256 Digest |
| --- | ---: | --- |
| `lib/languages.ts` | 8,333 | `744cacad1c6176f7ad950d5f9d19578525dfe461828af2d1dc1b69d1ee2b4095` |
| `app/api/session/route.ts` | 6,262 | `84357714c936c5c3c41962061fd8ed6fe17acaa164d3af053fa679505424760e` |
| `lib/ai/geminiLiveClient.ts` | 19,067 | `eb812f8940511756fe054ad3b9a248aa65fff81baa221b4abad8347f3827d09c` |
| `scripts/datasets/phase2a-benchmark-108.mjs` | 58,286 | `b2f278c262051ad28075bcc3bf8f7ce843c1dbff7b1949954a911082207d9371` |
| `scripts/run-phase2a-benchmark.mjs` | 22,570 | `61d19f34587a3bd4065012ca8bc75a058eef0fe8e79463ab1b2c836fdd89970d` |
| `scripts/phase2c-repeatability.test.mjs` | 12,368 | `dec4fd7bd6f0cf4b30cf2571d3cc83b64e443547754623335c6346bd8e2b112b` |
| `docs/benchmark-phase2a-baseline.json` | 116,000 | `d844b6923c0e21d4ab5905cf243cafb1b5870aa3800e7774339e59696f5f2302` |
| `docs/benchmark-phase2a-improved.json` | 113,325 | `06f89ddf67a63b910e17e0638ed6edf0a7b8ff9ac05e1745b8e65a591dbaecca` |
| `docs/benchmark-phase2a-phase2b.json` | 110,707 | `fbbac4a33b29813e490e244059b6093a7ba81cd64fdf4c9d8fae233518599afe` |
| `docs/benchmark-phase2a-phase2c.json` | 106,549 | `4a5e3fc7b98187d1808bf0789c2f9c6c5ad35a3f2fb36c557ec1edabc7e511e5` |
| `docs/repeatability-phase2b-repeat.json` | 16,572 | `28178736f691d0963d67d18052645e7288884d3162aa04462f1a0f2357a96a5b` |
| `docs/repeatability-phase2c-repeat.json` | 16,257 | `e288539cc9dca6fc7d168b7bce0039ad825fff6a1991798951caac62e48a4787` |
| `docs/PHASE_2C_TRANSLATION_REGRESSION_RECOVERY.md` | 25,256 | `a8ea237ba81af1b28c7e5bc672e3e57a067939289116fee000f82a210a8523b1` |

- **Verified Test Commands (Passed After Final Phase 2C Prompt Edit):**
  - `npx tsc --noEmit` (`exit 0`)
  - `npm run lint` (`exit 0`)
  - `npm run build` (`exit 0`)
  - `node scripts/security-regression.test.mjs` (`exit 0`)
  - `node scripts/phase1_1-readiness.test.mjs` (`exit 0`)
  - `node scripts/functional-regression.test.mjs` (`exit 0`)
  - `node scripts/qa-audio-lifecycle.test.mjs` (`exit 0`)
  - `node scripts/qa-gemini-client.test.mjs` (`exit 0`)
  - `node scripts/run-phase2a-benchmark.mjs --tag phase2c` (`106/108 = 98.1%`, `exit 0`)

---

## 3. Human Review Package & Offline Workflow

An offline human-review package was generated strictly locally with zero external uploads:

- **Primary Fillable Review Workbook:** [docs/reviews/PHASE_2C_HUMAN_REVIEW.md](./reviews/PHASE_2C_HUMAN_REVIEW.md)
- **Structured Offline Exports:** [docs/reviews/phase2c-human-review-package.json](./reviews/phase2c-human-review-package.json) and UTF-8 BOM [docs/reviews/phase2c-human-review.csv](./reviews/phase2c-human-review.csv)
- **Human Review Status:** **PENDING (NOT YET EXECUTED)**.
- **Scope Constraint (Text-Only):** Generated PCM audio streams from `phase2c` were not recorded to disk during benchmarking (only chunk counts, byte counts, and `outputTranscription` strings exist in JSON). Therefore, this package evaluates **text accuracy, idiomatic quality, completeness, and register only** (`0 = Incorrect/unusable` to `4 = Excellent` across all 12 requested categories). Voice prosody, accent, pronunciation, and intelligibility cannot be rated here and must be tested via live listening in Phase 3.

---

## 4. All 24 Shortlist Review Cases (25 Turns)

Shortlist row `#24` (`#105/#106` paired bilateral turn) is expanded into both underlying spoken turns (`105` and `106`) in the fillable sheets so reviewers score both directions individually (`24` shortlist items / `25` rated rows):

| # | Case ID | Dir | Category | Auto Rubric | Phase 2C Output (Summary Reference) | What Is Tested |
| :---: | :---: | :---: | --- | :---: | --- | --- |
| 1 | `#17` | `ar->en` | Darija Idioms | `PASS (3/3)` | `Absolutely, I'll send you all the papers right now.` | Idiom `"على راسي وعيني"` non-literal rendering & warmth |
| 2 | `#15` | `ar->en` | Darija Idioms | `PASS (2/2)` | `What's past is past, let's start a new page.` | Idiom `"اللي فات مات"` + `"صفحة جديدة"` |
| 3 | `#19` | `ar->en` | Darija Slang | `PASS (2/2)` | `Don't bother yourself with him, just let him talk.` | Slang `"ما تكسرش راسك"` + casual negation |
| 4 | `#23` | `ar->en` | Darija Slang | `PASS (2/2)` | `Why are you getting upset? I swear I didn't mean anything by it!` | Emotional defense + negation `"ما قصدتش والو"` |
| 5 | `#3` | `ar->fr` | Darija Everyday | `PASS (2/2)` | `C'est beaucoup trop cher, vous ne pouvez pas nous réduire un peu le prix ?` | Bargaining intent + plural `"لنا"` (`nous`) |
| 6 | `#7` | `ar->en` | Darija Regional | `PASS (2/2)` | `How are you? Is everything okay at home?` | Algerian greeting `"واش حوالك / فـ الدار"` |
| 7 | `#24` | `ar->en` | Darija+FR Mix | `PASS (3/3)` | `The file is missing the residence certificate; you must bring it tomorrow.` | Inline French noun `"attestation de résidence"` |
| 8 | `#30` | `ar->en` | Darija+EN Mix | `PASS (4/4)` | `The server has been down since this morning; the team is working on fixing it.` | Embedded English tech nouns in Darija syntax |
| 9 | `#55` | `fr->en` | FR+Darija Mix | **`FAIL (1/3)`** | `Seriously, that's too expensive, give me a discount.` | Code-switch `"ghali sahbi"` + `"fais-moi un prix"` (see Section 5) |
| 10 | `#56` | `fr->ar` | FR+Darija Mix | `PASS (3/3)` | `سمحلي خويا، تعطلت بسبب الازدحام.` | Mixed apology `"Désolé khoya"` |
| 11 | `#37` | `fr->ar` | FR Conversational | `PASS (2/2)` | `اعذرني، هل هذا المقعد مشغول من قبل؟` | Polite register into clear Fusha |
| 12 | `#41` | `fr->ar` | FR Conversational | `PASS (3/3)` | `هل يمكنك أن تعطيني إيصالا بختم الفندق؟` | Clear Arabic noun `"إيصالا"` vs phonetic loanword |
| 13 | `#47` | `fr->ar` | FR Fast Speech | `PASS (3/3)` | `مانيش عارف إذا كان راح يجي الليلة، ما أكدلي والو.` | Informal fast French `"Chais pas trop"` + `"rien"` |
| 14 | `#64` | `en->ar` | EN Idioms | `PASS (2/2)` | `لا تقلق، سنجد حلاً عندما نصل إلى الفندق.` | Idiom `"Don't sweat it"` + uncontracted `"إلى الفندق"` |
| 15 | `#65` | `en->fr` | EN Idioms | `PASS (3/3)` | `On arrête pour aujourd'hui et on reprend ça demain matin à tête reposée.` | Idioms `"call it a day"` + `"pick back up fresh"` |
| 16 | `#70` | `en->ar` | EN Proper Nouns | `PASS (3/3)` | `الآن يتم الصعود إلى طائرة الخطوط الجوية الجزائرية رحلة AH 1004 من مطار لندن هيثرو.` | Airline, `AH 1004`, Heathrow integrity |
| 17 | `#74` | `en->ar` | EN Numbers/Dates | `PASS (3/3)` | `سلم الطرد إلى 14 شارع ديدوش مراد، الجزائر 16000.` | Street `14`, Didouche Mourad, postal `16000` |
| 18 | `#78` | `en->ar` | EN Context | `PASS (3/3)` | `هل يمكنني شحن هاتفي خلف المنضدة، ليس بطاقة الائتمان بعد؟` | Polysemous `"charge"` (battery vs payment) |
| 19 | `#81` | `ar->en` | Difficult Short | **`FAIL (0/1)`** | `How many?` | Standalone 1-word question `"شحال؟"` (see Section 6) |
| 20 | `#97` | `ar->en` | Difficult Corrections | `PASS (2/2)` | `We'll meet on Thursday... no, sorry, I mean on Friday at three.` | Mid-sentence self-correction preservation |
| 21 | `#101` | `ar->en` | Difficult Negation | `PASS (2/2)` | `It wasn't me who forgot the key, it's still in the office.` | Darija negative pronoun `"ماشي أنا"` |
| 22 | `#103` | `en->ar` | Difficult Negation | `PASS (3/3)` | `لا نقبل الدفع نقدا بعد الساعه الثامنه مساءً، بطاقات مصرفيه فقط.` | Cash negation + time + card constraint in Fusha |
| 23 | `#104` | `ar->fr` | Difficult Negation | `PASS (3/3)` | `Ne t'inquiète pas, cette décision n'a aucune incidence sur ton visa.` | Double negation (`ما تخافش... ما عندوش حتى تأثير`) |
| 24a | `#105` | `ar->en` | Multi-Speaker Turn 1 | `PASS (2/2)` | `I am ready to pay now.` | Rapid bilateral switching Turn A |
| 24b | `#106` | `en->ar` | Multi-Speaker Turn 2 | `PASS (2/2)` | `عظيم، هل تفضل الدفع بالبطاقه أو نقدا؟` | Immediate direction flip Turn B |

*(Full inputs, reference translations, and fillable 12-dimension scorecards appear in [PHASE_2C_HUMAN_REVIEW.md](./reviews/PHASE_2C_HUMAN_REVIEW.md).)*

---

## 5. Case #55 Adjudication Analysis

- **Input (`fr->en`, French+Darija Mix):** `Franchement c'est trop ghali sahbi, fais-moi un prix.`
- **Actual Frozen Dataset Reference (`scripts/datasets/phase2a-benchmark-108.mjs`):**  
  `Honestly that's way too expensive my friend, give me a better price.`  
  *(Correction note: The prompt brief cited `Seriously, that's too expensive, give me a discount.` as both Reference and Output, whereas the frozen benchmark dataset actually specifies `Honestly that's way too expensive my friend, give me a better price.` and requires all 3 concept groups `[["expensive"], ["friend","bro","buddy"], ["price"]]`.)*
- **Actual Phase 2C Output:** `Seriously, that's too expensive, give me a discount.`
- **Repeatability Check History (`6` total isolated runs + `4` full runs):**
  - Core semantics (`too expensive` + requesting a lower price) were conveyed in 100% of runs after Baseline (`improved`, `phase2b`, `phase2c`, plus all 6 repeatability turns used `"give me a discount"` or `"give me a better price"` — only Baseline mistranslated `"fais-moi un prix"` as `"give me a break"`).
  - Vocative `"sahbi"` (*my friend*) was **omitted** in 4/4 full-benchmark runs (`baseline`, `improved`, `phase2b`, `phase2c`) and in 2/6 repeatability turns (the other 4 repeatability turns kept `"friend"` or `"man"`, e.g. `"Honestly, that's way too expensive, man, give me a discount."`).
- **Linguistic & Rubric Assessment:**
  1. **Does omitting `sahbi` materially change meaning?** Pragmatically it softens interpersonal warmth/camaraderie (*bro / mate / my friend*), which matters in Maghrebi social rapport, though it does **not** alter the commercial bargaining proposition (`too expensive` -> `ask for lower price`). On the 0–4 human scale this represents a minor-to-moderate pragmatic omission (score ~`2–3` depending on reviewer weight on forms of address), not a meaning inversion.
  2. **Is `"give me a discount"` natural and semantically accurate for `"fais-moi un prix"`?** **Yes — completely natural idiomatic French-to-English.** In French market bargaining, `"fais-moi un prix"` specifically means *"give me a discount / cut me a deal on the price."*
  3. **Is the rubric overly literal on `"price"` vs `"discount"`?** **Partially yes** (`conceptGroup 3` only allows `["price"]`, excluding `"discount"` and `"deal"`), **AND** correctly flagging a real omission on `"sahbi"` (`["friend","bro","buddy"]`). Even if `"discount"` were accepted in `"conceptGroup 3"`, Phase 2C still omitted `"sahbi"` (`2/3`), which fails the `<4`-concept `100%` rule.
- **Decision (Frozen Integrity Preserved):**
  - Keep the frozen reference translation and rubric untouched.
  - Retain `#55` as a **benchmark fail (`1/3`)** in quantitative Phase 2C scores, classified under **Adjudication Queue: Minor Pragmatic Omission (`sahbi`) + Idiomatic Synonym Mismatch (`discount` vs `price`)**.

---

## 6. Case #81 Ambiguity Analysis

- **Input (`ar->en`, Difficult Short):** `شحال؟`
- **Frozen Reference:** `How much?` (concept group: `[["how much","what price","cost"]]`)
- **Actual Phase 2C Output:** `How many?`
- **Historical & Repeatability Behavior:** Passed in `baseline` (`How much?`), failed in `improved` / `phase2b` / `phase2c` (`How many?`), and **passed 6/6 (`100%`)** in `phase2b-repeat` (3/3) and `phase2c-repeat` (3/3) (`How much?`). Across all observed runs, standalone `شحال؟` exhibits binary `How much?` vs `How many?` variance.
- **Linguistic Analysis:**
  1. In Algerian Darija, interrogative `شحال؟` translates *equally validly* to **`How much?`** (price/uncountable amount: *شحال السومة؟ / شحال هادي؟*) AND **`How many?`** (countable quantity: *شحال من واحد؟ / شحال بقى؟*).
  2. Does the benchmark provide disambiguating context? **No.** `#81` is an isolated single-word turn sent at Turn 1 of its own context or after unrelated sentences without a noun, currency, or shopping cue. (Note: Case `#82` is `fr->en` `"C'est combien ?"` — unlike Darija `شحال؟`, French `"C'est combien ?"` unambiguously asks price.)
  3. Is `How many?` a legitimate translation? **Yes**, out of context. While price inquiries in travel/shopping scenarios often nudge human listeners toward `"How much?"`, neither output is wrong without prior context.
- **Decision (Frozen Integrity Preserved):**
  - Do **not** override `#81` into a pass in Phase 2C's `106/108` score.
  - Label `#81` formally as **Context-Ambiguous Standalone Lexical Item (`How much?` / `How many?`)** rather than a model translation failure. (Recommended Phase 2E dataset note: either pair `#81` with a prior price context or document ambiguity adjudication.)

---

## 7. TTFA Regression Investigation (Zero Extra Paid API Calls)

Per Task 5 boundaries, all existing saved telemetry files were exhausted before making any additional paid Gemini Live calls. The saved local JSON datasets already contain `108 × 4` full-run turns plus `78` repeatability spoken turns (`42` per batch × 2 batches) and `300` WebAudio scheduling turns:

### 7.1 Component Breakdown Across Benchmarks

| Pipeline Stage | Baseline | Phase 2A (`improved`) | Phase 2B (`phase2b`) | Phase 2C (`phase2c`) | Included in `geminiTtfaMs`? | Source Artifact |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| **Token Mint (`/api/session`)** `avg/p50/p95` | 492 / 468 / 720 ms | 386 / 399 / 475 ms | 441 / 464 / 707 ms | 513 / 487 / 837 ms | No (`pre-session`) | `benchmark-phase2a-*.json` (`n=12`) |
| **Gemini WS Connect + Setup** `avg/p50/p95` | 825 / 800 / 1068 ms | 705 / 762 / 893 ms | 867 / 859 / 1245 ms | 887 / 901 / 1174 ms | No (`pre-turn`) | `benchmark-phase2a-*.json` (`n=12`) |
| **Gemini Inference + 1st Audio Chunk (`ttfaMs`)** | **1170 / 1074 / 1785 ms** | **1172 / 1039 / 1844 ms** | **1215 / 1080 / 1736 ms** | **1407 / 1261 / 2300 ms** | **Yes (`firstAudioAt - sentAt`)** | `benchmark-phase2a-*.json` (`n=106` speech) |
| **Mode B Relay -> SSE Delivery** `avg/p50/p95` | 30 / 29.9 / 49.8 ms | 25 / 25.9 / 43.4 ms | 28 / 26.9 / 56.4 ms | **25 / 28.3 / 40.9 ms** | No | `benchmark-phase2a-*.json` (`n=15`) |
| **PCM16 3840-sample Decode** (`avg`) | 0.022 ms | 0.0261 ms | 0.0407 ms | **0.0275 ms** | No | `benchmark-phase2a-*.json` (`n=500`) |
| **WebAudio Schedule Latency** (`qa-audio`) | — | — | — | 0.046 / 0.035 / 0.124 ms | No | `qa-audio-lifecycle-metrics.json` (`n=300`) |
| **DSP / VAD / Jitter Constants** | — | VAD end 520 ms, Jitter 45 ms | VAD end 520 ms, Jitter 45 ms | VAD end 520 ms, Jitter 45 ms | No (runner uses `sendClientContent`) | `dspConstantsMs` |

**Rule Out Non-Contributors:**
- **Session token endpoint, WebSocket handshake, Mode B relay, PCM decode, AudioContext scheduling, and VAD timers did NOT cause the `ttfaMs` jump.** Token mint (+72 ms) and WS setup (+20 ms) happen before `resetTurn()` sets `sentAt = performance.now()`, while local relay (`25 ms`) and PCM decode (`0.0275 ms`) were actually slightly faster in Phase 2C.
- **Measurement methodology did NOT change:** SHA-256 of `scripts/run-phase2a-benchmark.mjs` is unchanged (`61d19f34...`) across Phase 2B and Phase 2C; both runs executed on local `next start` at `127.0.0.1:3208` sending `sendClientContent` text turns.

---

## 8. Phase 2B vs Phase 2C Latency Comparison & Stratified Evidence

### 8.1 Paired Comparison on Full 108-Case Benchmark (`n = 106` Spoken Cases)

- **Phase 2B (`2026-11-26T06:12:35Z`):** `mean = 1215 ms` | `median = 1080 ms` | `P95 = 1736 ms` | `min = 880 ms` | `max = 2402 ms` | `>= 2000 ms`: `5/106`
- **Phase 2C (`2026-11-26T06:39:59Z`):** `mean = 1407 ms` | `median = 1261 ms` | `P95 = 2300 ms` | `min = 872 ms` | `max = 2817 ms` | `>= 2000 ms`: `13/106`
- **Paired Per-Case Difference (`Phase 2C - Phase 2B`, `n = 106`):**
  - Mean delta: **`+192.0 ms`** (`SD = 603.9 ms`, `SE = 58.7 ms`, `95% CI = [+77.1, +307.0] ms`, paired `t = 3.27`)
  - Median delta: **`+106 ms`** (`IQR [-84, +565] ms`, `P95 = +1333 ms`, `69/106` slower vs `37/106` faster).

### 8.2 Why Prompt Length Alone Does Not Explain the Observed Increase

Testing candidate explanations against stratified sub-slices refutes a simple prompt-size cause:

1. **Prompt Char Lengths (`lib/languages.ts`):**
   - `Arabic<->English`: Phase 2B `1,498` chars vs Phase 2C `1,662` chars (`+164` chars, ~30 words).
   - `Arabic<->French`: Phase 2B `1,495` chars vs Phase 2C `1,659` chars (`+164` chars).
   - `French<->English` (`isArabicInvolved === false`): Phase 2B `1,179` chars vs Phase 2C `1,233` chars (**only +54 chars, and 35 chars SHORTER than Baseline `1,268` chars!**).
2. **Stratified Paired Deltas by Session Execution Block:**
   - **`ar:fr` (`n = 34`, executed FIRST):** Mean delta = **`+67.8 ms`** (`SE = 88.9`, **`95% CI [-106.3, +242.0]`**, `t = 0.76`) — **not statistically distinguishable from zero**, even though it carries the full `+164`-char Fusha rule!
   - **`ar:en` (`n = 45`, executed SECOND):** Mean delta = **`+264.8 ms`** (`SE = 85.7`, `95% CI [+96.9, +432.8]`, `t = 3.09`).
   - **`fr:en` (`n = 27`, executed LAST — ZERO Arabic prompt text!):** Mean delta = **`+227.0 ms`** (`median = +251 ms`, `p75 = +781 ms`, `95% CI [-50.7, +504.7]`, `t = 1.60`), including extreme spikes such as `#51 (+1389 ms)`, `#42 (+1304 ms)`, `#53 (+1239 ms)`, `#40 (+1192 ms)`, and `#60 (+1149 ms)`.
3. **Session Warmup vs Cold Turn 1:**
   - Turn 1 cold starts (`n=12`): `1294.3 -> 1467.2 ms` (`+172.8 ms`).
   - Warm Turns 2–10 (`n=94`): `1204.4 -> 1398.9 ms` (`+194.5 ms`).
   - Session cold-start warmup had no differential effect.
4. **Independent `N=3` Fresh-Session Repeatability Evidence (`phase2b-repeat` vs `phase2c-repeat`, `n = 39` spoken turns each, run ~5.5 min apart):**
   - `phase2b-repeat` (`06:22 UTC`, Phase 2B prompt): `mean = 1365.3 ms` | `median = 1204 ms` | `P95 = 2461 ms` (`SD = 394.4 ms`, `SE = 63.2 ms`)
   - `phase2c-repeat` (`06:27 UTC`, interim Phase 2C Fusha prompt without final ~15-word clause): `mean = 1275.4 ms` | `median = 1142 ms` | `P95 = 1953 ms` (`SD = 355.2 ms`, `SE = 56.9 ms`) — **90 ms faster on mean and 508 ms faster at P95** under identical fresh-session setup! Specifically on `->ar` turns (`#37`, `#103`, `#64`, `#78`, `#41`), 4 of 5 cases were faster or equal (`#37: -331 ms`, `#103: -246 ms`, `#78: -16 ms`, `#64: -3 ms`).

---

## 9. Is the Latency Investigation Conclusive?

**No — it is NOT conclusive as to prompt causality, and we do NOT overstate statistical certainty.**

- **What Is Established:**
  1. In the specific `06:12` vs `06:39` UTC benchmark pair, Phase 2C ran significantly slower (`+192 ms` mean paired delta, `t = 3.27`, largely driven by `13` vs `5` upstream Gemini `>=2000 ms` responses during the `ar:en` and `fr:en` blocks).
  2. Prompt length / Fusha wording alone **cannot explain** why non-Arabic `fr:en` degraded by `+227 ms` (`median +251 ms`) while `ar:fr` shifted only `+68 ms`, nor why `phase2b-repeat` (`1365 ms / P95 2461 ms`) showed the exact same P95 distribution seen in `phase2c` (`1407 ms / P95 2300 ms`).
  3. **Confounder:** Sequential runs separated by ~27 minutes (`06:12` vs `06:39 UTC`) are heavily confounded by **upstream Gemini Live API load, routing, and queuing jitter**, and all turns used `sendClientContent` text inputs rather than live streamed PCM audio.
- **Practical Impact:** Even in the slower `phase2c` run, `mean 1.41s / median 1.26s` stays conversational when paired with local `25 ms` SSE relay (`+192 ms` on P50 `1080 -> 1261 ms` is borderline noticeable, whereas `P95 2300 ms` tails create perceptible pauses if sustained).
- **Zero-Cost Holdout:** Rather than burning additional paid Gemini API calls without prior authorization, a small interleaved A/B test is proposed cleanly in Section 12.

---

## 10. Separate Quality Dimensions & What Requires Actual Human Review

| Dimension | Automated Evidence Available Today? | Verified Phase 2C Status | Requires Human Bilingual Listening? |
| --- | --- | --- | --- |
| **A. Translation Quality** (meaning, completeness, language purity, negation) | **Yes** (text transcripts via 108-case rubric) | `106/108` (`100%` Darija, `100%` English, `100%` negation, `100%` purity) | **Yes** for final nuance, register comfort (`Fusha` vs light Darija in `#37/#56/#47`), and `#55/#81` adjudication |
| **B. Audio Delivery** (stream present, chunks > 0, no duplication/dropouts) | **Yes** (API byte counts + WebAudio 300-turn leak test) | `108/108` audio/silent compliance, `0` leaked listeners, `0.046 ms` schedule avg | Partial (verifies buffer math & non-empty synthesis locally; real network packet loss needs devices) |
| **C. Physical Listening Quality** (pronunciation, accent, prosody, voice naturalness) | **NO** | **Unverified** (waveforms not saved; Aoede prosody not human-audited) | **Yes — 100% required** |

**What Requires Actual Bilingual Human Reviewers:**
1. Completing [PHASE_2C_HUMAN_REVIEW.md](./reviews/PHASE_2C_HUMAN_REVIEW.md) offline on text first (all 24 shortlist items / 25 turns).
2. Live listening evaluation of Gemini `Aoede` (and alternative prebuilt voices `Kore`, `Puck`, `Charon`, `Fenrir`) on the 24 shortlist phrases — specifically checking whether MSA/Fusha phrasing like `هل يمكنك أن تعطيني إيصالا بختم الفندق؟` and `لا نقبل الدفع نقدا...` sounds warm and clear to Maghrebi/Darija speakers vs overly formal.

---

## 11. What Requires Real Devices

Cannot be verified in server/Node test harnesses and remains **pending physical hardware QA**:
1. **iOS Safari + Android Chrome** WebAudio unlock, screen-lock wake/resume, background tab suspension, and Bluetooth HFP/SCO hands-free microphone profile negotiation (`sampleRate` resampling and hardware AEC behavior).
2. **Mode A Dual-Earbud Physical Stereo Isolation:** Verifying L/R panner channel separation over real shared wireless earbuds (Mono Accessibility override checks on iOS/Android) and ensuring translated audio does not bleed back into the shared mic (echo cancellation under loudspeaker/earbud coupling).
3. **Mode B Two-Phone End-to-End Hardware Latency & Smart Ducking:** Real microphone VAD end-to-end TTFA (`Silero VAD 520ms` redemption + upstream Gemini streaming + SSE relay + `45ms` jitter buffer + WebRTC ducking), measured across cellular/Wi-Fi mobile networks.

---

## 12. Proposed Phase 2E Tasks (Documented Only — Not Implemented)

1. **Execute Bilingual Human Review (Text + Audio):** Have native Algerian Darija / French / English reviewers score the 24-case workbook ([PHASE_2C_HUMAN_REVIEW.md](./reviews/PHASE_2C_HUMAN_REVIEW.md)), record adjudication outcomes on `#55` (vocative `sahbi` importance & `discount`/`price`) and `#81` (`شحال؟` ambiguity), and rate Arabic register preference (`Fusha` vs light Darija in informal chats `#37`, `#47`, `#56`).
2. **Budget-Approved Interleaved A/B Latency Diagnostic (~40–60 matched turns):** Estimate API cost upfront and request approval before running an interleaved `A-B-B-A` diagnostic script alternating **Phase 2B vs Phase 2C** prompts within the *same* 5-minute window across 20 balanced `ar:en`, `ar:fr`, and `fr:en` turns (removing time-of-day server drift) + optionally measuring real streamed 16kHz PCM audio vs `sendClientContent` TTFA delta.
3. **Optional Register & Vocative Refinement (Gated on Human Review Findings):**
   - *Only* if bilingual reviewers confirm Arabic Fusha feels stiff on informal French/English turns or want vocatives (`sahbi`, `khoya`) preserved more strictly, test a minor prompt tweak in Phase 2E without sacrificing `#101` (`20/20`) or `#103`/`#78`/`#64`.
   - Do **not** cut quality/fidelity clauses solely to chase latency until the A/B diagnostic proves whether prompt text contributes any real latency.
4. **Physical Mobile Device QA Campaign:** Execute real iOS + Android + Bluetooth dual-earbud and two-phone Mode B verification before any production deployment decision.

---

## 13. Final Readiness Assessment

| Criterion | Readiness Status | Summary |
| --- | :---: | --- |
| **Security & Auth Hardening (Phase 1 / 1.1)** | Ready locally | All security & readiness regression suites green. |
| **Core App & Audio Lifecycle (Phase 1.2 / 2B)** | Ready locally | Mode A, Mode B WebRTC/SSE, and 300-turn audio stress suites green. |
| **Automated Translation Accuracy (Phase 2C)** | **Strong (`106/108`, `98.1%`)** | Highest calibrated score across all runs (`100%` Darija, English, negation, purity, audio delivery). Only `#55` & `#81` failed strict rubric. |
| **Latency Consistency** | **Inconclusive / Monitor** | `phase2c` sequential run was slower (`+192 ms` mean, `P95 2300 ms`), whereas `phase2c-repeat` (`1275 ms`) was faster than `phase2b-repeat` (`1365 ms`); requires interleaved A/B check if budgeted. |
| **Human Bilingual Validation & Real Device Audio** | **NOT COMPLETE** | Offline review package is ready; actual human listening and mobile/Bluetooth device tests have not yet been executed. |
| **Production Deployment Approval** | **HOLD until Phase 2D Human Review & Device QA** | Preserve Phase 2C frozen locally until reviewers complete [PHASE_2C_HUMAN_REVIEW.md](./reviews/PHASE_2C_HUMAN_REVIEW.md) and approve Phase 2E/3 next steps. |
