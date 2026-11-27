# NOVA — Phase 2B Real-World Audio & Device QA Report

**Scope:** Independent audit of Phase 2A results, comprehensive Mode A & Mode B audio/lifecycle QA, local automated audio/session/Mode B stress testing, scoped defect fixes, before/after comparison, real-device testing matrix, and prioritized remaining risk register — **strictly local development only** (zero Railway deployments, zero production DB changes, zero commits/pushes, zero TURN/Redis/paid infrastructure added, Gemini model unchanged as `models/gemini-2.5-flash-native-audio-latest`).

---

## 1. Executive Summary

- **Phase 2A Verification Catch:** Re-scoring Phase 2A baseline (`benchmark-phase2a-baseline.json`) and improved (`benchmark-phase2a-improved.json`) outputs under a single identical calibrated rubric revealed that Phase 2A compared an uncalibrated baseline (`95/108`) against a calibrated improved run (`98/108`), masking a **`-6.5%` combined regression (`105/108 = 97.2% -> 98/108 = 90.7%`)** caused by over-steering `EN/FR -> AR` outputs into phonetic Algerian loanwords (`روسي`, `لي كارط بونكير`, `مديتها`), plus one missed inline audio chunk on Case `#83` (`107/108`). Tightening `buildInterpreterSystemPrompt()` in Phase 2B to restore balanced Arabic clarity while retaining the `#101` negation guard recovered **`101/108 (93.5%)`** combined strict pass, **`20/20 (100%)`** negation fidelity, **`100%`** target language purity, and **`108/108 (100%)`** audio delivery.
- **Audio & Lifecycle Hardening:** Fixed **6 real local software defects** across `vadManager.ts`, `micManager.ts`, `stereoEngine.ts`, `geminiLiveClient.ts`, `ModeAClient.tsx`, and `RoomClient.tsx` (async VAD cancellation race, unmute losing Mode B `voiceCallAec: true`, missing `visibilitychange`/`statechange` `AudioContext` recovery, missing `track.ended` / `devicechange` handling, double-tap start race, and `pollTimer` sync status).
- **Hardware Boundary:** All automated audio/Web Audio tests used controlled mocked browser DOM/`AudioContext`/`MediaDevices` harnesses (`qa-audio-lifecycle.test.mjs`) alongside real Node HTTP/SSE/Gemini servers; **no physical Android, iPhone, Bluetooth TWS earbuds, or cellular CGNAT devices were connected to this workstation**.

---

## 2. Phase 2A Audit Findings (Methodology Verification)

| Audit Question | Honest Verification Finding |
|---|---|
| **1. Identical scoring rules?** | **No.** 10 concept synonym lists in `phase2a-benchmark-108.mjs` were widened between Baseline and Improved runs without re-scoring Baseline JSON. |
| **2. Synonymous calibrations fair?** | After running one identical calibrated rubric (`task-1755`) against both saved Phase 2A JSON files:<br>- **Baseline (identical rubric):** **`105 / 108 (97.2%)`** combined, **`105 / 108`** text, **`108 / 108`** audio, **`19 / 20 (95.0%)`** negation (`#101`, `#55`, `#83` failed).<br>- **Phase 2A Improved (identical rubric):** **`98 / 108 (90.7%)`** combined, **`99 / 108`** text, **`107 / 108`** audio (`#83` omitted inline PCM), **`20 / 20 (100%)`** negation. |
| **3. Empty audio turns counted?** | Yes — `hasAudio = audioChunks > 0 && audioBytes > 0`, correctly flagging `#83` in Phase 2A Improved (`"Totally!"` with `0` audio bytes). |
| **4. Missing audio flagged?** | Text vs audio are now decoupled cleanly (`tOk` vs `aOk` and `hasAudio` flag on `LiveTranscriptTurn`), rather than hiding empty audio inside text accuracy. |
| **5. Translation quality vs audio delivery?** | Evaluated separately: `textOnly`, `audioPresent`, `negation`, `langPurity`, and combined pass. |
| **6. Latency metric scope?** | Phase 2A `TTFA` measured **Gemini WebSocket first audio chunk arrival (`firstAudioAt - sentAt`)**, NOT browser `AudioContext.currentTime` hardware output onset. Also `dspConstantsMs` in `run-phase2a-benchmark.mjs` still printed stale hardcoded `650ms / 60ms` in `benchmark-phase2a-improved.json` (fixed to `520ms / 45ms` cleanly). |
| **7. Measured vs derived latencies?** | Session mint (`n=12`), WS setup (`n=12`), model TTFA (`n=105–106`), Mode B SSE relay (`n=15`), and PCM decode (`n=500`) were measured cleanly; VAD onset/redemption (`320ms/520ms`) and jitter (`45ms`) are DSP constants; physical BT codec/mic times remain unmeasured. |
| **8. Test mocks masking hardware issues?** | Node/mocked tests verify software scheduling, state transitions, HTTP/SSE relay, and lifecycle cleanup deterministically, **but cannot replicate iOS WebKit HFP/A2DP Bluetooth routing, Silero neural inference on noisy human audio, or cellular CGNAT firewalls**. |

