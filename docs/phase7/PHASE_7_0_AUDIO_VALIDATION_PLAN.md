# NOVA — Phase 7.0: Real-World Audio Validation Program

**Program Status:** Preparation ONLY (**NO live Gemini/Google API calls or physical tests executed in Phase 7.0**)  
**Target Prerequisite:** Explicit user approval required before starting **Phase 7.1 Execution**  
**Date:** 2026-11-26  
**Audited Codebase Base:** `HEAD fc1bba5` + Phases 1–6.3 local remediations (Phase 2C translation engine/prompt/dataset frozen; `ALL_FROZEN=True`)

---

## 1. Objectives & Scope

### 1.1 Objectives
Validate NOVA under **real spoken audio**, **real mobile/Bluetooth hardware**, and **two-device field conditions** across four dimensions that automated/offline tests cannot prove:
1. **Spoken Translation Quality:** Evaluate live Algerian Darija, Modern Standard Arabic (MSA), French, and English speech comprehension, dialect-to-Fusha output accuracy, code-switching, negation, numbers/prices, and conversational naturalness.
2. **Real-Time Acoustic Latency:** Measure end-to-end human speech-to-first-audible-audio (**TTFA**), speech-to-text (**TTFT**), VAD end-of-utterance delay (`redemptionMs`), and Mode B cross-device turn timing separately from Phase 2C's synthetic text-input benchmark (`mean 1407 ms / p50 1261 ms / p95 2300 ms`).
3. **Mobile Audio & Hardware Reliability:** Verify dual-earbud stereo pan separation (`Left -1.0` / `Right +1.0` in Mode A), Bluetooth A2DP stereo vs. HFP mono protection (`MicManager` built-in mic preference), WebRTC smart voice ducking + AEC (`Mode B`), interruption handling, mic switching, and OS background/screen-lock recovery.
4. **Two-Phone Usability & Sync:** Verify Mode B QR/PIN joining, live partner language sync (`RoomLanguageSyncController`), WebSocket `setupComplete` status honesty, SSE/polling handoff (`Wi-Fi <-> 4G/5G`), and error recovery clarity.

### 1.2 Scope & Exclusions
- **Included:** Mode A (Shared Earbuds), Mode B (QR Two-Phone Rooms), all 13 supported languages (prioritized in Section 2), wired/Bluetooth/built-in audio, quiet and safe noisy environments, stable and switching networks.
- **Excluded (Non-Goals):**
  - Automated batch regression against paid Gemini endpoints (`phase2a` remains frozen).
  - TURN relay deployment, Redis/Postgres infrastructure migration (Railway `replicas=1` sticky mode assumed for private beta testing).
  - Unconsented public crowd recordings or sensitive PII capture.
  - Dangerous driving/traffic/clinical emergency live usage during testing.

---

## 2. Test Environment, Equipment & Practical Algeria Execution Setup

Designed cleanly for **one lead developer/researcher in Algeria** using readily available personal gear:

| Role / Item | Practical Specification |
|---|---|
| **App Host** | Local Next.js server (`npm run start` with local `.env.local` on LAN/HTTPS tunnel cleanly authorized by `NOVA_AUTH_SECRET >= 32` chars; iOS/Android camera/mic require `HTTPS` context or localhost port forwarding). |
| **Primary Phone (Phone 1)** | Android phone (Chrome Mobile) and/or iPhone (iOS Safari) used as Mode A device & Mode B Host. |
| **Secondary Phone (Phone 2)** | Second smartphone (Android/iOS) for Mode B QR/PIN pairing, cross-device audio & cellular (`4G/LTE`) vs `Wi-Fi` testing. |
| **Desktop / Laptop** | Timing observer, screen/console log inspection (filtering secrets/cookies), dual-timer stopwatch or screen/audio timing sheet. |
| **Audio Accessories** | 1× Wired USB-C/Lightning or 3.5mm earbuds (baseline stereo pan check), 1× Bluetooth TWS earbuds (AirPods / Galaxy Buds / standard BT TWS), phone speakers. |
| **Participants** | Ideally: Source Speaker (Algerian Darija / FR / EN) + Target Listener + Independent Evaluator scoring without leading prompts. When a single bilingual evaluator runs solo, tests **must** be tagged `SELF_EVALUATED` (Section 4.3). |

