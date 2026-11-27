# NOVA — Phase 7.1 Spoken Audio Validation Execution Guide

---

> [!IMPORTANT]
> **EXECUTION GATE — EXPLICIT USER APPROVAL REQUIRED**
>
> **Phase 7.1 HAS NOT STARTED.**  
> Running Phase 7.1 opens live **Gemini Live API** audio sessions and incurs paid Gemini API usage.  
> **DO NOT execute any test stage below unless the user explicitly approves starting Phase 7.1 live testing.**

---

## 1. Execution Scope & Strict Guardrails

1. **Frozen Translation Core Remains Locked During Validation:**  
   Do NOT modify `lib/languages.ts`, `lib/ai/geminiLiveClient.ts`, audio VAD/stereo timing constants, or benchmark rubrics mid-validation. Measure the actual frozen build first.
2. **Local / LAN Execution First:**  
   All Phase 7.1 tests run against the local Next.js server exposed over HTTPS (required for mobile browser `getUserMedia()`). Do not test or stress Railway production unless separately approved, and remember the production topology note (`replicas=1`).
3. **Never Leak or Log Secrets:**  
   Never echo, print, screenshot, or paste API keys, `.env` contents, or room auth tokens into logs or scorecards.
4. **Evidence Privacy & Zero Retention of Real Voices:**  
   Follow [PHASE_7_0_AUDIO_VALIDATION_PLAN.md](PHASE_7_0_AUDIO_VALIDATION_PLAN.md) Section 7: never record bystanders without consent, keep temporary test recordings strictly local/untracked, and **permanently delete raw audio files immediately after scoring & latency logging**.
5. **Dual-Workbook Alignment:**  
   While scoring Phase 7.1 spoken turns in [PHASE_7_0_TEST_SCORECARDS.md](PHASE_7_0_TEST_SCORECARDS.md), keep Phase 2C's synthetic text-input review ([PHASE_2C_HUMAN_REVIEW.md](../reviews/PHASE_2C_HUMAN_REVIEW.md) — 24 shortlist / 25 turns including `#55` and `#81`) cleanly separated so text-input metrics (`1261 ms` P50) and live spoken-audio metrics are never conflated.

---

## 2. Pre-Flight Checklist (Complete Before Running Stage A)

- [ ] **User Approval Logged:** Explicit user instruction received to begin Phase 7.1 and spend Gemini Live API quota.
- [ ] **Freeze Integrity Check:** Run SHA-256 verification against `docs/snapshots/phase2c-freeze-manifest.json` -> verify `13/13` frozen files intact.
- [ ] **Clean Local Build & Server Start:** Run `npm run build` and start local Next.js server.
- [ ] **Mobile HTTPS Access Ready:** Expose local port over a trusted local HTTPS origin (e.g., local TLS cert, Caddy/mkcert, or private tunnel without public exposure) so Android Chrome and iOS Safari allow `getUserMedia()`.
- [ ] **Scorecards Printed / Open Offline:** Prepare [PHASE_7_0_TEST_SCORECARDS.md](PHASE_7_0_TEST_SCORECARDS.md) Sheets A–G and [PHASE_7_0_DEVICE_CHECKLIST.md](PHASE_7_0_DEVICE_CHECKLIST.md) Section 2 inventory table.
- [ ] **Timing Method Ready:** Open browser DevTools Diagnostics / `<details>` panel (and optional external phone stopwatch or high-fps screen+audio capture clipped cleanly for `T1–T6` offline verification).
- [ ] **Evaluator Tagging Decided:** Label every translation score as `[SELF]` (developer self-rated) or `[IND]` (independent native speaker — required for Darija / French / English Exit Gate 3).

---

## 3. Sequential Execution Stages (Stages A–G)

### Stage A — Baseline Audio & Smoke Verification (~15–20 min)

**Goal:** Confirm real mic audio reaches Gemini Live, TTS returns cleanly, stereo L/R panning works, and zero catastrophic stalls occur before investing API quota in Stages B–F.

1. Connect **Primary Phone** + **Wired Headset** (`A2DP` Bluetooth follows in Stage C).
2. Run **Earbud Test Modal (`EarbudTestModal`)** -> confirm Left/Right chimes and live mic meter respond cleanly.
3. Complete the matching platform checklist in [PHASE_7_0_DEVICE_CHECKLIST.md](PHASE_7_0_DEVICE_CHECKLIST.md) (Android Chrome / iOS Safari / Desktop).
4. Execute baseline scenarios in Mode A (`ar <-> fr` and `ar <-> en`):
   - **Operational:** `AUD-M01`, `AUD-M05` (permission denial/revoke), `AUD-M06` (acoustic L/R pan), `MA-01`, `MA-02`
   - **Spoken Warmup:** `DAR-01`..`DAR-04`, `FR-01`..`FR-02`, `EN-01`..`EN-02`