---

## 3. Verified Baseline vs Phase 2B Translation Results (Identical Calibrated Rubric)

| Metric | Verified Baseline (`phase2a-baseline`) | Phase 2A Over-Colloquial (`phase2a-improved`) | Phase 2B Balanced (`benchmark-phase2a-phase2b.json`) |
|---|---:|---:|---:|
| **Combined Strict Pass (`Text + Audio`)** | **105 / 108 (97.2%)** | 98 / 108 (90.7%) | **101 / 108 (93.5%)** |
| **Audio Delivery (`audioPresent`)** | **108 / 108 (100%)** | 107 / 108 (99.1%) | **108 / 108 (100%)** |
| **Negative Polarity (`20` negative cases)** | 19 / 20 (95.0%) | **20 / 20 (100%)** | **20 / 20 (100%)** |
| **Target Language Purity (`EN`/`FR`/`AR`)** | **100.0%** | **100.0%** | **100.0%** |
| **Anti-Hallucination Traps (`#107`, `#108`)** | **2 / 2 (0 B / 0 ch)** | **2 / 2 (0 B / 0 ch)** | **2 / 2 (0 B / 0 ch)** |
| **Model TTFA (`mean / p50 / p95`)** | `1170 / 1074 / 1785 ms` (`n=106`) | `1172 / 1039 / 1844 ms` (`n=105`) | **`1215 / 1080 / 1736 ms` (`n=106`)** |

**Phase 2B Group Breakdown (`benchmark-phase2a-phase2b.json`):**
- **Algerian Darija (36):** **35 / 36 (97.2%)**, `99.1%` concept completeness, `100%` purity, `100%` negation, `TTFA avg 1195ms / p50 1046ms`.
- **French (22):** **20 / 22 (90.9%)**, `94.7%` concept completeness, `100%` purity, `100%` negation, `TTFA avg 1280ms / p50 1200ms`.
- **English (22):** **20 / 22 (90.9%)**, `96.2%` concept completeness, `100%` purity, `100%` negation, `TTFA avg 1083ms / p50 978ms`.
- **Difficult Speech (28):** **26 / 28 (92.9%)**, `94.5%` concept completeness, `100%` purity, `100%` negation, `TTFA avg 1297ms / p50 1104ms`.
- *Remaining 7 strict misses in `phase2b`:* `#17` (`"Sure..."`), `#37` (`"مديّة؟"`), `#64` (`"ندبروها"`), `#65` (`"On arrête là..."` omitted `"aujourd'hui"`), `#81` (`"How many?"` on bare `"شحال؟"`), `#103` (`"لي كارط بونكير"`), `#55` (`"give me a discount"` omitted `"sahbi"`). Zero negation flips, zero literalisms, zero empty audio turns.

---

## 4. Mode A & Mode B Audits + Audio Defects Discovered & Fixed

### 4.1 Real Defects Found & Root Causes
1. **[P1] Async VAD Start/Destroy Orphaned Worklet & Mic Leak (`lib/audio/vadManager.ts`):** Calling `stopSession()` while `import("@ricky0123/vad-web")` or `MicVAD.new()` was still awaiting left `this.vad` as `null` inside `destroy()`, causing the newly constructed `MicVAD` (`AudioWorklet`) + `MediaStream` to start and stay running orphaned. Additionally, failed `MicVAD.new()` inside `start()` leaked the internally acquired mic stream.
   - *Fix:* Added monotonic `startEpoch` cancellation checks across `import()`, `acquireMic()`, `MicVAD.new()`, and `vad.start()`, plus `releaseMic()` cleanup inside `start()` `catch`.
