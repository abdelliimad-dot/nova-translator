# NOVA — Phase 6: Independent Final Product Audit

**Audit Mode:** Strict Read-Only Independent Verification (no source code, test, prompt, benchmark, dependency, or database edits performed; zero live/paid Gemini API calls executed; zero deployments or git commits).  
**Audit Date:** 2026-11-26  
**Repository Base (`HEAD`):** `fc1bba5dbc94c6986e4d514646f7a958f0bec0dc` (`feat: NOVA v1 production ready` + uncommitted Phases 1–5 local working tree)  
**Target Stack:** Next.js `16.4.6` · React `19.3.0` · TypeScript · Tailwind CSS `4.3.3` · `@google/genai ^3.6.1` · `@ricky0123/vad-web ^0.0.31` · `onnxruntime-web ^1.31.1` · `jsqr ^1.4.0`

---

## 1. Executive Summary

Independent inspection and empirical testing of NOVA after Phases 1–5 confirm that the application compiles cleanly (`npx tsc --noEmit`, `npm run lint`, `.next/BUILD_ID` present, `npm audit --omit=dev` = `0` vulnerabilities), preserves all **13 frozen Phase 2C artifacts** byte-for-byte via SHA-256 verification, and implements strong foundational room RBAC, HMAC cookie signing, fail-closed `NOVA_AUTH_SECRET` production startup validation, client Web Audio stereo panning architecture, and bounded transcript persistence (`200` turns with `80`/`40` quota fallback).

However, **independent testing uncovered several real defects and critical evidence gaps missed by earlier self-reports**:

1. **High Security Gap (`lib/security/authCrypto.ts:376-395`):** `getClientIp()` trusts client-spoofable `CF-Connecting-IP` and `X-Real-IP` headers unconditionally ahead of `X-Forwarded-For`. An empirical read-only probe against `next start` bypassed `createRoomLimiterByIp` (`30`/5 min) cleanly (`36/36` room creations returned `201 Created`, `0` returned `429`), exposing both Mode B room memory exhaustion (`MAX_ROOMS = 2000`) and `/api/session` Gemini token minting on non-Cloudflare hosting (e.g., Railway).
2. **High Mode B Functional Bug (`components/RoomClient.tsx:597-598`):** When a partner updates their language via `PATCH /api/rooms/[roomId]`, the receiving participant's SSE `lang_update` handler updates UI state (`setRoom(parsed.room)`) but **never restarts an active `GeminiLiveTranslatorClient` session**, leaving live audio translation locked on the old language pair until manually stopped and restarted.
3. **High Translation & Audio Validation Gap (`scripts/run-phase2a-benchmark.mjs:483-486`, `docs/reviews/PHASE_2C_HUMAN_REVIEW.md`):** Phase 2C's `106/108 (98.1%)` score injected **text prompts** (`session.sendClientContent`) for all `106` translated items rather than recorded Darija/French/English speech audio (`sendRealtimeInput`), did not persist synthesized audio waveforms for human listening evaluation, leaves all `25` human-review turns **PENDING**, and has **0% physical iOS / Android / Bluetooth A2DP vs HFP field execution**.
4. **Medium Accessibility & `320px` Mobile Polish Defects (`app/layout.tsx:47`, `SplitTranscript.tsx`, `RoomClient.tsx`, `HomeClient.tsx`, `ModeBCreateClient.tsx`):** `<meta name="viewport">` enforces `maximum-scale=1` (blocks user pinch-to-zoom), multiple segmented controls measure `40px` height (`<44px`), Home's `"13 languages"` trigger measures `16.5px` tall, and `320x800` truncates `"Live Voice Translat..."`, `"Fre..."`, `"Start C..."`, and Arabic `"إنشاء أو د..."`.