5. Record `T1–T6` timestamps in **Sheet C** and inspect `AudioContext` status.
6. **Stop/Go Check:** If mic audio is mute, clipped, sample-rate distorted, or TTFA fails `> 4500 ms` across 3 consecutive quiet turns, **STOP** and log an `F7-01+` Critical/High blocker before running Stage B.

---

### Stage B — Spoken Translation & Linguistic Stress Tests (~45–60 min across 1–2 sessions)

**Goal:** Test natural Algerian Darija, code-switching, numbers, negations, fast speech, idioms, French, and English spoken live through real microphones.

1. Maintain **Quiet Room baseline** (`<= 40 dBA`) on Phone Built-in Mic + Wired Earbuds (avoid mixing noise variables until Stage D).
2. Execute remaining **Darija scenarios** `DAR-05`..`DAR-28` across `ar -> fr` and `ar -> en`. Pay particular attention to:
   - Exact numbers, currency (`dinars`), times (`DAR-10`, `DAR-11`)
   - Negation particles (`ما ... ش` / `ماشي` / `والو` / `بلا`) (`DAR-04`, `DAR-12`, `DAR-13`, `DAR-28`)
   - Code-switching `AR/FR` & `AR/EN` (`DAR-22`, `DAR-23`)
   - Fast speech, hesitation, self-correction, long sentences (`DAR-18`..`DAR-21`, `DAR-26`)
3. Execute remaining **French** (`FR-03`..`FR-16`) and **English** (`EN-03`..`EN-16`) spoken scenarios (bidirectional with `ar` and `fr <-> en`).
4. Execute Mode A conversational flow checks: `MA-03`..`MA-06` and `MA-08`..`MA-09` (language switch, rapid barge-in, manual side override, PTT vs VAD timing, clean end, RTL ear badge check). (`MA-07` & `MA-10` run in Stage F endurance.)
5. **API Quota & Error Guardrail:** If consecutive `429`, `5xx`, or WS disconnects occur `>= 3` times in 2 minutes, abort Stage B immediately, record session health in Sheet F, and wait before resuming.

---

### Stage C — Audio Hardware Matrix (~30–40 min)

**Goal:** Validate Bluetooth `A2DP`, forced `HFP` behavior, speakerphone echo isolation, VAD sensitivity presets, and device hot-plug/disconnect resilience.

1. Run **Stage C Hardware Scenarios:** `AUD-M02`, `AUD-M03`, `AUD-M04`, `AUD-M06` (on BT TWS), `AUD-M07`, `AUD-M11`, `AUD-M12`, `AUD-M13`, `AUD-M14`.
2. **Bluetooth `A2DP` + Built-in Phone Mic (`AUD-M02` + `AUD-M06`):** Confirm Mode A left/right channel separation remains full-bandwidth stereo (`EarbudTestModal` + `DAR-01`, `FR-01`) and check `isBluetoothRisk` warning when BT mic is selected.
3. **VAD Preset Sweep (`AUD-M11` / `AUD-M12`):** Run `DAR-07`, `DAR-19` (hesitation), and `DAR-20` (interruption/overlap) under `Low` (`minSpeechMs 420 / redemptionMs 720`), `Balanced` (`320 / 520`), and `High` (`220 / 420`), plus **Hold-to-Talk (PTT)** (`AUD-M12`).
4. **Hot-Plug & Disconnect (`AUD-M03`, `AUD-M04`, `AUD-M14`):** Unplug wired headset, disconnect Bluetooth mid-session, and switch active mic; verify `onTrackEnded` and UI feedback remain responsive.

---

### Stage D — Real-World Acoustic Environment Tests (~25–30 min)

**Goal:** Measure VAD false-triggers, SNR resilience, and translation accuracy degradation under realistic ambient noise conditions.

1. Execute **Environment Scenarios:** `AUD-M08`, `AUD-M09`, `AUD-M10`.
   - **Controlled Safe Café / Murmur Playback (`AUD-M08`):** Play benign café ambient murmur (`~55–65 dBA`) from secondary speaker 1.5 m away (`10 s` silence + `DAR-12`).
   - **Distant Voice & Wind / Fan Gusts (`AUD-M09`):** Speak softly at `40–50 cm` with light fan breeze (`DAR-06`, `DAR-10`, `FR-06`, `EN-06`); log if safe local outdoor threshold test is also added without recording bystanders.
   - **Multi-Speaker Overlap (`AUD-M10`):** Two speakers near mic (`DAR-20` interruption check) verifying `sc.interrupted` stops stale playback without duplicate streams.