2. **[P1] Mode B Unmute Silenced Browser AEC (`components/RoomClient.tsx`, `lib/audio/vadManager.ts`):** `RoomClient.handleToggleMute()` called `vadRef.current.start()` without passing `voiceCallAec: true`, causing `resumeStream` -> `acquireMic()` to revert to `echoCancellation: false` (speakerphone echo returning after unmute!).
   - *Fix:* Persisted `voiceCallAec?: boolean` in `VadStartOptions` and `VadManager.voiceCallAec`, passed cleanly from `RoomClient` on start, unmute, and mic switch.
3. **[P1] No OS AudioContext / Mic Track / Device Hot-Plug Recovery (`lib/audio/stereoEngine.ts`, `lib/audio/micManager.ts`, `ModeAClient.tsx`, `RoomClient.tsx`):** Screen locks, backgrounding, OS phone calls, or Bluetooth headset disconnects could leave `AudioContext` `"suspended"` or `MediaStreamTrack` `"ended"` while the UI falsely stayed `"Live"`.
   - *Fix:* Added `StereoEngine.attachLifecycleRecovery()` (`statechange` + `visibilitychange` auto-resume with clean unsubscribe), `MicManager` `ended` one-shot listener with deterministic `releaseMic()` cleanup, `navigator.mediaDevices` `"devicechange"` refresh listeners, and unexpected mic-loss tear-down + recovery notice.
4. **[P1] Concurrent Start-Button Double-Tap Race & Stale Terminal Mic (`ModeAClient.tsx`, `RoomClient.tsx`):** Rapid taps on Start while `Promise.all([client.connect(), vad.start()])` was still connecting could initiate overlapping WebSockets/Worklets; terminal Gemini `"error"` after 3 reconnect failures also left mic/VAD open.
   - *Fix:* Added `isStartingRef` + `isRunningRef` re-entrancy guards and automatic `stopSession()`/`stopAudioSession()` cleanup on terminal `"error"`.
5. **[P2] Mode B Poll Fallback Status Stuck on `"Syncing"` After Wi-Fi Switch (`RoomClient.tsx`):** When `EventSource` dropped on network change (`roomSyncStatus = "reconnecting"`) and 1s HTTP polling recovered cleanly, `pollTimer` never transitioned `roomSyncStatus` back to `"connected"`.
   - *Fix:* Restored `setRoomSyncStatus("connected")` on `200 OK` fallback poll responses.
6. **[P2] Missing-Audio Turn Observability (`lib/ai/geminiLiveClient.ts`, `ModeAClient.tsx`):** Gemini Live occasionally completes a short turn cleanly with transcription text and `0` audio bytes (`Case #83` in Phase 2A).
   - *Fix:* Added `hasAudio?: boolean` on `LiveTranscriptTurn`, plus a non-intrusive debug notice in `ModeAClient` without compromising L/R channel isolation via unpanned TTS.

---

## 5. Automated QA & Instrumentation Measurements (Observed, With Scope)