**Final Audit Verdict:** **C. NEEDS TARGETED PRE-LAUNCH FIXES BEFORE BETA** (see [Section 16](#16-final-verdict)).

---

## 2. Audit Scope & Evidence Rules

Every claim in this report adheres to strict verification boundaries:

- **Read-Only Execution:** Zero files under `app/`, `components/`, `lib/`, `scripts/`, `public/`, or existing `docs/` were edited. Only [docs/PHASE_6_INDEPENDENT_FINAL_AUDIT.md](file:///c:/Users/iat/earbud-translator/docs/PHASE_6_INDEPENDENT_FINAL_AUDIT.md) was created, plus a temporary Node security probe placed outside the repo in scratch storage.
- **No Paid Gemini Calls:** Tests calling live Gemini translation or opening live Google WebSockets (`run-phase2a-benchmark.mjs`, `phase2c-repeatability.test.mjs`, `security-regression.test.mjs` live WS step) and tests mutating tracked JSON files (`qa-audio-lifecycle.test.mjs` which overwrites `docs/qa-audio-lifecycle-metrics.json`) were **inspected in code rather than executed**.
- **Tested vs. Static vs. Untested Separation:** Runtime behavioral assertions, static AST/substring checks, headless Chromium DOM measurements (`http://127.0.0.1:3222`), and unexecuted hardware/human items are tagged explicitly throughout.

---

## 3. Baseline Verification & Git / Hash Integrity

Verified cleanly from `git status --short`, `git log -n 5 --oneline`, `.next/BUILD_ID`, and PowerShell `Get-FileHash` + `phase3_0-ux-regression.test.mjs`:

- **Git State:** `HEAD` at `fc1bba5` (`feat: NOVA v1 production ready`). Local working tree holds `30` modified tracked files (`M`) plus untracked Phases 1–5 additions (`app/api/rooms/[roomId]/join/`, `components/nova/HtmlLocaleSync.tsx`, `docs/`, `instrumentation.ts`, `lib/security/`, `proxy.ts`, `scripts/`).
- **Build Integrity:** `.next/` exists cleanly from the latest local production build (`.next/static/chunks/`: `20` files totaling `1,919,579` bytes / `1.83 MiB`).
- **Frozen Phase 2C SHA-256 Digest Verification (`13/13` Exact Matches Verified During Audit):**

| Artifact | Expected Digest (`phase2c-freeze-manifest.json`) | Audit Check |
|---|---|---|
| `lib/languages.ts` | `744cacad...e2b4095` | **MATCH** (`8,333 B`) |
| `app/api/session/route.ts` | `84357714...424760e` | **MATCH** (`6,262 B`) |
| `lib/ai/geminiLiveClient.ts` | `eb812f89...7d09c` | **MATCH** (`19,067 B`) |
| `scripts/datasets/phase2a-benchmark-108.mjs` | `b2f278c2...7d9371` | **MATCH** (`58,286 B`) |
| `scripts/run-phase2a-benchmark.mjs` | `61d19f34...9970d` | **MATCH** (`22,570 B`) |
| `docs/benchmark-phase2a-phase2c.json` | `4a5e3fc7...e511e5` | **MATCH** (`106,549 B`) |
| Remaining `7` frozen manifests/reports/repeats | Per manifest | **ALL MATCH (`13/13`)** |

---

## 4. Verification of Prior Phase Reports (2C, 2D, 3.0, 3.1–5)

| Prior Report Claim | Independent Audit Verification |
|---|---|
| TypeScript (`tsc --noEmit`), ESLint (`npm run lint`), `npm audit --omit=dev` clean | **CONFIRMED** (`exit 0`, `0` lint warnings/errors, `0` prod vulnerabilities). |
| Phase 2C prompt & model frozen (`models/gemini-2.5-flash-native-audio-latest`) | **CONFIRMED** via `13/13` SHA-256 matches and `app/api/session/route.ts` inspection. |
| Phase 2C achieved `106/108 (98.1%)` with TTFA `mean=1407ms`, `p50=1261ms`, `p95=2300ms` | **CONFIRMED IN SAVED ARTIFACTS, WITH CRITICAL CAVEAT:** Inspection of `run-phase2a-benchmark.mjs:483-486` shows `#1`–`#106` used **text input (`sendClientContent`)**, NOT spoken audio waveforms (`sendRealtimeInput`), so speech-to-speech ASR & real acoustic latency remain unmeasured. |
| Phase 2D Human Review workbook created (`PHASE_2C_HUMAN_REVIEW.md`, CSV/JSON) | **CONFIRMED** (`24` items / `25` turns present), **status still PENDING human execution**. |
| Phase 3.0 zero consumer jargon & `0px` overflow across `320`–`1280px` | **PARTIALLY CONFIRMED:** Zero horizontal overflow confirmed across `320`–`1280px` LTR & RTL; **however**, live Chromium `320x800` screenshots caught ellipsis text truncation (`"Start C..."`, `"Fre..."`, `"Live Voice Translat..."`, `"إنشاء أو د..."`) and `<44px` mobile touch targets missed by `phase3_0-ux-regression.test.mjs`. |
| Phase 3.1–5 long-session store (`200` turns, `80`/`40` quota fallback) & Mode A live language switch | **CONFIRMED** via `phase3_1-long-session.test.mjs` and live Chromium `AR↔EN` -> `AR↔FR` switch; **however**, uncovered Mode B partner `lang_update` failing to restart active sessions. |

---

## 5. Translation Engine & Prompt Integrity Audit

- **Model & Live Config ([app/api/session/route.ts](file:///c:/Users/iat/earbud-translator/app/api/session/route.ts#L17-L201)):** Locked server-side via `ai.authTokens.create({ config: { uses: 1, expireTime: +10m, newSessionExpireTime: +60s, lockAdditionalFields: ["tools", "safetySettings", "realtimeInputConfig", "generationConfig", "proactivity"], liveConnectConstraints: { model: "models/gemini-2.5-flash-native-audio-latest", responseModalities: [Modality.AUDIO], temperature: 0.35, thinkingConfig: { thinkingBudget: 0 }, contextWindowCompression: { triggerTokens: "12000", slidingWindow: { targetTokens: "4000" } } } } })`.
- **Anti-Hijack Integrity:** `langA`, `langB`, and `voiceName` are strictly allow-listed (`13` languages, `5` voices: `Aoede`, `Kore`, `Puck`, `Charon`, `Fenrir`). Arbitrary prompt text injection from clients is blocked (`400`).
- **Prompt Behavior & Calibration Integrity (`lib/languages.ts`):** `buildInterpreterSystemPrompt` clearly separates Arabic comprehension (MSA + Maghrebi/Algerian Darija + FR/EN loanwords) from Arabic output register (Fusha without slang/phonetic loanwords) and explicitly prohibits translating noise/silence (`#107`, `#108` passed `0` audio bytes in saved Phase 2C artifact).
- **Benchmark Methodology Limitation (`scripts/run-phase2a-benchmark.mjs:431-486`):** Only `#107` and `#108` injected `16kHz` PCM16 audio frames. All `106` translation cases injected `turns: [{ role: "user", parts: [{ text: tc.input }] }]`. Therefore, acoustic noise robustness, regional spoken accents, VadManager onset clipping, and real microphone TTFA (`TTFA_text + VAD redemptionMs (~520ms) + Mode B relay batching (~120–160ms) + 45ms jitter = ~1.9–2.1s+ estimated P50 real acoustic TTFA`) are **unverified** experimentally.

---

## 6. Audio Architecture & Real-Time Pipeline Audit

Inspected across [stereoEngine.ts](file:///c:/Users/iat/earbud-translator/lib/audio/stereoEngine.ts), [vadManager.ts](file:///c:/Users/iat/earbud-translator/lib/audio/vadManager.ts), [micManager.ts](file:///c:/Users/iat/earbud-translator/lib/audio/micManager.ts), [replayHelper.ts](file:///c:/Users/iat/earbud-translator/lib/audio/replayHelper.ts), and [webrtcCallManager.ts](file:///c:/Users/iat/earbud-translator/lib/audio/webrtcCallManager.ts):

- **Strengths Verified:**
  - `StereoEngine.unlockSync()` creates `AudioContext({ latencyHint: "interactive" })` synchronously inside the user tap gesture (`channelCount = 2`, `channelCountMode = "explicit"`, 1-sample silent buffer iOS/Chrome unlock), creates isolated `StereoPannerNode` routes (`-1.0` left, `+1.0` right, `0.0` both), and restores suspended contexts on foreground `visibilitychange`.
  - `VadManager` enforces epoch cancellation (`++this.startEpoch`), retains `16` pre-speech frames (`512` samples/frame @ `16kHz`), throttles ONNX logs to `"error"`, and passes `voiceCallAec: false` in Mode A (avoiding Bluetooth SCO/mono degradation when built-in mic is selectable) vs `voiceCallAec: true` in Mode B.
  - `WebRtcCallManager` avoids SDP glare cleanly (Host caller / Guest callee), queues remote ICE candidates safely (`cap = 50`), triggers `iceRestart` after `2200ms`, and cleans listeners on hangup.
- **Issues & Drift Identified:**
  1. **JSDoc vs Preset Constant Drift ([lib/audio/vadManager.ts](file:///c:/Users/iat/earbud-translator/lib/audio/vadManager.ts#L50-L140)):** Class JSDoc states `650ms redemptionMs`, whereas the active preset defaults `balanced` to `redemptionMs: 520` (`low: 720`, `high: 420`).
  2. **Replay Channel Panning Loss Under Web Speech Fallback ([lib/audio/replayHelper.ts](file:///c:/Users/iat/earbud-translator/lib/audio/replayHelper.ts#L87-L105)):** Cached PCM turns (`MAX_CACHED_TURNS = 36` LRU) pan strictly to `opts.channel`. Older evicted turns or page-reloaded transcripts fall back to `window.speechSynthesis`, which ignores `opts.channel` and outputs to both ears even when the user taps `"Left ear"` or `"Right ear"` replay.
  3. **Public STUN-Only NAT Traversal ([lib/audio/webrtcCallManager.ts](file:///c:/Users/iat/earbud-translator/lib/audio/webrtcCallManager.ts#L18-L24)):** Configured solely with `stun.l.google.com:19302` and `stun1.l.google.com:19302` (no TURN relay). Live WebRTC voice will fail across symmetric cellular CGNAT/enterprise firewalls (though AI translated SSE/polling relay continues working).
  4. **Untracked Mic Switch Error State (`components/RoomClient.tsx:1152-1155`):** `handleSelectMic`'s `onTrackEnded` calls `stopAudioSession()` without `true`, clearing the error status to `"disconnected"` (inconsistent with `startAudioSession:910` which passes `stopAudioSession(true)`).
  5. **VAD Asset Footprint (`public/vad/`):** `postinstall` copies `9` files totaling **`77.3 MB`** (`77,264,539 B`) into `public/vad/`, including unused `silero_vad_legacy.onnx` (`1.8 MB`), `.jsep.wasm` (`29.5 MB`), and `.asyncify.wasm` (`28.7 MB`). On desktop audit loads, **0 VAD bytes downloaded eagerly** (loaded lazily on Start), so page TTI is unaffected, but Docker/deployment image size inflates unnecessarily.

---

## 7. Mode A (Shared Earbuds) Functional Audit

- **Verified Capabilities:**
  - `HomeClient` language pair syncs seamlessly via `?langA=...&langB=...` and `preferredLangA`/`preferredLangB` storage; live in-session language switcher (`AR ↔ EN` -> `AR ↔ FR` verified in Chromium) cleanly stops active sessions and updates route state.
  - Rotated top pane (`rotate-180` for Partner B) + upright bottom pane map correctly to physical Left/Right panning (`swapChannels` mirrors ear pills while preserving logical RTL/LTR chrome).
  - Mid-utterance mute (`handleToggleMute`) and capture switch (`Hands-free` <-> `Hold to talk`) flush pending speech with `clientRef.current?.sendAudioStreamEnd()`.
  - `RecoveryBanner` maps mic permission/device errors and offline state cleanly (`useIsOnline` + `useWakeLock`).
- **Untested Runtime Paths:** Actual dual-earbud stereo acoustic isolation, `onAudioOutput` -> `GeminiLiveTranslatorClient` real audio stream decoding under continuous mobile Safari/Android Chrome backgrounding.

---

## 8. Mode B (QR Two-Phone Conversation) Functional Audit

- **Verified Capabilities:**
  - Host room creation (`POST /api/rooms`) generates `14`-char readable `roomId`, `6`-char PIN (`passcode`), and single-use `inviteToken`, storing credentials in `HttpOnly`, `SameSite=Lax` cookie `nova_room_auth`.
  - Host `/room/[roomId]` URL verified in Chromium has **no `#invite=` fragment leak** (`hasInviteHash: false`); QR link embeds `#invite=...` which `RoomClient` scrubs via `history.replaceState` before room fetches.
  - Unauthenticated room navigation displays the Guest PIN Auth Gate cleanly; `POST /api/rooms/[roomId]/join` enforces single active guest seat (`409`), consumes QR invite token once (`403` replay), and enforces per-room PIN lockout (`429` at 16th failed attempt).
  - SSE stream (`/api/rooms/[roomId]/events`) delivers `init`, `presence`, `lang_update`, `transcript`, `audio` (with `turnId`), `interrupted`, `webrtc_signal`, and `room_ended`, backed by `1000ms` incremental cursor polling (`afterAudioSeq`, `afterSignalSeq`) verified by `functional-regression.test.mjs`.
- **Defects Identified:**
  1. **High — Partner Language Update Desync (`components/RoomClient.tsx:597-598` vs `:1120-1139`):** Local `handleLanguageChange` restarts `startAudioSession`, whereas SSE `lang_update` (and polling snapshot sync) when the **partner** switches languages only calls `setRoom(parsed.room)`. The local `GeminiLiveTranslatorClient` keeps using the stale ephemeral token & system prompt until manually restarted.
  2. **High Operational Boundary — Single-Process Store (`lib/rooms/roomStore.ts`):** Rooms, active SSE streams, and failed-join states live in `globalThis.__novaRoomsStore` (`MAX_ROOMS = 2000`, `2h` TTL). Multi-instance deployments or container restarts immediately invalidate every active room (`404`).

---

## 9. Long-Session & Resource Management Audit

- **Verified Strengths:**
  - `lib/transcriptStore.ts` stores up to **`200` turns** per pair/room with deterministic timestamp sorting and progressive `QuotaExceededError` trimming (`80` -> `40` turns), verified across `150` turns in `phase3_1-long-session.test.mjs`.
  - Both Mode A (`SplitTranscript.tsx`) and Mode B (`RoomClient.tsx`) render a progressive `60`-turn DOM window (`"Show earlier messages (+N)"`), lock scroll (`isNearBottomRef` threshold `80px`), offer `"Latest ↓"` jump button, and clean up `copiedTimerRef`, `replayTimerRef`, `flushTimerRef`, and `requestAnimationFrame` loops on unmount.
  - `GeminiLiveTranslatorClient` enables `contextWindowCompression` (`12000` -> `4000` tokens), flushes pending partial turns on `goAway`/close, and cancels reconnect timers cleanly on `disconnect()` (verified in `qa-gemini-client.test.mjs`).
- **Caveats & Residual Risks:**
  - Saved `qa-audio-lifecycle-metrics.json` reflects `30` mock cycles / `300` turns in Node (`avg 0.064ms`, `heapDeltaKb: 1601`, `0` leaked visibility listeners) — not multi-hour browser DOM/AudioContext memory profiling.
  - Ephemeral `/api/session` tokens expire after `10 minutes` (`route.ts:152`); `GeminiLiveTranslatorClient` triggers `onGoAway` reconnect when the server closes/warns, so 20–30 minute sessions depend on automatic reconnect minting a fresh token without silent audio drop (not endurance-tested in a live multi-turn voice call).

---

## 10. Security Audit (Auth, Rate Limits, Headers, RBAC, Logging)

Independent static review + live read-only HTTP probe against `next start` (`127.0.0.1:3223`):

| Control Checked | Empirical Result | Notes |
|---|---|---|
| Mandatory `NOVA_AUTH_SECRET` (`NODE_ENV=production`) | **PASS** | Empty secret (`exit 1`) & `"changeme..."` placeholder (`exit 1`) fail fast in `instrumentation.ts`. |
| Security Response Headers (`next.config.ts`) | **PASS (with CSP caveat)** | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `HSTS (1y)`, `Permissions-Policy: microphone=(self), camera=(self), geolocation=(), payment=()`, `X-Powered-By` stripped. **Caveat:** `script-src` includes `'unsafe-inline'`. |
| Cookie Security (`nova_client_sid`, `nova_room_auth`) | **PASS** | `HttpOnly`, `SameSite=Lax`; `Secure` set when `x-forwarded-proto=https`. *(Minor: `isHttpsRequest` reads leftmost `x-forwarded-proto` hop rather than rightmost.)* |
| Unauth & Tampered Cookie Rejection | **PASS** | Unauth & tampered `nova_client_sid` on `POST /api/rooms` both return `401`. |
| Cross-Room & Role-Based Access Control | **PASS** | Cross-room `GET` returns `401`, no-cred `join` returns `400`, guest `join` `200`, QR replay `403`, relay role spoof `403`, guest `PATCH hostLang` `403`, guest `DELETE` `403`, host `DELETE` `200`, post-end `GET` `410`. |
| **Per-IP Rate Limit Under `CF-Connecting-IP` Spoofing** | **FAIL (BYPASS)** | Sending fresh `GET /` `nova_client_sid` cookies + rotating `CF-Connecting-IP: 198.51.100.<n>` bypassed `createRoomLimiterByIp` (`30`/5m): **`36/36` requests returned `201 Created`, `0` returned `429`**. Same `getClientIp()` function guards `/api/session` (`35`/min). |
| Per-Room PIN Lockout Under Spoofed `CF-Connecting-IP` | **PASS** | `room.failedJoinTimestamps` triggers `429` after `15` failed PIN attempts regardless of IP header rotation. |
| Server Logging Safety | **PASS** | `Select-String` across `app/api/**`, `lib/rooms/**`, `lib/security/**`, `proxy.ts`, `instrumentation.ts` confirmed only safe error names/config notices logged (zero keys, PINs, invite tokens, or transcripts). |
| Production Dependency Vulnerabilities | **PASS** | `npm audit --omit=dev` -> `0 vulnerabilities`. |

---

## 11. UX, Accessibility & Responsive Audit (`320px–1280px`, LTR & RTL)

Verified live via headless Chromium (`browser` subagent `e7a35668-4cf2-4439-9b2c-542fd1532edd`, `BROWSER_HOST_FACTS`: `visited_origins: http://127.0.0.1:3222`, `blocked_origins: none`) across `320x800`, `360x800`, `375x812`, `390x844`, `430x844`, `768x1024`, `1024x800`, `1280x800` (LTR & RTL):

- **What Passed:**
  - `0` out-of-bounds controls and `0` overlapping controls across all `8` LTR + `5` RTL viewports on `/`, `/mode-a`, `/mode-b`, and created room `/room/V7M3V7FH99A8YG` (`320`/`375`/`390` LTR & RTL).
  - Keyboard `Tab` focus outline clearly visible (`:focus-visible`), Language Modal filter (`"French"`) + `Escape` close (`[role="dialog"] 1 -> 0`), Settings Drawer `<details>` collapsed by default + `Escape`, Earbud Check `Escape`, RTL/LTR toggling (`dir="rtl"` / `lang="ar"`), and `aria-live="polite"` on Mode A live status (`Ready`).
- **Concrete Defects Observed:**
  1. **Zoom Disabled (`app/layout.tsx:47`):** `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">` prevents pinch-to-zoom (fails WCAG 2.1 SC 1.4.4 Resize Text on mobile).
  2. **Sub-44px Mobile Touch Targets (`<= 430px`):**
     - `/` (`HomeClient.tsx`): `"13 languages"` / `"13 لغة"` inline button measures **`16.5px` high** (`25.9px` wide in Arabic).
     - `/mode-a` (`SplitTranscript.tsx:763-820`): 5 segmented pills (`Auto`, `AR→EN`, `EN→AR`, `Hands-free`, `Hold to talk` in EN/AR) use `min-h-[40px]` (**`40px` tall**); at `320px`, `"Back to Home"` link is `40×44px`.
     - `/room/[roomId]` (`RoomClient.tsx:1805,2136,2147`): `Hands-free`, `Hold to talk`, and `"Your spoken language"` `<select>` measure **`40px` tall**.
  3. **Text Truncation at `320x800`:**
     - `/` LTR (`320x800`): `"Live Voice Translat..."`, `"Fre..."` (Partner French), `"Start C..."` (Mode A CTA).
     - `/` RTL (`320x800`): `"إنشاء أو د..."` (Mode B CTA).
     - `/mode-b` LTR (`320x800`): `"Fre..."` (Partner French).

---

## 12. Performance & Test Suite Audit

### 12.1 Browser Page Load & Resource Footprint (`1280x800` Cold Tabs, Local `next start`)

| Route | Network Requests | Known CL Sum / Unsized Count | `/vad/` Eager Loads | Cold Wall-Clock DCL / Load |
|---|---:|---|---:|---:|
| `/` | `32` (`14` js, `10` font, `6` fetch, `1` css, `1` doc) | `270.44 KB` (`21` chunked without CL) | `0` | `500 ms` / `670 ms` |
| `/mode-a?langA=ar&langB=en` | `26` (`12` js, `10` font, `2` fetch, `1` css, `1` doc) | `270.44 KB` (`15` chunked without CL) | `0` | `221 ms` / `480 ms` |
| `/mode-b` | `25` (`11` js, `10` font, `2` fetch, `1` css, `1` doc) | `270.23 KB` (`15` chunked without CL) | `0` | `241 ms` / `519 ms` |

Total built `.next/static/chunks/` footprint on disk is **`1,919,579` bytes (`1.83 MiB`)** across `20` chunk/css files (largest chunk `450.6 KB`). Lazy-loading `/vad/` prevents the ~`17.2 MB` ONNX/WASM payload from impacting initial page loads.

### 12.2 Test Suite Meaningfulness Evaluation

| Check / Script | Execution in Audit | What It Actually Proves vs. Limitation |
|---|---|---|
| `npx tsc --noEmit` & `npm run lint` | **Executed (`exit 0`)** | Real static type-safety and ESLint cleanliness across workspace. |
| `npm audit --omit=dev` | **Executed (`0` vulns)** | Real production dependency CVE check against npm registry. |
| `scripts/phase3_0-ux-regression.test.mjs` | **Executed (`exit 0`)** | **Static regex/substring assertions only** + SHA-256 freeze check. Did NOT catch `maximum-scale=1`, `40px` buttons, or `320px` truncation. |
| `scripts/phase3_1-long-session.test.mjs` | **Executed (`exit 0`)** | Real behavioral unit test of `transcriptStore` (`150` turns, timestamp sort, `QuotaExceededError` `80`/`40` fallback) using mock `localStorage` + SHA-256 check. |
| `scripts/qa-gemini-client.test.mjs` | **Executed (`exit 0`)** | Behavioral unit test of `GeminiLiveTranslatorClient` using stubbed `fetch` & mock `.session` (`401` handling, `hasAudio=false`, `goAway` flush + reconnect timer cancel). |
| Scratch `sec_probe.mjs` (Phase 6 diagnostic) | **Executed (`exit 0`)** | Live `next start` HTTP verification of fail-fast `NOVA_AUTH_SECRET`, cookie/headers, Mode B RBAC, PIN lockout, and **proven `CF-Connecting-IP` rate-limit bypass**. |
| `scripts/phase1_1-readiness.test.mjs` | Inspected (not run to avoid Gemini API calls) | Tests real multi-process HTTP, secret rotation, concurrent 5-way joins, `X-Forwarded-For` rightmost IP logic (**did not test `CF-Connecting-IP`**). |
| `scripts/functional-regression.test.mjs` | Inspected (not run to avoid Gemini API calls) | Real HTTP + SSE + out-of-order `turnId` audio + Mode B signal relay E2E, plus `/api/session` voice checks. |
| `scripts/qa-audio-lifecycle.test.mjs` | Inspected (not run; mutates metrics JSON & calls `/api/session`) | Real Node Web Audio mock tests (`30` cycles, `300` turns, `0` visibility listener leak) + Mode B HTTP/SSE cursor check. |
| `scripts/security-regression.test.mjs` | Inspected (not run; connects live Google WS) | Live cookie/CSRF/RBAC + ephemeral token `live.connect` lock check. |
| `scripts/run-phase2a-benchmark.mjs` | Inspected (frozen; paid benchmark) | **Text-input (`sendClientContent`) evaluation for `#1`–`#106`**, PCM audio only for `#107`–`#108`. |

---

## 13. Prioritized Findings List (Severity-Classified)

### High Severity

- **AUD-01 (High — Security): Unverified `CF-Connecting-IP` / `X-Real-IP` Header Trust Bypasses IP Rate Limiting**
  - **Location:** [lib/security/authCrypto.ts](file:///c:/Users/iat/earbud-translator/lib/security/authCrypto.ts#L376-L395) (`getClientIp`), guarding [app/api/session/route.ts](file:///c:/Users/iat/earbud-translator/app/api/session/route.ts#L78-L84), [app/api/rooms/route.ts](file:///c:/Users/iat/earbud-translator/app/api/rooms/route.ts#L76-L83), [app/api/rooms/[roomId]/join/route.ts](file:///c:/Users/iat/earbud-translator/app/api/rooms/%5BroomId%5D/join/route.ts#L67-L76).
  - **Evidence:** Empirical probe sent `36` `POST /api/rooms` requests with fresh `nova_client_sid` cookies and rotating `CF-Connecting-IP` headers (`limit = 30`/5m): `36/36` succeeded (`201 Created`), `0` returned `429`. Because Railway does not sit behind Cloudflare unless explicitly configured, any client can spoof `CF-Connecting-IP` or `X-Real-IP` to bypass IP rate limits on Gemini token minting (`/api/session`) and exhaust in-memory rooms (`MAX_ROOMS = 2000`).
  - **Remediation:** Only read `CF-Connecting-IP` / `X-Real-IP` when an explicit trusted-proxy flag (`TRUST_CLOUDFLARE_PROXY=true`) is enabled; otherwise derive client IP strictly from the trusted rightmost `X-Forwarded-For` hop (or add an HMAC-rate-limited `/api/session` guest ceiling).

- **AUD-02 (High — Reliability / Functional): Mode B Active Audio Session Stays Locked on Old Language Pair When Partner Changes Language**
  - **Location:** [components/RoomClient.tsx](file:///c:/Users/iat/earbud-translator/components/RoomClient.tsx#L597-L598) and [components/RoomClient.tsx](file:///c:/Users/iat/earbud-translator/components/RoomClient.tsx#L1120-L1139).
  - **Evidence:** Host's `handleLanguageChange` restarts `startAudioSession(ctx, data.room)` after updating their own language. When the **partner** executes `PATCH /api/rooms/[roomId]`, SSE emits `lang_update` and `RoomClient` runs `setRoom(parsed.room)` only — `clientRef.current` remains connected with the old ephemeral token's locked `systemInstruction` (`A<->B`) until stopped and restarted manually.
  - **Remediation:** Detect `hostLangCode`/`guestLangCode` changes inside `lang_update` (and polling snapshot updates) while `isRunning` is true, and automatically cycle `stopAudioSession()` -> `startAudioSession()` (with an unobtrusive `"Partner switched language — reconnecting"` notice) on the updated language pair.

- **AUD-03 (High — Validation / Product Readiness): Unexecuted Spoken Audio Benchmark, Bilingual Human Review, and Physical Hardware QA**
  - **Location:** [scripts/run-phase2a-benchmark.mjs](file:///c:/Users/iat/earbud-translator/scripts/run-phase2a-benchmark.mjs#L483-L486), [docs/reviews/PHASE_2C_HUMAN_REVIEW.md](file:///c:/Users/iat/earbud-translator/docs/reviews/PHASE_2C_HUMAN_REVIEW.md#L5-L17), [docs/RELEASE_READINESS_CHECKLIST.md](file:///c:/Users/iat/earbud-translator/docs/RELEASE_READINESS_CHECKLIST.md#L42-L46).
  - **Evidence:** Phase 2C `106/108 (98.1%)` tested `sendClientContent` text turns (`#1`–`#106`) rather than spoken audio (`sendRealtimeInput`), audio outputs were not saved for human listening, `PHASE_2C_HUMAN_REVIEW.md` remains unfilled, and `0` physical iOS/Android/Bluetooth tests have been run.
  - **Remediation:** Execute the [Physical Device & Human QA Checklist](#14-mandatory-pre-release-physical-device--human-qa-checklist) and sample real recorded Darija/French/English voice clips end-to-end before beta/launch.

### Medium Severity

- **AUD-04 (Medium — Accessibility): `<meta name="viewport">` Disables Pinch-to-Zoom (`maximumScale: 1`)**
  - **Location:** [app/layout.tsx](file:///c:/Users/iat/earbud-translator/app/layout.tsx#L43-L49).
  - **Evidence:** Live DOM renders `maximum-scale=1`, preventing low-vision mobile users from zooming (WCAG 2.1 SC 1.4.4).
  - **Remediation:** Remove `maximumScale: 1` from `export const viewport` (use `font-size >= 16px` on inputs instead to avoid unwanted iOS auto-zoom).

- **AUD-05 (Medium — Mobile Ergonomics & Responsive): `<44px` Touch Targets & `320px` Text Truncation**
  - **Location:** [components/HomeClient.tsx](file:///c:/Users/iat/earbud-translator/components/HomeClient.tsx#L232-L481), [components/SplitTranscript.tsx](file:///c:/Users/iat/earbud-translator/components/SplitTranscript.tsx#L763-L820), [components/RoomClient.tsx](file:///c:/Users/iat/earbud-translator/components/RoomClient.tsx#L1805-L2150), [components/ModeBCreateClient.tsx](file:///c:/Users/iat/earbud-translator/components/ModeBCreateClient.tsx#L362).
  - **Evidence:** Chromium audit at `<=430px` measured `40px`-tall segmented buttons (`SplitTranscript`, `RoomClient`), a `40×44px` Back link (`Mode A` at `320px`), a `16.5px`-tall `"13 languages"` button (`Home`), and ellipsis clipping at `320x800` (`"Start C..."`, `"Fre..."`, `"Live Voice Translat..."`, `"إنشاء أو د..."`).
  - **Remediation:** Raise mobile interactive controls/selects to `min-h-[44px]` (`min-w-[44px]` for Back link) and adjust `320px` padding/concise labels or allow wrapping on language/CTA labels so text stays legible.

- **AUD-06 (Medium — Architecture / Scaling): Process-Local Volatile Room Store & Rate Limiters**
  - **Location:** [lib/rooms/roomStore.ts](file:///c:/Users/iat/earbud-translator/lib/rooms/roomStore.ts#L132-L141), [lib/security/authCrypto.ts](file:///c:/Users/iat/earbud-translator/lib/security/authCrypto.ts#L467-L473).
  - **Evidence:** `roomStore` and rate-limit buckets reside purely in Node heap (`Map`). Any server restart, deploy, or second replica causes instant `404` for active Mode B conversations and splits rate-limit counters.
  - **Remediation:** Document and enforce strictly single-instance sticky execution (`replicas = 1`) for private beta, then migrate to shared Postgres/Redis (draft SQL already staged at [docs/migrations/0001_phase_1_1_rate_limits_and_rooms.sql](file:///c:/Users/iat/earbud-translator/docs/migrations/0001_phase_1_1_rate_limits_and_rooms.sql)) before multi-replica scaling.

- **AUD-07 (Medium — Real-Time Connectivity): WebRTC Public STUN-Only Configuration Without TURN Relay**
  - **Location:** [lib/audio/webrtcCallManager.ts](file:///c:/Users/iat/earbud-translator/lib/audio/webrtcCallManager.ts#L18-L24).
  - **Evidence:** Only `stun.l.google.com` / `stun1.l.google.com` configured; dual-carrier symmetric NAT will prevent P2P original voice audio (AI dubbing continues over HTTPS/SSE).
  - **Remediation:** Validate failure UX on cellular NAT during physical QA; provision TURN credentials (or clearly message `"Live voice blocked by mobile network — AI translation audio active"`) before wide production launch.

- **AUD-08 (Medium — Audio UX): Mode A / Mode B Text-Only Fallback Replay Cannot Route to Left/Right Ear**
  - **Location:** [lib/audio/replayHelper.ts](file:///c:/Users/iat/earbud-translator/lib/audio/replayHelper.ts#L87-L105).
  - **Evidence:** Beyond `36` cached turns (`MAX_CACHED_TURNS`) or after reload, `replayTurnAudio` falls back to `window.speechSynthesis`, outputting to center/both earbuds regardless of `opts.channel`.
  - **Remediation:** Indicate `"Browser voice (both ears)"` when PCM audio is unavailable, or keep Web Speech clearly labeled so shared-earbud users aren't surprised.

### Low & Informational

- **AUD-09 (Low — Security Hardening): CSP `script-src` Retains `'unsafe-inline'` & `allowedDevOrigins` Contains Static LAN IP**
  - **Location:** [next.config.ts](file:///c:/Users/iat/earbud-translator/next.config.ts#L11), [next.config.ts](file:///c:/Users/iat/earbud-translator/next.config.ts#L49).
  - **Detail:** `'unsafe-inline'` weakens XSS script protection (Next.js inline hydration bootstrap without per-request nonces), and `allowedDevOrigins` includes hardcoded developer IP `192.168.100.31` (dev-only).
- **AUD-10 (Low — Security Consistency): `isHttpsRequest()` Inspects Leftmost `x-forwarded-proto` Hop**
  - **Location:** [lib/security/authCrypto.ts](file:///c:/Users/iat/earbud-translator/lib/security/authCrypto.ts#L397-L407).
  - **Detail:** Reads `split(",")[0]` instead of rightmost proxy hop; minimal risk (worst case forces `Secure` flag on HTTP).
- **AUD-11 (Low — Error State Hygiene): `RoomClient.handleSelectMic` Drops Error Status on Mic Loss**
  - **Location:** [components/RoomClient.tsx](file:///c:/Users/iat/earbud-translator/components/RoomClient.tsx#L1152-L1155).
  - **Detail:** Calls `stopAudioSession()` instead of `stopAudioSession(true)`, resetting error banner state to `"disconnected"`.
- **AUD-12 (Low — Docs/Build Hygiene): JSDoc Drift (`vadManager.ts`), Unused `77.3 MB` WASM/ONNX Variants (`public/vad/`), Stale `sw.js` Comment**
  - **Locations:** [lib/audio/vadManager.ts](file:///c:/Users/iat/earbud-translator/lib/audio/vadManager.ts#L51) (`650ms` doc vs `520ms` preset), [scripts/copy-vad-assets.mjs](file:///c:/Users/iat/earbud-translator/scripts/copy-vad-assets.mjs#L11-L21) (copies `legacy`, `jsep`, `asyncify`), [public/sw.js](file:///c:/Users/iat/earbud-translator/public/sw.js#L11).
- **AUD-13 (Informational — Test Suite Coverage):** [scripts/phase3_0-ux-regression.test.mjs](file:///c:/Users/iat/earbud-translator/scripts/phase3_0-ux-regression.test.mjs) performs file-string grep checks only and should be complemented by automated headless browser assertions (viewport, `<44px` target audit, overflow checks).

---

## 14. Mandatory Pre-Release Physical Device & Human QA Checklist

The following items **have NOT been executed** and are required before production launch:

1. **Physical Mode A (Shared Earbuds — iOS Safari + Android Chrome):**
   - [ ] Pair wired USB-C/Lightning stereo earbuds and Bluetooth TWS (AirPods / Galaxy Buds / generic TWS).
   - [ ] Verify Left ear (`-1.0`) vs Right ear (`+1.0`) audio isolation during live Darija <-> French/English speech + `Swap ears` toggle.
   - [ ] Verify built-in phone mic lock works on Android Chrome without forcing Bluetooth HFP SCO mono audio degradation.
   - [ ] Verify Screen Wake Lock (`useWakeLock`), lock-screen unlock recovery (`AudioContext.resume()`), incoming phone call interruption, and `15–30 min` continuous session memory stability.
2. **Physical Mode B (Two-Phone Conversation — Wi-Fi + Cellular 4G/5G):**
   - [ ] Phone A Host creates room -> Phone B scans QR code (rear camera `QrScannerModal` + Upload Screenshot fallback) AND tests manual Room Code + 6-char PIN entry.
   - [ ] Verify Wi-Fi <-> 4G/5G handoff recovery (`SSE` drop -> `1000ms` polling cursor -> `SSE` reconnect with zero duplicate audio playback).
   - [ ] Measure real two-phone WebRTC original-voice smart ducking (`VOICE_IDLE_GAIN` <-> `VOICE_DUCKED_GAIN`) + AEC echo cancellation on speakerphone.
   - [ ] Measure actual end-to-end **acoustic TTFA** (end of human speech to first translated audio heard in ear) vs `1.26s` P50 text-only Gemini latency.
3. **Bilingual Human Translation & Acoustic Listening Review:**
   - [ ] Native Algerian Darija / French / English reviewers score the `25` turns in [PHASE_2C_HUMAN_REVIEW.md](file:///c:/Users/iat/earbud-translator/docs/reviews/PHASE_2C_HUMAN_REVIEW.md), specifically adjudicating `#55` (`ghali sahbi`) and `#81` (`شحال؟`).
   - [ ] Run at least `15–20` live spoken audio trials across noisy cafe, fast Darija code-switching, and soft speech to measure real ASR accuracy, accent quality, and VAD cutoff boundaries.
4. **Screen Reader & Mobile Zoom Accessibility QA:**
   - [ ] Verify iOS VoiceOver & Android TalkBack navigation across `Mode A`, `Mode B` (`aria-live="polite"`), language modal, and PIN gate after removing `maximum-scale=1`.

---

## 15. Independent Scorecard

| Audit Domain | Score | Justification (Observed Evidence) |
|---|---:|---|
| 1. Build & Baseline Integrity | **9 / 10** | Zero TypeScript/ESLint errors, `.next` build intact, `13/13` Phase 2C hashes match verbatim. |
| 2. Translation Prompt & Safeguards | **7.5 / 10** | Strong prompt isolation, server-locked ephemeral config, `20/20` negation & `100%` silence traps on saved dataset — capped because `#1`–`#106` tested text input, not spoken audio, and human listening review is pending. |
| 3. Audio Pipeline Engineering | **8 / 10** | Clean WebAudio panner isolation, epoch VAD guards, HFP/AEC separation, bounded LRU replay, `0` listener leaks in Node checks; slight points deducted for JSDoc drift, TTS mono fallback, `77.3MB` VAD assets, and STUN-only NAT traversal. |
| 4. Mode A Completeness | **8.5 / 10** | Cohesive dual-ear UX, live language switch, mid-speech stream end flush, error retention, `0px` overflow; pending physical earbud field verification. |
| 5. Mode B Completeness | **7 / 10** | Strong QR fragment scrubbing, single-use invites, SSE+cursor recovery, and WebRTC signaling; docked for active-session partner `lang_update` desync (`AUD-02`) and volatile in-memory state. |
| 6. Long-Session Durability | **8 / 10** | `200`-turn store + `80`/`40` quota fallback, `60`-turn DOM windowing, smart scroll lock, timer/abort cleanup, context window compression (`12000->4000`). |
| 7. Security & Privacy | **7 / 10** | Fail-closed `NOVA_AUTH_SECRET`, rotation support, solid room RBAC/PIN lockout/logging hygiene, `0` CVEs; docked sharply for proven `CF-Connecting-IP` rate-limit bypass (`AUD-01`) and `'unsafe-inline'` CSP. |
| 8. UX, RTL & Accessibility | **7 / 10** | Clean sage/sand palette, zero consumer jargon, `0px` overflow across all 8 widths LTR+RTL, keyboard modals; docked for `maximum-scale=1` zoom block, `40px`/`16.5px` touch targets, and `320px` truncation. |
| 9. Performance & Bundle Hygiene | **8 / 10** | Fast local load (`221–500ms` DCL, `0` eager `/vad/` fetches); docked for `77.3 MB` unused VAD binaries in `public/vad/`. |
| 10. Verification Rigor & Honest Readiness | **7.5 / 10** | Good backend HTTP/unit/lifecycle tests and freeze manifests, but `phase3_0` is static grep checks only, Phase 2C lacked voice-input evaluation, and hardware/human QA remain undone. |

---

## 16. Final Verdict

### **Verdict: `C. NEEDS TARGETED PRE-LAUNCH FIXES BEFORE BETA`**

**Rationale:**  
NOVA's core architecture, prompt freeze integrity, and cryptographic room authentication are fundamentally well-engineered. However, **releasing to remote beta testers on Railway right now would expose two avoidable High-severity defects** uncovered empirically during this audit (`AUD-01` `CF-Connecting-IP` IP rate-limit bypass on Gemini token minting / room creation, and `AUD-02` Mode B active translation session desyncing when a partner changes language), alongside a WCAG pinch-to-zoom block (`AUD-04` `maximum-scale=1`) and `<44px` mobile touch targets / `320px` truncation (`AUD-05`). Additionally, real acoustic Darija voice benchmarks, bilingual human listening sign-off, and physical iOS/Android/Bluetooth tests remain unexecuted (`AUD-03`).

---

## 17. Concrete Next-Step Action Plan (For Future Approved Phase)

| Priority | Action | Target File(s) | Verification |
|---|---|---|---|
| **P0 (Pre-Beta Security)** | Restrict `CF-Connecting-IP` / `X-Real-IP` in `getClientIp()` behind explicit trusted-proxy configuration (`TRUST_CLOUDFLARE_PROXY`), defaulting to rightmost `X-Forwarded-For` hop. | `lib/security/authCrypto.ts` | Verify `36` spoofed `CF-Connecting-IP` requests trigger `429` at `>30` on `POST /api/rooms` & `/api/session`. |
| **P0 (Pre-Beta Functional)** | Restart active `GeminiLiveTranslatorClient` session cleanly in `RoomClient` whenever `lang_update` / poll snapshot changes `hostLangCode` or `guestLangCode` while `isRunning`. | `components/RoomClient.tsx` | Simulate partner `PATCH` language switch during active Mode B call and confirm session restarts on new pair. |
| **P1 (Accessibility & 320px UI)** | Remove `maximumScale: 1`; raise segmented buttons, `<select>`, `Mode A` Back link (`320px`), and `"13 languages"` control to `>= 44px`; prevent `320px` CTA/card truncation. | `app/layout.tsx`, `HomeClient.tsx`, `SplitTranscript.tsx`, `RoomClient.tsx`, `ModeBCreateClient.tsx` | Re-run headless Chromium viewport & touch-target audit across `320`–`1280px` LTR & RTL. |
| **P1 (Audio & Consistency)** | Fix `handleSelectMic` `stopAudioSession(true)`, align `VadManager` JSDoc (`520ms`), label Web Speech center-channel replay fallback, and trim unused `.jsep`/`.asyncify`/`legacy` VAD files if unused. | `RoomClient.tsx`, `vadManager.ts`, `replayHelper.ts`, `copy-vad-assets.mjs` | Run `qa-audio-lifecycle.test.mjs`, `npm run build`, verify `vad-web` asset loading. |
| **P2 (Field & Human Validation)** | Execute bilingual human review (`PHASE_2C_HUMAN_REVIEW.md`), spoken audio recordings test, and physical iOS/Android/Bluetooth QA + TURN decision on Railway single-instance sticky config. | `docs/reviews/PHASE_2C_HUMAN_REVIEW.md`, physical test devices | Complete all checklist gates in Section 14 before public launch. |