2. Log every spurious VAD trigger ("ghost translation" from ambient noise) and missed speech onset in **Sheet D**.

---

### Stage E — Mode B Two-Device Conversation & Network Stress Tests (~40–50 min)

**Goal:** Validate real two-phone WebRTC + Gemini translation conversations across Wi-Fi and Algerian 4G/LTE networks.

1. Place **Device 1 (Host)** and **Device 2 (Guest)** in separate quiet spots (or use headsets in the same room to eliminate acoustic bleed) so true electronic audio relay & AEC are tested cleanly.
2. Verify Mode B (`voiceCallAec = true`) and WebRTC peer audio state.
3. Execute **Mode B Scenarios:** `MB-01`..`MB-09` across `ar <-> fr` and `ar <-> en` (create room, join QR/PIN, smart ducking vs translation-only, `MB-05` live partner language sync, `MB-06` rapid swaps, `MB-07` interruption relay, `MB-08` `afterAudioSeq` sleep catch-up, `MB-09` host end). (`MB-10` runs in Stage F.)
4. Execute **Network Scenarios:** `NET-01`..`NET-06`:
   - `NET-01`: Stable home Wi-Fi baseline
   - `NET-02`: Algerian 4G/LTE mobile data (Host on Wi-Fi, Guest on 4G, and both on 4G)
   - `NET-03`: Weak indoor Wi-Fi / throttled signal check
   - `NET-04`: `10 s` Airplane Mode drop + recovery
   - `NET-05` / `NET-06`: Live `Wi-Fi -> 4G` (Mode B) and `4G -> Wi-Fi` (Mode A) handoff

---

### Stage F — Extended Endurance Session (`>= 15 min` Continuous, ~20–25 min)

**Goal:** Expose memory leaks, AudioContext drift, Wake Lock failures, thermal throttling, or session timeouts that only appear after prolonged use.

1. Run **Endurance Scenarios (`MA-07`, `MA-10`, `MB-10`)**: Start continuous Mode A and Mode B sessions with **Keep Screen Awake = ON** for **at least 15 consecutive minutes** (~25–40 turns mixed with natural pauses).
2. At minutes `5`, `10`, and `15`:
   - Check Audio Diagnostics `<details>` (`AudioContext` state, latency drift) and `10 min` ephemeral token / `goAway` reconnect (`MA-10`).
   - Perform at least one mid-session **language pair change** (`RoomLanguageSyncController` holds audio readiness until `setupComplete`).
   - Verify DOM `60`-turn window, `"Show earlier messages"`, `"Latest ↓"`, and `36`-turn audio replay LRU in Mode A (`MA-07`) or `200`-turn transcript persistence in Mode B (`MB-10`).
3. End session gracefully; verify saved transcript state (if enabled) and clean mic release (`Mic` indicator disappears from OS status bar).

---

### Stage G — Evaluation, Percentile Calculation, Failure Triage & Exit Gate Review

1. **Compute Spoken Latency Percentiles (Sheet C — Latency Summary Statistics):**
   - Separate Mode A (`VAD` vs `PTT`), Mode B (`Wi-Fi`), and Mode B (`4G/LTE`) samples.
   - Calculate **Median (P50) / P90 / P95 / Min / Max / Sample Size (`n`)** strictly from measured `T1–T6` values. Never blend Phase 2C `sendClientContent` latencies with live spoken latencies.
2. **Independent Native Evaluator Review (`[IND]` vs `[SELF]`):**
   - Have independent native Darija / French / English reviewers score the blind audio/transcript output in **Sheet B** (`0–5` scale + Critical Meaning `PASS/FAIL`), clearly tagged `[IND]`.
   - Separately finish the pending companion Phase 2C text-benchmark human review ([PHASE_2C_HUMAN_REVIEW.md](../reviews/PHASE_2C_HUMAN_REVIEW.md)).
3. **Log & Prioritize Failures (Sheet F):**
   - Assign `F7-01`, `F7-02`, ... with category (`TRN-*`, `AUD-*`, `SES-*`, `UX-*`), device row, scenario ID, and severity (`Critical` / `High` / `Med` / `Low`).
4. **Immediate Data Hygiene:**
   - Delete any temporary local audio recordings once scored and verify no test recordings remain in repo or workspace.
5. **Evaluate Exit Gates (Sheet H):**
   - Score **Exit Gates 1–5** from [PHASE_7_0_AUDIO_VALIDATION_PLAN.md](PHASE_7_0_AUDIO_VALIDATION_PLAN.md) Section 9 individually (`PASS` / `FAIL`) and record final readiness verdict without rounding up unmet criteria.