| Suite / Metric | Result / Measurements (`count | avg | p50 | p95 | min | max`) | Method & Scope |
|---|---|---|
| `npx tsc --noEmit` | **Passed (`0` errors)** | Full static TypeScript check (post-final app edit). |
| `npm run lint` | **Passed (`0` errors, `0` warnings)** | Strict Next.js 16 + React 19 Compiler ESLint rules. |
| `npm run build` | **Passed (`0` errors, `0` warnings)** | `next build` production bundle (`cacheComponents`, `Proxy`, `Instrumentation`). |
| `scripts/security-regression.test.mjs` | **Passed (`exit 0`)** | Live `next start` server (`:3199`): headers, `nova_client_sid`, `/api/session` + live locked WS handshake, Mode B RBAC/anti-impersonation/end-room. |
| `scripts/phase1_1-readiness.test.mjs` | **Passed (`exit 0`)** | Fail-fast missing/weak `NOVA_AUTH_SECRET`, `NOVA_AUTH_SECRET_PREVIOUS` rotation, multi-instance & restart checks, 5-way concurrent join lock, QR replay, PIN brute-force. |
| `scripts/functional-regression.test.mjs` | **Passed (`exit 0`)** | Assets/SW/VAD WASM `200`, QR fragment parse, Mode B E2E SSE + out-of-order `turnId` audio + WebRTC relay + `DELETE`. |
| **Audio Engine Schedule Delay (`qa-audio-lifecycle.test.mjs`)** | `count=300 | avg 0.058ms | p50 0.044ms | p95 0.145ms | min 0.014ms | max 1.076ms` | **Automated (Mocked `AudioContext`)** across 30 Start/Stop stress cycles (300 chunks). |
| **Long-Session Stress Heap & Listeners (`30` cycles)** | **`heapDelta = +1,602 KB`**, `activeSources = 0`, `leakedVisibilityListeners = 0`, LRU capped <= 36 | **Automated (Mocked `AudioContext` / `MediaDevices`)** verifying `stopAll()`, `dispose()`, `attachLifecycleRecovery()` detach, and LRU bounds. |
| **Session Mint Latency (`qa-audio-lifecycle.test.mjs`)** | `count=5 | avg 322.4ms | p50 255.8ms | p95 579.1ms | min 241.6ms | max 579.1ms` | **Measured real** local server -> Google `authTokens.create`. |
| **Mode B Relay HTTP POST Latency (`qa-audio-lifecycle.test.mjs`)** | `count=10 | avg 11.7ms | p50 11.8ms | p95 21.2ms | min 5.5ms | max 21.2ms` | **Measured real** `127.0.0.1:3209` localhost HTTP relay + SSE/poll seq deduplication. |
| **`scripts/qa-gemini-client.test.mjs`** | **Passed (`exit 0`)** | Mocked server/WS events testing `401` startup failure, disconnected frame safety, `hasAudio:false` tracking, `goAway` partial-turn flush + reconnect, `disconnect()` timer cancellation. |
| **108-Case Benchmark (`--tag phase2b`)** | **`101/108 (93.5%)` combined | `20/20` negation | `108/108` audio | TTFA `1215ms / 1080ms / 1736ms` (`n=106`)** | **Measured real** Gemini Live text/audio turns + 2 acoustic PCM16 traps (`127.0.0.1:3208`). |

*Note on Metrics Not Measurable Here:* Real mic acquisition latency (`getUserMedia` hardware), Silero VAD ONNX neural frame CPU load in Chrome/Safari mobile workers, actual `AudioContext.currentTime` speaker onset, and 15–30 minute mobile cellular/Bluetooth soak CPU/battery drain cannot be measured on headless Node without real phones.

---

## 6. Hardware, OS, Bluetooth & WebRTC Limitations (Honest Constraints)

- **Bluetooth A2DP vs HFP:** Disabling `echoCancellation`/`noiseSuppression`/`autoGainControl` + preferring non-BT built-in mic (`MicManager.score: 90..110` vs BT `-100`) keeps Android Chrome in `A2DP` stereo in documented WebRTC/Chrome behavior; however **iOS Safari / WebKit** often forces global `HFP/SCO` 16kHz mono across AirPods/BT headsets whenever any `getUserMedia` mic stream activates, collapsing L/R stereo separation on some iOS versions.
- **iOS / Android Lifecycle:** Mobile OSes throttle background tabs, suspend `AudioContext` on incoming phone calls/Siri, and cap Safari audio unlock to synchronous gesture stacks (`unlockSync()` mitigates initial start; recovery after OS interruption still requires a screen tap if Safari blocks auto-resume).
- **WebRTC STUN-Only Limitation:** `webrtcCallManager.ts` uses `stun:stun.l.google.com:19302` and `stun1.l.google.com:19302` with **no TURN relay** (per Phase 2B scope). Direct peer-to-peer original-voice calling fails behind symmetric mobile 4G/5G carrier NATs (CGNAT) or strict corporate firewalls; Mode B gracefully continues live AI Dub translation over HTTPS/SSE when WebRTC fails, though the `"Voice Call"` peer audio track will remain silent/connecting without TURN.

---

## 7. Real-Device Manual Testing Matrix (User Execution Required)