---

## 3. Language Validation Matrix (Exact Supported Registry)

Derived strictly from `SUPPORTED_LANGUAGES` (`13` languages) in [lib/languages.ts](file:///c:/Users/iat/earbud-translator/lib/languages.ts#L8-L22):
`ar` (Arabic), `en` (English), `es` (Spanish), `fr` (French), `de` (German), `it` (Italian), `pt` (Portuguese), `tr` (Turkish), `ja` (Japanese), `ko` (Korean), `zh` (Mandarin Chinese), `hi` (Hindi), `ur` (Urdu).

| Priority | Pair | Why It Matters | Expected Difficulty | Sample Target | Speaker / Listener Req. | Focus Scenarios | Success Criteria |
|---|---|---|---|---:|---|---|---|
| **P1** | **Darija (`ar`) → French (`fr`)** | Core Algerian everyday & service use | **High** (slang, embedded French, fast cadence) | `14` utterances (Pilot `5`) | Native Algerian speaker + FR-fluent listener | Everyday, Taxi, Bargaining, Medical, Code-switch, Negation | Critical meaning `100%`; Mean Accuracy `>= 4.0/5` |
| **P1** | **French (`fr`) → Darija/MSA (`ar`)** | Receiving French speech into clear Arabic | **High** (informal contractions, Fusha clarity) | `8` utterances (Pilot `3`) | Native/fluent FR speaker + DZ listener | Hotels, Directions, Informal FR, Polite requests | No phonetic slang drift; Natural Fusha `>= 4.0/5` |
| **P1** | **Darija (`ar`) → English (`en`)** | Core Algerian travel/business use | **High** (Darija idioms, negation `"ماشي"`, code-switching) | `14` utterances (Pilot `5`) | Native Algerian speaker + EN listener | Travel, Emergencies, Numbers, Idioms, Hesitation, Ambiguity | Critical meaning `100%`; Negation `100%` |
| **P1** | **English (`en`) → Darija/MSA (`ar`)** | Receiving English speech into clear Arabic | **Med–High** (idioms, dates, polysemy) | `8` utterances (Pilot `3`) | Fluent EN speaker + DZ listener | Idioms, Proper nouns, Numbers, Emergency | Fusha register intact; Mean Accuracy `>= 4.0/5` |
| **P2** | **MSA (`ar`) → French (`fr`)** | Formal Arabic speakers | **Low–Med** | `4` utterances | MSA speaker + FR listener | Travel, Medical, Long compound turn | Mean Accuracy `>= 4.3/5` |
| **P2** | **French (`fr`) → MSA (`ar`)** | Formal French reception | **Low–Med** | `4` utterances | FR speaker + Arabic listener | Hotel, Time/Date, Questions | Mean Accuracy `>= 4.3/5` |
| **P2** | **MSA (`ar`) → English (`en`)** | Formal Arabic → English | **Low–Med** | `4` utterances | MSA speaker + EN listener | Requests, Directions, Entities | Mean Accuracy `>= 4.3/5` |
| **P2** | **English (`en`) → MSA (`ar`)** | Formal English → Arabic | **Low–Med** | `4` utterances | EN speaker + Arabic listener | Numbers, Negation, Polite address | Mean Accuracy `>= 4.3/5` |
| **P3** | **French (`fr`) ↔ English (`en`)** | Same-script Mode A direction routing stress test | **Med** (`detectLanguageSide` stopword separation) | `8` (`4` + `4`) | Bilingual FR/EN speaker(s) | Short conversational turns, Mode A L/R earpan check | Correct earbud side routing & clarity |
| **P3** | **Other Supported Spot Checks** (`es`, `de`, `it`, `pt`, `tr`, `ur`, `ja`, `ko`, `zh`, `hi`) | Regression guard for UI/language switching & `ar↔ur` Arabic-script separation | **Low–High** | `1–2` turns per accessible pair | Available bilingual speakers or read phrases | Basic greetings, `ar↔ur` Mode A routing, Mode B live switch | Zero wrong-language locks or crashes |

---

## 4. Human Evaluation Rubric & Bias Controls

Every spoken turn is scored across **6 dimensions** on Sheet B ([PHASE_7_0_TEST_SCORECARDS.md](file:///c:/Users/iat/earbud-translator/docs/phase7/PHASE_7_0_TEST_SCORECARDS.md)):

### 4.1 0–5 Anchor Scales
- **A. Meaning Accuracy (`0–5`):** `5` = Meaning preserved completely; `4` = Minor wording difference, meaning preserved; `3` = Understandable but important nuance lost; `2` = Major meaning partially lost; `1` = Mostly incorrect; `0` = Completely incorrect or unusable.
- **B. Naturalness (`0–5`):** `5` = Native conversational phrasing; `3` = Understandable but stiff/calque; `0` = Unnatural/garbled.
- **C. Completeness (`0–5`):** `5` = All clauses, modifiers, conditions intact; `3` = Minor secondary word omitted; `0` = Core clause missing or cut off.
- **E. Speech Delivery Quality (`0–5`):** Evaluates pronunciation clarity, voice naturalness, pacing, absence of clipped start/end syllables, and non-robotic cadence.
- **F. Conversation Usability (`0–5`):** Can the listener reply naturally without asking `"what?"`?

### 4.2 Binary Gate: **D. Critical Meaning Preservation (`PASS` / `FAIL`)**
Immediate **`FAIL`** if ANY occurs:
- Negation inverted (`"ماشي أنا"` → `"It was me"`).
- Wrong number, price, currency, time, date, flight/room code.
- Distorted direction (`left` vs `right`), medical symptom/allergy, or emergency urgency.
- Unrelated hallucination or wrong target language spoken.

### 4.3 Evaluator Independence Rule
- Target mode: **Source Speaker ≠ Target Listener / Independent Scorer** (speaker reads/speaks without coaching the listener; listener scores comprehension first before seeing source script).
- If executed by a single bilingual developer (`SELF_EVALUATED`), mark `Evaluator` column `[SELF]` and audit strictly against the expected critical-meaning checklist; flag single-rater limitation in final analysis.

---

## 5. Latency Validation Protocol

> **Critical Integrity Notice:** Phase 2C's saved latency (`mean 1407 ms`, `p50 1261 ms`, `p95 2300 ms`) measured **text-prompt (`sendClientContent`) round-trips**, NOT live human voice (`VAD` tail + microphone encoding + network upload + playback jitter buffer). Text metrics MUST NEVER be reported as acoustic latency.

### 5.1 Architectural Contributors Verified in NOVA Code
- `VadManager` (`balanced` preset): `32 ms` frame (`512` samples @ `16 kHz`), `320 ms` `minSpeechMs` (`16` pre-speech buffered frames), **`520 ms` `redemptionMs`** (`low`: `720 ms`, `high`: `420 ms`). Hold-to-talk adds `0 ms` VAD redemption delay on release.
- `StereoEngine`: `45 ms` jitter lookahead cursor (`AudioContext latencyHint: "interactive"`).
- `RoomClient` (Mode B): `120–160 ms` outgoing audio batch window (`queueAudioForPartner`), `1000 ms` fallback poll when SSE drops.

### 5.2 Reproducible Timestamps (`T1`–`T6`)
Measure via synchronized external stopwatch/timestamps or local timestamped log review without storing raw human voice files:
- `T1`: **Speech Start** (speaker begins audible syllable).
- `T2`: **Speech End** (speaker finishes final syllable; speaking duration = `T2 - T1`).
- `T3`: **End-of-Utterance Detection** (`Speaking` pill clears / `PTT` button released -> VAD lag = `T3 - T2`).
- `T4`: **First Translation Text (`TTFT = T4 - T2`)**: First translated text token appears in transcript bubble.
- `T5`: **First Audible Translated Speech (`TTFA = T5 - T2`)**: First syllable heard in earbud/speaker.
- `T6`: **Complete Translated Playback (`Total Latency = T6 - T2`)**: Final syllable finishes playing cleanly.
- Record reconnect disruption delay (`T_reconnect_ready - T_drop`) and inter-turn turnaround (`T1_next - T6_prev`).
- Aggregate: **Median (P50), P90, P95, Min, Max, Sample Size (`n`)**.

### 5.3 Provisional Targets (Separate from Observed Measurements)
- **Provisional Hands-Free Mode A TTFA Target:** `<= 2,200 ms` Median, `<= 3,500 ms` P95 (`Hold-to-talk` expected `~400–500 ms` faster without `520 ms` VAD wait).
- **Provisional Mode B TTFA Target:** `<= 2,500 ms` Median (`Wi-Fi`), `<= 4,000 ms` P95 (`4G/LTE`).

---

## 6. Failure Classification Taxonomy

| Domain | Failure Codes | Mandatory Log Fields |
|---|---|---|
| **Translation (`TRN`)** | `TRN-WRONG-MEANING`, `TRN-MISSING`, `TRN-ADDED`, `TRN-NEGATION`, `TRN-NUMBER`, `TRN-NAME`, `TRN-WRONG-LANG`, `TRN-CODE-SWITCH`, `TRN-DIALECT`, `TRN-AMBIGUOUS` | `Test ID`, `Severity` (`Critical`/`High`/`Medium`/`Low`), `Repro Steps`, `Evidence` (redacted transcript/metrics), `Expected`, `Actual`, `Device`, `Lang Pair`, `Network`, `Safe Session ID` (no cookie/token), `Proposed Fix`, `Retest Status` |
| **Audio (`AUD`)** | `AUD-NO-MIC`, `AUD-NO-OUTPUT`, `AUD-CUTOFF`, `AUD-DUPLICATE`, `AUD-WRONG-ROUTE` (pan L/R), `AUD-ECHO`, `AUD-FEEDBACK`, `AUD-DISTORTED`, `AUD-ROBOTIC`, `AUD-SILENCE-TIMEOUT`, `AUD-LAG` | Same as above |
| **Session (`SES`)** | `SES-CONN-FAIL`, `SES-FALSE-CONNECTED`, `SES-DESYNC`, `SES-LANG-MISMATCH`, `SES-STALE-CALLBACK`, `SES-DUPLICATE`, `SES-RECONNECT-FAIL`, `SES-ROOM-SYNC-FAIL` | Same as above |
| **UX (`UX`)** | `UX-CONFUSING-STATE`, `UX-MISSING-FEEDBACK`, `UX-CONTROL-DIFFICULTY`, `UX-LANG-PICK-FAIL`, `UX-A11Y-FAIL`, `UX-FREEZE`, `UX-UNEXPECTED-END` | Same as above |

---

## 7. Privacy & Test Evidence Policy

1. **No Unconsented Recording:** Never record real bystanders, public conversations, or unconsenting testers.
2. **Synthetic / Non-Sensitive Utterances Only:** All scenarios avoid real home addresses, phone numbers, IDs, bank card details, passwords, and genuine patient medical histories.
3. **Zero Third-Party Audio Uploads:** Never upload recorded speech clips to external transcription, annotation, or cloud storage tools.
4. **Transient Local Evidence & Deletion:** If temporary local timing recordings are used during Phase 7.1, store solely in an unindexed local scratch folder, purge immediately after logging `T1–T6` timestamps, and keep **zero audio files** in the repository.
5. **Secret & Token Hygiene:** Never capture `GEMINI_API_KEY`, `NOVA_AUTH_SECRET`, `nova_client_sid`, `nova_room_auth`, or `#invite=...` URLs in screenshots, terminal logs, or reports.

---

## 8. Proposed Sample Size Plan

| Validation Tier | Utterances / Core Pair | Repetitions | Speakers | Devices | Acoustic Split (Quiet / Safe Noise) | Latency Samples | Interpretation Boundary |
|---|---|---|---|---:|---|---|---|
| **Pilot** | `3–5` (P1 only: ~`16` total) | `1` | `1–2` | `1–2` | `100%` quiet | `>= 15` turns | Sanity smoke test of audio routing & stopwatch pipeline |
| **Initial Product Validation (Phase 7.1 Target)** | `8–14` P1, `4` P2, `4` P3 (`~68` spoken turns + lifecycle/Mode B checks) | `1–2` (`2` on critical negation/code-switch) | `2–3` (at least 1 male + 1 female Darija speaker recommended) | `3+` (Android + iOS + BT TWS + Wired) | `70%` quiet indoor / `30%` safe controlled noise | `>= 50` live turns | Sufficient to expose blocking UX/routing/negation bugs; **NOT** statistically representative of all dialects, microphones, or acoustic populations |
| **Expanded Validation (Post-Fix Beta)** | `25+` per P1 pair (`150+` turns) | `3` on sensitive traps | `5+` diverse regional speakers | `5+` phone/earbud models | `50%` quiet / `50%` real-world indoor & outdoor noise | `>= 120` turns | Stronger percentile confidence (`P90`/`P95`), still non-exhaustive |

---

## 9. Phase 7 Exit Criteria (Beta Gate)

Phase 7.1 passes **ONLY** when ALL independent category gates are met (percentage averages alone do NOT pass if a single critical safety failure repeats):

1. **Translation Quality Gate:**
   - **Critical Meaning Preservation (`D`):** `100%` (`0` recurring negation inversions, `0` critical price/number distortions, `0` emergency/medical distortions on Darija ↔ FR/EN).
   - **Meaning Accuracy (`A`) & Completeness (`C`):** Median `>= 4.0 / 5`, Mean `>= 3.8 / 5` across P1 pairs.
   - **Naturalness (`B`) & Usability (`F`):** Mean `>= 3.8 / 5`; Arabic output stays clean Fusha without jarring French phonetic drift.
2. **Audio Quality & Routing Gate:**
   - Speech cutoffs / truncated beginnings or ends `<= 5%` of valid quiet-room turns; `0` cutoffs on Hold-to-talk.
   - `0` duplicate playback loops; `0` unresolved acoustic feedback squeals.
   - Mode A wired/TWS Bluetooth Left/Right stereo separation verified perceptually clean on target hardware (`>= 95%` turns panned cleanly to intended ear).
3. **Latency Gate:**
   - `>= 30` quiet-room & cellular Mode A/Mode B acoustic `TTFA` timestamps captured separately from Phase 2C text results; provisional `<= 2.2s` Median Mode A target met or explicit prompt/VAD/network bottleneck diagnosed cleanly.
4. **Reliability Gate:**
   - `0` unrecoverable session hangs, stale callback overrides, or false `"connected"` before `setupComplete`.
   - Mode B live partner language switch + `>= 15 min` sustained session + Wi-Fi <-> 4G handoff recover cleanly.
5. **Device Coverage Gate:**
   - Verified on physical **Android Chrome**, physical **iOS Safari**, **Bluetooth TWS earbuds**, **wired headset**, **Mode A**, and **Mode B (2 physical phones)**.
