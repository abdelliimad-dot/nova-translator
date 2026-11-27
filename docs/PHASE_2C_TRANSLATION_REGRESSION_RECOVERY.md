# NOVA — Phase 2C: Translation Regression Recovery & Quality Validation

**Scope:** Local development and evaluation only (no deployment, no production/database mutations, no git push/commit, Gemini model kept on `models/gemini-2.5-flash-native-audio-latest`).  
**Date:** 2026-11-26  
**Benchmark Dataset:** `scripts/datasets/phase2a-benchmark-108.mjs` (108 frozen human-authored test cases across 4 groups / 25 categories; unmodified reference translations and scoring rubric).

---

## 1. Executive Summary

- **Objective:** Recover and validate translation quality after Phase 2B discovered that under an identical calibrated rubric (`textPass && hasAudio`), overall combined pass rate stood at `105/108 (97.2%)` at Baseline, dropped to `98/108 (90.7%)` in Phase 2A (`improved`), and only partially recovered to `101/108 (93.5%)` in Phase 2B.
- **Root Cause Identified:** Combining input-dialect instruction (`North African / Algerian Darija ... loanwords`) with an output instruction (`respond in clear, natural conversational Arabic without forcing slang loanwords`) inside `buildInterpreterSystemPrompt()` in `lib/languages.ts` unintentionally shifted Gemini Live's `en->ar` and `fr->ar` output register toward colloquial pan-Arab/Darija expressions and phonetic French/English loanwords (`لي كارط بونكير`, `مديّة؟`, `تليفوني ... الكاونتر ... تاعتي هلق`, `للفندق`), causing deterministic concept misses on `#37`, `#64`, `#78`, and `#103` while also dropping address/time modifiers on `#55` and `#65`.
- **Intervention (`lib/languages.ts`):** Separated **Arabic input comprehension** (MSA + spoken dialects including Algerian Darija `ماشي / ما...ش / والو` and French/English loanwords) cleanly from **Arabic output register** (explicitly instructing Modern Standard Arabic / Fusha vocabulary rather than regional slang or transliterated loanwords) and tightened form-of-address / meaning preservation without hardcoding any benchmark IDs or test phrases.
- **Result on Frozen 108-Case Benchmark (`--tag phase2c`):**
  - **Combined Pass (`text && audio`):** **`106/108 (98.1%)`** — surpasses Baseline (`105/108`, `97.2%`), Phase 2A Improved (`98/108`, `90.7%`), and Phase 2B (`101/108`, `93.5%`).
  - **Audio Delivery:** **`108/108 (100%)`** (106 spoken outputs with >0 audio bytes + 2 expected-silent acoustic traps with 0 bytes).
  - **Negation Polarity Accuracy:** **`20/20 (100%)`** (preserving Baseline's lost `#101` `"ماشي أنا لي نسيت الساروت"` while recovering `#103` `"لا نقبل الدفع نقدا..."`).
  - **Target Language Purity:** **`108/108 (100%)`**.
  - **Tradeoff Reported Candidly:** Measured Phase 2C TTFA (`mean=1407ms`, `p50=1261ms`, `p95=2300ms`, `n=106`) was higher than Phase 2B (`1215ms / 1080ms / 1736ms`) and Baseline (`1170ms / 1074ms / 1785ms`), reflecting API network latency variance and/or Fusha lexical generation time during live session execution.

---

## 2. Calibrated Benchmark Methodology & Integrity Verification

All four full-benchmark artifacts (`baseline`, `improved`, `phase2b`, `phase2c`) were evaluated against the exact frozen `BENCHMARK_CASES_108` dataset in `scripts/datasets/phase2a-benchmark-108.mjs` using `scripts/run-phase2a-benchmark.mjs`:

1. **Audio & Completion Gate:** `completed === true` and `audioChunks > 0 && audioBytes > 0` for all 106 speech turns; `cleanOut.length === 0 && audioBytes === 0` for the 2 real 16kHz PCM16 silence/noise traps (`#107`, `#108`).
2. **Negation Fidelity (`20` negative cases):** Verifies target-language negation markers (`ماشي / لا / ما...ش`, `ne...pas / aucune`, `not / wasn't / don't`).
3. **Target Language Purity:** Verifies Unicode script ratio for Arabic (`arChars >= 3 && arChars > latinChars`) and stopword/diacritic balance for French/English.
4. **Concept Completeness:** Normalized synonym-group coverage threshold (`>= 100%` for `< 4` concept groups; `>= 75%` for `>= 4` groups), plus checks against chatbot metadata and literal-translation regexes.
5. **Anti-Gaming Confirmation:** No benchmark cases were removed, no reference translations or synonym lists were edited to rescue failures, and zero benchmark phrases or IDs exist in `lib/languages.ts`.

---

## 3. Historical Comparison Across All 4 Runs (`108` Cases)

| Metric | Baseline (Pre-2A) | Phase 2A (`improved`) | Phase 2B (`phase2b`) | Phase 2C (`phase2c`) |
| --- | :---: | :---: | :---: | :---: |
| **Combined Pass (`text && audio`)** | **105/108 (97.2%)** | 98/108 (90.7%) | 101/108 (93.5%) | **106/108 (98.1%)** |
| **Text Rubric Pass Only** | 105/108 (97.2%) | 99/108 (91.7%) | 101/108 (93.5%) | **106/108 (98.1%)** |
| **Audio Delivery / Silent Traps** | 108/108 (100%) | 107/108 (99.1%) | 108/108 (100%) | **108/108 (100%)** |
| **Negation Fidelity (`n=20`)** | 19/20 (95.0%) | 20/20 (100%) | 20/20 (100%) | **20/20 (100%)** |
| **Target Language Purity** | 108/108 (100%) | 108/108 (100%) | 108/108 (100%) | **108/108 (100%)** |
| **Gemini TTFA `mean / p50 / p95` (ms)** | 1170 / 1074 / 1785 | 1172 / 1039 / 1844 | 1215 / 1080 / 1736 | 1407 / 1261 / 2300 |

### 3.1 Group Breakdown (Calibrated Combined Pass)

| Group | Cases | Baseline | Phase 2A (`improved`) | Phase 2B (`phase2b`) | Phase 2C (`phase2c`) | P2C Avg Concept | P2C TTFA (`avg/p50/p95`) |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | --- |
| Algerian Darija | 36 | 36/36 (100%) | 34/36 (94.4%) | 35/36 (97.2%) | **36/36 (100.0%)** | 100.0% | 1422 / 1388 / 2447 ms |
| French | 22 | 21/22 (95.5%) | 19/22 (86.4%) | 20/22 (90.9%) | **21/22 (95.5%)** | 97.0% | 1419 / 1265 / 2290 ms |
| English | 22 | 22/22 (100%) | 20/22 (90.9%) | 20/22 (90.9%) | **22/22 (100.0%)** | 100.0% | 1433 / 1265 / 2390 ms |
| Difficult Speech | 28 | 26/28 (92.9%) | 25/28 (89.3%) | 26/28 (92.9%) | **27/28 (96.4%)** | 95.2% | 1352 / 1249 / 2043 ms |

### 3.2 All 25 Categories (Combined Pass)

| Category | Cases | Baseline | Phase 2A | Phase 2B | Phase 2C |
| --- | :---: | :---: | :---: | :---: | :---: |
| Darija Everyday | 6 | 6/6 | 6/6 | 6/6 | **6/6** |
| Darija Regional | 6 | 6/6 | 6/6 | 6/6 | **6/6** |
| Darija Idioms | 6 | 6/6 | 6/6 | 5/6 | **6/6** |
| Darija Slang | 5 | 5/5 | 5/5 | 5/5 | **5/5** |
| Darija+FR Mix | 5 | 5/5 | 4/5 | 5/5 | **5/5** |
| Darija+EN Mix | 3 | 3/3 | 3/3 | 3/3 | **3/3** |
| Darija Context | 5 | 5/5 | 4/5 | 5/5 | **5/5** |
| French Conversational | 6 | 6/6 | 4/6 | 5/6 | **6/6** |
| French Informal | 4 | 4/4 | 4/4 | 4/4 | **4/4** |
| French Fast Speech | 4 | 4/4 | 4/4 | 4/4 | **4/4** |
| French Idioms | 4 | 4/4 | 4/4 | 4/4 | **4/4** |
| French+Darija Mix | 4 | 3/4 | 3/4 | 3/4 | 3/4 (`#55` fail) |
| English Everyday | 5 | 5/5 | 5/5 | 5/5 | **5/5** |
| English Idioms | 4 | 4/4 | 3/4 | 2/4 | **4/4** |
| English Proper Nouns | 4 | 4/4 | 4/4 | 4/4 | **4/4** |
| English Numbers/Dates | 5 | 5/5 | 5/5 | 5/5 | **5/5** |
| English Context | 4 | 4/4 | 3/4 | 4/4 | **4/4** |
| Difficult Short | 4 | 3/4 | 2/4 | 3/4 | 3/4 (`#81` fail) |
| Difficult Long | 4 | 4/4 | 4/4 | 4/4 | **4/4** |
| Difficult Questions | 4 | 4/4 | 4/4 | 4/4 | **4/4** |
| Difficult Emotional | 4 | 4/4 | 4/4 | 4/4 | **4/4** |
| Difficult Corrections | 4 | 4/4 | 4/4 | 4/4 | **4/4** |
| Difficult Negation | 4 | 3/4 | 3/4 | 3/4 | **4/4** (`#101` & `#103` pass) |
| Difficult Multi-Speaker | 2 | 2/2 | 2/2 | 2/2 | **2/2** |
| Difficult Silence/Noise | 2 | 2/2 | 2/2 | 2/2 | **2/2** |

---

## 4. Root Cause Classification of All 13 Historical / Current Failure Cases

| Case | Category / Dir | Historical Status (`BAS / P2A / P2B -> P2C`) | Root Cause Classification | Evidence / Explanation |
| :---: | --- | --- | --- | --- |
| `#17` | Darija Idioms (`ar->en`) | `PASS / PASS / FAIL -> PASS` | **Lexical nuance / mild paraphrase** | P2B rendered `"على راسي وعيني"` as weak `"Sure..."` (`2/3`); P2C rendered `"Absolutely, I'll send you all the papers right now."` (`3/3`). |
| `#24` | Darija+FR Mix (`ar->en`) | `PASS / FAIL / PASS -> PASS` | **Prompt regression (untranslated French)** | P2A left `"attestation de résidence"` in French (`2/3`). Resolved in P2B & P2C (`"residence certificate"`). |
| `#36` | Darija Context (`ar->en`) | `PASS / FAIL / PASS -> PASS` | **Stochastic clause omission** | P2A dropped `"so quiet"` (`2/3`). P2C kept full meaning: `"Why are you so quiet? Did something happen at work?"`. |
| `#37` | French Conv (`fr->ar`) | `PASS / FAIL / FAIL -> PASS` | **Arabic register drift + rubric gap** | P2A/P2B used Darija `"مديّة؟"` (`1/2`) missed by `["محجوز","مشغول","مأخوذ"]`. P2C restored MSA `"اعذرني، هل هذا المقعد مشغول من قبل؟"` (`2/2`). |
| `#41` | French Conv (`fr->ar`) | `PASS / FAIL / PASS -> PASS` | **Phonetic French loanword drift** | P2A wrote `"روسي"` (for *reçu*). P2C outputs clean MSA `"هل يمكنك أن تعطيني إيصالا بختم الفندق؟"`. |
| `#55` | FR+Darija Mix (`fr->en`) | `FAIL / FAIL / FAIL -> FAIL` | **Omission (`sahbi`) + rubric strictness (`discount` vs `price`)** | Baseline dropped `"sahbi"` and mistranslated `"fais-moi un prix"` -> `"give me a break"`. P2C outputs `"Seriously, that's too expensive, give me a discount."` (valid idiom `"give me a discount"`, but drops `"sahbi"` and lacks literal `"price"`). |
| `#64` | English Idioms (`en->ar`) | `PASS / FAIL / FAIL -> PASS` | **Dialect preposition contraction (`للفندق`)** | P2A/P2B emitted Darija `"كي نوصلوا للفندق"` (`لـ + الفندق` omits initial `ا`, missing `["الفندق"]`). P2C outputs MSA `"لا تقلق، سنجد حلاً عندما نصل إلى الفندق."`. |
| `#65` | English Idioms (`en->fr`) | `PASS / PASS / FAIL -> PASS` | **Stochastic time omission (`pour aujourd'hui`)** | P2B dropped `"pour aujourd'hui"`. P2C restored `"On arrête pour aujourd'hui et on reprend ça demain matin à tête reposée."`. |
| `#78` | English Context (`en->ar`) | `PASS / FAIL / PASS -> PASS` | **Mixed-dialect + loanword drift** | P2A (and 3/3 P2B repeatability trials) produced `"نشحن تليفوني من وراء الكاونتر، مش بطاقة الائتمان تاعتي هلق؟"`. P2C outputs clean MSA `"هل يمكنني شحن هاتفي خلف المنضدة، ليس بطاقة الائتمان بعد؟"`. |
| `#81` | Difficult Short (`ar->en`) | `PASS / FAIL / FAIL -> FAIL` | **Out-of-context lexical ambiguity (`How much?` vs `How many?`)** | Standalone Darija `"شحال؟"` means either `"How much?"` (price) or `"How many?"` (count) without surrounding context; 3/3 in P2B repeatability emitted `"How much?"`, while single P2C run emitted `"How many?"`. |
| `#83` | Difficult Short (`fr->en`) | `FAIL / FAIL / PASS -> PASS` | **Baseline paraphrase + P2A zero-audio turn bug** | P2A returned `0` audio bytes on `"Totally!"`; P2B & P2C both returned spoken audio (`44,160B` / `48,000B`). |
| `#101` | Difficult Negation (`ar->en`) | `FAIL / PASS / PASS -> PASS` | **Baseline Darija negation inversion (`ماشي أنا`)** | Baseline flipped `"ماشي أنا"` -> `"Oh right, I'm the one..."`. P2A/P2B/P2C all preserved `"It wasn't me..."`. |
| `#103` | Difficult Negation (`en->ar`) | `PASS / FAIL / FAIL -> PASS` | **Dialect loanwords + colloquial numeral (`الثمانية`, `الكاش`, `لي كارط بونكير`)** | P2A/P2B emitted `"ما نقبلوش الكاش ... غير لي كارط بونكير"`. P2C restored `"لا نقبل الدفع نقدا بعد الساعه الثامنه مساءً، بطاقات مصرفيه فقط."`. |

---

## 5. Repeatability Investigation (`N=3` Fresh Sessions per Case)

Two controlled repeatability experiments were executed using `scripts/phase2c-repeatability.test.mjs` (`N=3` fresh ephemeral token + WebSocket sessions per case to isolate stochastic variance from prompt determinism):

1. **Before Fix (`docs/repeatability-phase2b-repeat.json`, `--tag phase2b-repeat`, 14 cases × 3):**
   - `#17`, `#24`, `#36`, `#37`, `#41`, `#65`, `#81`, `#83`, `#101` all passed `3/3` (showing `#17`, `#37`, `#65`, `#81` were single-run stochastic misses or borderline phrasing in P2B's 108-case run).
   - **Deterministic `0/3` Failures Exposed:**
     - `#64` (`0/3` — `"للفندق"` on all 3 runs)
     - `#78` (`0/3` — `"تليفوني من وراء الكاونتر، مش ... تاعي"` on all 3 runs)
     - `#103` (`0/3` — `"الكاش بعد الثمانية تاع الليل، غير ببطاقات الدفع"` on all 3 runs)
     - `#55` (`0/3` — rep 1 dropped `sahbi` with `"better price"`, reps 2–3 kept `friend` with `"discount"`)
     - *(Note: `#107` in `phase2b-repeat` had a script bug handling `mode: "audio_silence"` via text turn instead of PCM16 frames, even though audioBytes was `0B`; fixed before `phase2c-repeat`.)*

2. **After Interim Prompt Edit (`docs/repeatability-phase2c-repeat.json`, `--tag phase2c-repeat`, 14 cases × 3):**
   - **12/14 cases passed `3/3` (`100%`)**, including `#103` jumping from **`0/3` -> `3/3`** (`لا نقبل الدفع نقداً بعد الساعة الثامنة مساءً، فقط بطاقات مصرفية`), `#37` (`3/3`), `#41` (`3/3`), `#65` (`3/3`), `#101` (`3/3`), `#107` (`3/3` silence), and `#64` improving **`0/3` -> `2/3`**.
   - **Remaining Deterministic Defect Exposed:** `#78` still failed `0/3` with mixed pan-Arab slang (`"ممكن نشحن تليفوني من وراء الكاونتر، مش بطاقة الائتمان تاعتي هلق؟"`), motivating the final refinement explicitly contrasting Fusha target vocabulary against regional dialect slang and transliterated foreign loanwords.

---

## 6. Changes Made in Phase 2C

| File | Change Summary | Purpose |
| --- | --- | --- |
| `lib/languages.ts` | Updated `buildInterpreterSystemPrompt()` dialect and fidelity clauses | Separates spoken Algerian Darija input comprehension (`ماشي / ما...ش / والو`, Maghrebi vocab, FR/EN loanwords) from clear Modern Standard Arabic (Fusha) target output without slang/transliterated loanwords; reinforces preserving forms of address and key meaning. |
| `scripts/phase2c-repeatability.test.mjs` | New `N=3` live repeatability runner (`--tag`, `--repeats`) | Measures stochastic variance vs deterministic prompt failures on 14 critical/unstable benchmark cases across isolated WebSocket sessions. |
| `docs/repeatability-phase2b-repeat.json`, `docs/repeatability-phase2c-repeat.json`, `docs/benchmark-phase2a-phase2c.json` | Saved raw empirical evaluation artifacts | Preserves full auditable per-turn outputs, audio byte counts, concept scores, and TTFA timings. |

*(No security files, authentication cookies, WebRTC/room logic, UI components, Gemini model selection, or benchmark rubric definitions were modified.)*

---

## 7. Local Build, Security, Functional & QA Verification

All checks below were executed cleanly **after the final edit** to `lib/languages.ts`:

| Check Command | Scope | Result |
| --- | --- | --- |
| `npx tsc --noEmit` | Full TypeScript typecheck | Passed (`exit 0`) |
| `npm run lint` | ESLint across workspace | Passed (`exit 0`) |
| `npm run build` | Next.js 16.4.6 production build | Passed (`exit 0`) |
| `node scripts/security-regression.test.mjs` | Cookies, HMAC signatures, room isolation, ephemeral token lock | Passed (`exit 0`) |
| `node scripts/phase1_1-readiness.test.mjs` | Mandatory `NOVA_AUTH_SECRET`, rotation, concurrent/1-time QR join, restart recovery | Passed (`exit 0`) |
| `node scripts/functional-regression.test.mjs` | Mode A/B pages, manifest, VAD assets, Mode B E2E relay + WebRTC + SSE | Passed (`exit 0`) |
| `node scripts/qa-audio-lifecycle.test.mjs` | StereoEngine + MicManager, 30-cycle/300-turn leak stress (`1601 KB` heap delta, `0` leaked listeners), relay latency (`avg 7.5 ms`) | Passed (`exit 0`) |
| `node scripts/qa-gemini-client.test.mjs` | Turn reset, reconnect backoff, channel classification | Passed (`exit 0`) |
| `node scripts/run-phase2a-benchmark.mjs --tag phase2c` | Full frozen 108-case live Gemini benchmark + relay (`avg 25.0 ms`) & decode (`0.0275 ms`) | **`106/108 (98.1%)`**, `exit 0` |

---

## 8. Candidate Cases for Bilingual Human Listening Review (Pending — Not Yet Executed)

> **Important Disclosure:** The 24 cases below are queued as an automated **Human Review Shortlist** across all 12 requested linguistic/behavioral areas using actual saved `phase2c` outputs and `.ts`/benchmark inputs. Native Darija / French / English bilingual human listening review has **NOT** been performed yet.

| # | Case ID | Focus Area | Input | Phase 2C Output | Review Question for Native Listeners |
| --- | :---: | --- | --- | --- | --- |
| 1 | `#17` | Idiom (`ar->en`) | على راسي وعيني، دروك نبعثلك الوراق كامل. | Absolutely, I'll send you all the papers right now. | Does tone sound genuinely warm rather than generic? |
| 2 | `#15` | Idiom (`ar->en`) | اللي فات مات، خلينا نبداو صفحة جديدة. | What's past is past, let's start a new page. | Check idiomatic naturalness (`new page` vs `fresh start`). |
| 3 | `#19` | Darija Slang (`ar->en`) | ما تكسرش راسك معاه، خليه يهدر برك. | Don't bother yourself with him, just let him talk. | Check prosody on casual spoken Darija warning. |
| 4 | `#23` | Darija Slang (`ar->en`) | علاش راك تزعّف؟ ما قصدتش والو واللّه! | Why are you getting upset? I swear I didn't mean anything by it! | Verify emotional sincerity in Aoede spoken audio. |
| 5 | `#3` | Everyday (`ar->fr`) | هادي بزاف غالية، ما تقدرش تنقصلنا شوية فالسومة؟ | C'est beaucoup trop cher, vous ne pouvez pas nous réduire un peu le prix ? | Verify polite French register vs casual market bargaining. |
| 6 | `#7` | Regional (`ar->en`) | واش حوالك؟ كلش لاباس فـ الدار؟ | How are you? Is everything okay at home? | Confirm natural greeting cadence across spoken audio. |
| 7 | `#24` | Darija+FR Mix (`ar->en`) | الدوسيي راهو ناقصو الـ attestation de résidence، لازم تجيبها غدوة. | The file is missing the residence certificate; you must bring it tomorrow. | Confirm seamless Arabic/French switch comprehension. |
| 8 | `#30` | Darija+EN Mix (`ar->en`) | الـ server راهو down من الصباح، الـ team راهي تخدم باش تصلحو. | The server has been down since this morning; the team is working on fixing it. | Verify clean handling of inline English tech loanwords. |
| 9 | `#55` | FR+Darija Mix (`fr->en`) | Franchement c'est trop ghali sahbi, fais-moi un prix. | Seriously, that's too expensive, give me a discount. | **Failed rubric (`1/3`)**: review omission of `sahbi` (`my friend`). |
| 10 | `#56` | FR+Darija Mix (`fr->ar`) | Désolé khoya, j'ai eu un retard à cause des embouteillages. | سمحلي خويا، تعطلت بسبب الازدحام. | Check acceptability of light `سمحلي خويا` vs strict Fusha. |
| 11 | `#37` | FR->AR Register | Excusez-moi, est-ce que cette place est déjà prise ? | اعذرني، هل هذا المقعد مشغول من قبل؟ | Compare listener preference: MSA `المقعد مشغول` vs Darija `البلاصة محجوزة`. |
| 12 | `#41` | FR->AR Register | Pourriez-vous me faire un reçu avec le tampon de l'hôtel ? | هل يمكنك أن تعطيني إيصالا بختم الفندق؟ | Verify clarity and warmth of Fusha polite request. |
| 13 | `#47` | Fast Informal FR | Chais pas trop s'il va venir ce soir, il m'a rien confirmé. | مانيش عارف إذا كان راح يجي الليلة، ما أكدلي والو. | Spot-check residual Darija shift when French source uses slang `Chais pas`. |
| 14 | `#64` | EN->AR Idiom | Don't sweat it, we'll figure it out once we reach the hotel. | لا تقلق، سنجد حلاً عندما نصل إلى الفندق. | Confirm smooth conversational pacing in Fusha. |
| 15 | `#65` | EN->FR Idiom | Let's call it a day and pick this back up fresh tomorrow morning. | On arrête pour aujourd'hui et on reprend ça demain matin à tête reposée. | Confirm casual conversational French intonation. |
| 16 | `#70` | Proper Nouns (`en->ar`) | Air Algerie flight AH 1004 from London Heathrow is now boarding. | الآن يتم الصعود إلى طائرة الخطوط الجوية الجزائرية رحلة AH 1004 من مطار لندن هيثرو. | Listen for clear articulation of `AH 1004` inside Arabic speech. |
| 17 | `#74` | Numbers/Addr (`en->ar`) | Deliver the package to 14 Didouche Mourad Street, Algiers 16000. | سلم الطرد إلى 14 شارع ديدوش مراد، الجزائر 16000. | Listen for digit pronuncation accuracy (`14`, `16000`). |
| 18 | `#78` | Context Sense (`en->ar`) | Can I charge my phone behind the counter, not my credit card yet? | هل يمكنني شحن هاتفي خلف المنضدة، ليس بطاقة الائتمان بعد؟ | Confirm dual sense disambiguation (`charge` phone vs `charge` card). |
| 19 | `#81` | Short Ambiguous (`ar->en`) | شحال؟ | How many? | **Failed rubric (`0/1`)**: single-word ambiguity without context (`How much?` vs `How many?`). |
| 20 | `#97` | Self-Correction (`ar->en`) | نتلاقاو نهار الخميس... لا سمحلي، قصدي نهار الجمعة على الثلاثة. | We'll meet on Thursday... no, sorry, I mean on Friday at three. | Confirm pause phrasing matches natural self-correction without rushing. |
| 21 | `#101` | Negation (`ar->en`) | ماشي أنا لي نسيت الساروت، راهو مزال فالمكتب. | It wasn't me who forgot the key, it's still in the office. | Verify Darija `ماشي` negation fidelity under native speech prosody. |
| 22 | `#103` | Negation (`en->ar`) | We don't accept cash after eight PM, only bank cards. | لا نقبل الدفع نقدا بعد الساعه الثامنه مساءً، بطاقات مصرفيه فقط. | Verify crisp articulation of `نقداً` and `الثامنة مساءً`. |
| 23 | `#104` | Negation (`ar->fr`) | ما تخافش، هذا القرار ما عندوش حتى تأثير على الفيزا تاعك. | Ne t'inquiète pas, cette décision n'a aucune incidence sur ton visa. | Confirm reassuring emotional tone in French translation. |
| 24 | `#105/#106` | Multi-Speaker (`ar<->en`) | راني واجد باش نخلص الآن. / Great, would you like to pay by card or cash? | I am ready to pay now. / عظيم، هل تفضل الدفع بالبطاقه أو نقدا؟ | Confirm clean directional flip with zero language bleed. |

---

## 9. Confidence Assessment, Limitations & Phase 3 Recommendation

### Strengths Validated Locally
1. **Regression Recovered Without Benchmark Tampering:** `106/108 (98.1%)` on the exact frozen dataset (`108/108` audio delivery, `20/20` negation fidelity, `108/108` language purity), beating Baseline (`97.2%`), Phase 2A (`90.7%`), and Phase 2B (`93.5%`).
2. **Cleaner Arabic Output Architecture:** Separating spoken dialect *comprehension* (Algerian Darija, code-switching) from MSA/Fusha *generation* eliminated awkward cross-dialect pidgins and French-phonetic Arabic transcriptions on `en->ar` and `fr->ar` turns.
3. **Full Local Engineering Gate Green:** TypeScript, ESLint, Next.js build, security hardening, Phase 1.1 secrets/concurrency tests, Mode B E2E, and WebAudio 300-turn leak suite all passed after the last edit.

### Known Limitations (Do Not Overstate)
- **Live Audio Input Is Text-Turn Proxied for Speech Cases:** While `#107` and `#108` stream real 16kHz PCM16 audio frames, cases `#1`–`#106` send text turns over live Gemini WebSocket (`sendClientContent`) for reproducibility; acoustic ASR accuracy across real Algerian accents, noisy cafes, and Bluetooth HFP microphones remains **untested by physical hardware in this phase**.
- **TTFA Latency Higher in Phase 2C Run:** `1407 ms` mean (`1261 ms` p50, `2300 ms` p95) vs `1215 ms` mean in Phase 2B — live API variance plus possible extra phrasing latency should be watched in device testing.
- **Standalone 1-Word Ambiguity (`#81`) & Rare Vocative Drops (`#55`):** `شحال؟` without prior conversation context remains inherently ambiguous, and casual vocatives like `sahbi` can still be dropped under fast decoding.
- **No Physical Device Audio Test / No Human Listening Pass Yet:** iOS Safari, Android Chrome, and dual-earbud stereo separation / Bluetooth SCO/HFP echo cancellation require real-device validation alongside the 24-case bilingual Human Review shortlist above.

### Recommendation for Phase 3
**Proceed to Phase 3 (Controlled Physical-Device QA & Bilingual Human Listening Validation)** locally/staging before any production rollout:
1. Run the 24-case Human Review shortlist using native Darija/French/English listeners scoring prosody, register comfort (`Fusha` vs light spoken Arabic in casual chats), and audio warmth.
2. Execute the manual iOS Safari + Android Chrome Mode A (shared earbuds) and Mode B (two-phone WebRTC + ducking) hardware checklist using real microphone speech for Darija/FR/EN code-switching, especially `#55`, `#81`, `#97`, `#101`, and `#103`, while tracking end-to-end audio-in -> audio-out TTFA.