| Scenario | Platform / Environment | Mode | Current Verification Status | Manual Acceptance Check |
|---|---|---|---|---|
| **Mode A L/R Earbud Separation & Built-In Mic Lock** | Android + Chrome + TWS BT Earbuds | Mode A | **NOT TESTED** (Mocked Web Audio: **AUTOMATED PASS**) | Earbud Test beeps L (`-1.0`) then R (`+1.0`); `Audio Settings` shows `[Built-in]` mic & `2ch`; speaking A hears translation ONLY in R ear and B ONLY in L ear. |
| **Mode A iOS AirPods / Safari HFP Test** | iPhone + Safari + AirPods | Mode A | **NOT TESTED** | Verify whether L/R isolation holds or if WebKit forces mono SCO fallback; verify `unlockSync` starts audio on first tap. |
| **Mode A Wired Headphones & PTT Noisy Room** | Android/iPhone + Wired Earbuds (Noisy Café) | Mode A | **NOT TESTED** | Confirm PTT streams full sentence while holding button even below VAD threshold; verify `Red` quiet-gap behavior in `Balanced` vs `High`. |
| **Mode A Phone Call / Screen Lock Recovery** | Android Chrome + iOS Safari (`15m+` run) | Mode A | **NOT TESTED** (`visibilitychange` hook: **AUTOMATED PASS**) | Receive brief call or lock phone 10s, unlock & confirm audio resumes or shows clear recovery banner; confirm auto-reconnect at `~10m` token expiry. |
| **Mode B QR Join & Two-Phone Speakerphone Echo** | 2 Phones (Android + iPhone) on Wi-Fi | Mode B | **NOT TESTED** (`voiceCallAec:true` + SSE E2E: **AUTOMATED PASS**) | Scan Host QR (`#invite=` scrubs cleanly); enable Live Call on **speakerphones** (`voiceCallAec: true`) and confirm zero echo/infinite loop, plus Smart Ducking (`0.85 -> 0.15`). |
| **Mode B Mobile Data (4G/5G) & Wi-Fi->4G Handoff** | 2 Phones across Carrier LTE/5G | Mode B | **NOT TESTED** (Local SSE drop -> poll: **AUTOMATED PASS**) | Toggle Wi-Fi off mid-conversation: verify fallback poll recovers `"connected"`, AI Dub keeps delivering without duplicates; note whether WebRTC STUN stays `connecting` under symmetric CGNAT. |

---

## 8. Remaining Issues Ranked by Priority

- **P0 — Critical (Infrastructure / Hardware Blockers):**
  - *Single-process RAM store / rate limiter (`Phase 1.1` scope)* — requires shared Redis or Supabase Postgres approval before multi-instance production scaling.
  - *Physical iOS Safari + Android Chrome Bluetooth A2DP/HFP verification* — untested on real hardware.
- **P1 — Major:**
  - *Symmetric Cellular CGNAT blocking STUN-only WebRTC Voice Call* — requires short-lived TURN server credentials in a future infra phase if P2P original voice over 4G/5G is required.
  - *Browser native `AudioWorklet` + Silero WASM CPU/memory profiling on low-end Android phones* over 15–30 minutes (currently unmeasured outside Chrome desktop/server).
- **P2 — Moderate:**
  - *No offline/asset caching in `public/sw.js`* (`~16–74 MiB` `/vad/*` ONNX/WASM re-fetched if mobile HTTP cache clears).
  - *Rare single-word audio-less turn (`~0–1%`, e.g. `#83` in Phase 2A)* and occasional English preservation of French loanwords (`#24` `"attestation de résidence"` in Phase 2A) / Darija colloquial variance (`#37`, `#64`).
- **P3 — Minor:**
  - *Static `CacheComponents` CSP retains `'unsafe-inline'` for hydration scripts*; *Mode A lacks elapsed `MM:SS` timer*.

---

## 9. Recommendation for Next Step

Before adding any new features or upgrading infrastructure in **Phase 3**, execute the **6 manual physical-device tests in Section 7** using two real smartphones + Bluetooth earbuds against a local/tunnel HTTPS preview (recording which scenarios pass or fail on physical iOS Safari, Android Chrome, and cellular 4G/5G networks), and decide between **Option A (Railway Redis)** vs **Option B (Supabase Postgres)** from `docs/PHASE_1_1_PRODUCTION_READINESS.md` + optional TURN relay based on real carrier WebRTC results.
