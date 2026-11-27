# NOVA — Phase 7.0: Printable / Offline Test Scorecards & Workbook

Fill copies locally during **Phase 7.1 Execution** (after explicit user approval). Never paste API keys, cookies, `#invite=...` tokens, or real PII into these sheets.

---

## A. Master Test Matrix

| Test ID | Priority | Mode | Source Lang | Target Lang | Scenario | Device | Environment | Status | Pass/Fail | Severity | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `DAR-01` | P1 | Mode A | `ar` (Darija) | `fr` | Everyday greeting | | Quiet / Earbuds | Pending | | | |
| `DAR-08` | P1 | Mode A | `ar` (Darija) | `en` | Penicillin allergy | | Quiet | Pending | | | |
| `DAR-12` | P1 | Mode A | `ar` (Darija) | `en` | Negation (`ماشي أنا`) | | Quiet | Pending | | | |
| `MB-05` | P1 | Mode B | `ar` ↔ `fr→en` | `en` | Live partner lang sync | 2 Phones | Wi-Fi | Pending | | | |
| *(Add rows per stage run)* | | | | | | | | | | | |

---

## B. Translation Scoring Sheet (Human Evaluation)

**Scale (`0–5`):** `5` Excellent / Complete | `4` Minor phrasing variance | `3` Understandable, nuance lost | `2` Major loss | `1` Mostly wrong | `0` Unusable  
**Critical Meaning:** `PASS` / `FAIL` (Immediate `FAIL` on inverted negation, wrong numbers/prices/dates/directions, medical/emergency distortion, or wrong language).  
**Evaluator Tag:** Mark `[IND]` if Target Listener ≠ Source Speaker, or `[SELF]` if self-evaluated.

| Test ID | Original Spoken Phrase | Expected Meaning | Actual Output / Transcript | Meaning (0–5) | Natural (0–5) | Complete (0–5) | Critical (PASS/FAIL) | Speech Qual (0–5) | Usability (0–5) | Evaluator (`[IND]`/`[SELF]`) | Notes |
|---|---|---|---|---:|---:|---:| :---: |---:|---:|---|---|
| | | | | | | | | | | | |
| | | | | | | | | | | | |
| | | | | | | | | | | | |

---

## C. Latency Measurement Data Sheet

*(Do NOT mix Phase 2C text-prompt latency with live spoken-audio measurements below.)*

| Test ID | Device | Network | Lang Pair | Mode (`VAD`/`PTT`) | Speak Dur (`T2-T1`) | Speech Start (`T1`) | Speech End (`T2`) | VAD End (`T3`) | First Text (`T4`) | First Audio (`T5`) | Playback End (`T6`) | TTFT (`T4-T2` ms) | TTFA (`T5-T2` ms) | Total (`T6-T2` ms) | Interrupted? | Notes |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:| :---: |---|
| | | | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | | | |

### Latency Summary Statistics (Compute After Run)

| Slice (Mode / Network / Pair) | Sample Size (`n`) | TTFT Median | TTFA Median | TTFA P90 | TTFA P95 | TTFA Min | TTFA Max | Total Completion P50 / P95 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Mode A — Quiet Wi-Fi (`VAD`) | | | | | | | | |
| Mode A — Quiet Wi-Fi (`PTT`) | | | | | | | | |
| Mode B — Two-Phone (`Wi-Fi`) | | | | | | | | |
| Mode B — Two-Phone (`4G/LTE`) | | | | | | | | |

---

## D. Audio Reliability Sheet

| Test ID | Microphone Used | Output Device | Environment | Session Duration | Interruptions Count | Recovery Outcome | Result (`PASS`/`FAIL`) | Notes |
|---|---|---|---|---:|---:|---|---|---|
| | | | | | | | | |
| | | | | | | | | |

---

## E. Device Matrix (Cross-Reference With Full Checklist)

| Device ID | Device Name & Model | OS & Browser Version | Earbuds / Audio Path | Tested Modes (`A`/`B`) | Overall Hardware Result | Known Quirks |
|---|---|---|---|---|---|---|
| `DEV-01` | | | | | | |
| `DEV-02` | | | | | | |
| `DEV-03` | | | | | | |

---

## F. Failure Log

| Issue ID | Test ID | Taxonomy Code | Severity (`Crit`/`High`/`Med`/`Low`) | Repro Steps | Evidence (Redacted) | Expected Behavior | Actual Behavior | Device | Lang Pair | Network | Safe Room/Turn Ref | Proposed Fix | Retest Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `F7-01` | | | | | | | | | | | | | Open |
| | | | | | | | | | | | | | |

---

## G. Daily Test Summary

- **Date:** `____-__-__` | **Tester(s):** `________` | **Session Tag:** `Pilot / Stage __`
- **Total Scenarios Executed:** `__` | **Passed:** `__` | **Failed:** `__` | **Blocked:** `__`
- **Critical Meaning Failures Today:** `__` (`IDs: ______`)
- **Median / P95 Acoustic TTFA Today:** `____ ms / ____ ms` (`n = __`)
- **Key Blockers Discovered:** ___________________________________________
- **Next Day Focus:** ________________________________________________

---

## H. Final Phase 7 Scorecard (Complete at End of Phase 7.1 Only)

Matches the **5 Independent Exit Gates** defined in [PHASE_7_0_AUDIO_VALIDATION_PLAN.md](PHASE_7_0_AUDIO_VALIDATION_PLAN.md) Section 9:

| Exit Gate | Threshold | Measured Phase 7.1 Result | Status (`PASS`/`FAIL`) | Notes |
|---|---|---|---|---|
| **1. Translation Quality Gate** | Critical Meaning `100%` (`0` recurring negation/number/medical/emergency failures); P1 Meaning (`A`) & Completeness (`C`) Median `>= 4.0 / 5`, Mean `>= 3.8 / 5`; Naturalness (`B`) & Usability (`F`) Mean `>= 3.8 / 5` | | | |
| **2. Audio Quality & Routing Gate** | Cutoffs `<= 5%` quiet (`0` PTT); `0` duplicate loops; `0` unresolved feedback squeals; `>= 95%` clean L/R stereo pan | | | |
| **3. Latency Gate** | `n >= 30` quiet & cellular Mode A/B acoustic `TTFA` recorded separately from Phase 2C; provisional Mode A `<= 2.2 s` Median met or bottleneck diagnosed | | | |
| **4. Reliability Gate** | `0` unrecoverable hangs, stale callbacks, or false `"connected"`; clean partner lang sync, `>= 15 min` call, & `Wi-Fi <-> 4G` handoff | | | |
| **5. Device Coverage Gate** | Physical **Android Chrome** + **iOS Safari** + **Bluetooth TWS earbuds** + **wired headset** + **Mode A** + **Mode B (2 physical phones)** | | | |

**Overall Phase 7 Verdict:** `[ ] Ready for Controlled Private Beta` | `[ ] Needs Fixes Before Beta`
