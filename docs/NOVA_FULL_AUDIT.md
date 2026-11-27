# NOVA — Full Technical Audit & Product Quality Assessment

**Repository:** `https://github.com/abdelliimad-dot/nova-translator`  
**Production Preview:** `https://nova-web-production-928bbc38.up.railway.app/`  
**Framework & Runtime:** Next.js `16.4.6` (Turbopack, App Router, `cacheComponents: true`), React `19.3.0`, TypeScript `5`, Node.js `v24.19.0` (local) / `26.13.1` (Railway)  
**AI SDK & Model:** `@google/genai` `^3.6.1`, `models/gemini-2.5-flash-native-audio-latest` (`v1alpha`)  
**Audit Scope:** Read-only code inspection, Next.js 16.4.6 internal docs review (`node_modules/next/dist/docs/`), `@google/genai` declaration inspection, isolated local API/WebSocket probing (`http://127.0.0.1:3000`), and non-destructive production edge/token verification. **No application source files were modified, and no secrets were logged or exposed.**

---

## 1. Executive Summary

NOVA is a functional, visually cohesive bilingual real-time voice translation PWA supporting two primary workflows: **Mode A** (shared Bluetooth earbuds on one phone with `180deg`-rotated face-to-face split view and Web Audio Left/Right panning) and **Mode B** (two phones paired via QR/code over SSE + HTTP polling with live P2P WebRTC voice ducking). The core Gemini Live ephemeral-token flow (`POST /api/session` -> WebSocket `ai.live.connect`), local Silero VAD gating (`@ricky0123/vad-web`), Next.js `16.4.6` production build, and responsive mobile UI (`360x800` EN/AR, `>=44px` touch targets, `0` client-bundle API key leaks) are cleanly built and operational.

However, the audit identified **3 Critical** and **9 High** architectural, security, audio-engineering, and reliability defects that should be resolved before public rollout:

1. **Critical Security & Cost-Drain Risk (`POST /api/session`):** Anyone on the public internet can mint 15-minute Gemini Live ephemeral tokens at `~717ms/req` with zero authentication, rate limiting, origin checks, or `lockAdditionalFields` constraints (`app/api/session/route.ts:20-99`). Verified live against production (`UNAUTHED_SESSION_ALLOWED:True`).
2. **Critical Two-Phone Authorization & Privacy Bypass (`/api/rooms/[roomId]`):** Room IDs have no participant token or secret. Any caller can guess/enumerate a 4–12 character code (or auto-create `AAAA`), spoof `host`/`guest` transcripts, hijack `hostLang`/`guestLang`, inject WebRTC `offer`/`hangup` signals, eavesdrop on relayed audio packets, and remotely terminate active rooms via `DELETE` (`lib/rooms/roomStore.ts:118-396`, `app/api/rooms/[roomId]/route.ts:9-76`). Verified locally (`SPOOF_HOST_TRANSCRIPT_OK:True`, `UNAUTHED_DELETE_OK:True`).
3. **High Audio Loop & PTT Capture Defects (`micManager.ts`, `vadManager.ts`, `ModeAClient.tsx`, `RoomClient.tsx`):**
   - **Mode B Acoustic Double-Translation Loop:** `MicManager` disables `echoCancellation`, `noiseSuppression`, and `autoGainControl` globally (`lib/audio/micManager.ts:108-122`) to protect Mode A Bluetooth A2DP stereo, leaving Mode B speakerphone calls without browser AEC and vulnerable to re-translating partner loudspeaker output.
   - **Push-to-Talk Still Gated by Silero VAD:** Both `ModeAClient.tsx:290-294` and `RoomClient.tsx:762-766` rely on `VadManager.onAudioFrame`, which only fires when `this.isSpeaking` is true (`lib/audio/vadManager.ts:136-143`), silently dropping whispered/noisy PTT speech.
4. **High Session Lifecycle & Cross-Talk Isolation Defects:** Neither `ModeAClient` nor `RoomClient` handles `onGoAway` / WebSocket disconnects / `sessionResumption` (`lib/ai/geminiLiveClient.ts:380-382`), leaving dead connections stuck with `isRunning = true`. Additionally, `StereoEngine` routes all Mode A live turns through a single shared `StereoPannerNode` (`lib/audio/stereoEngine.ts:539-555`), risking mid-utterance channel shifts when speakers overlap.

---

## 2. Actual Architecture Map

```text
+---------------------------------------------------------------------------------------------------+
|                                   CLIENT PWA (Next.js App Router)                                  |
|  Routes: / (HomeClient) | /mode-a (ModeAClient+SplitTranscript) | /mode-b | /room/[roomId]        |
|  Storage: localStorage (nova_settings_v1, nova_modea_turns_v1:*, nova_room_turns_v1:*)            |
|  SW: public/sw.js (network-first passthrough, no offline caching yet)                             |
+---------------------------------------------------------------------------------------------------+
         |                             |                                |                    |
         | POST /api/session           | 16kHz PCM16 WebSocket          | SSE + 1s Poll      | WebRTC P2P
         v                             v                                v                    v (STUN only)
+--------------------+     +-------------------------------+   +----------------------+   +-----------------+
| Next.js BFF Route  |     | Google Gemini Live API        |   | Next.js Room Routes  |   | Peer Device     |
| /api/session       |     | models/gemini-2.5-flash-      |   | /api/rooms           |   | WebRTC Audio    |
| (GEMINI_API_KEY)   |     | native-audio-latest (v1alpha) |   | /api/rooms/[id]      |   | (stun.l.google) |
| Mints 1-use token  |     | Input: 16kHz PCM16 (VAD-only) |   | /api/rooms/[id]/events   +-----------------+
| 90s connect / 15m  |     | Output: 24kHz PCM16 + text    |   | /api/rooms/[id]/relay|
+--------------------+     +-------------------------------+   +----------------------+
                                                                        |
                                                                        v
                                                         globalThis.__earbudRooms Map
                                                         (single Node process RAM only)
```

### Verified Inventory of Runtime Modules

| Layer | Implemented Files | Actual Behavior |
|---|---|---|
| **App Pages** | `app/page.tsx`, `app/mode-a/page.tsx`, `app/mode-b/page.tsx`, `app/room/[roomId]/page.tsx`, `app/layout.tsx`, `app/manifest.ts` | Server wrappers delegating immediately to `"use client"` roots wrapped in `<Suspense>`. |
| **BFF API Routes** | `app/api/session/route.ts`, `app/api/rooms/route.ts`, `app/api/rooms/[roomId]/route.ts`, `app/api/rooms/[roomId]/events/route.ts`, `app/api/rooms/[roomId]/relay/route.ts` | Unauthenticated HTTP JSON & SSE (`8KB` tunnel-flush padding + `15s` keepalive `: ping`). |
| **Gemini Client** | `lib/ai/geminiLiveClient.ts`, `lib/languages.ts` | Browser connects directly to Google Live API using ephemeral token over `v1alpha`. |
| **Audio Engine** | `lib/audio/stereoEngine.ts`, `lib/audio/micManager.ts`, `lib/audio/vadManager.ts`, `lib/audio/replayHelper.ts`, `lib/audio/webrtcCallManager.ts` | `StereoEngine` (`AudioContext` + `StereoPannerNode` + `GainNode` ducking), Silero v5 WASM (`numThreads = 1`), WebRTC clone-track P2P voice. |
| **State & UI** | `lib/settingsStore.ts`, `lib/transcriptStore.ts`, `lib/i18n.ts`, `components/*` | `useSyncExternalStore` + `localStorage` persistence; NOVA ivory/forest-green UI (`EN`/`AR` RTL). |
| **Build & Assets** | `next.config.ts`, `scripts/copy-vad-assets.mjs`, `public/vad/*` | `cacheComponents: true` + `partialPrefetching: true`; `73.79 MiB` ONNX/WASM copied on `postinstall` & tracked in Git. |

---

## 3. Implemented versus Planned Features

Cross-checked against `SPEC.md.md` (`lines 1-89`):

| Feature Area (`SPEC.md.md`) | Planned State | Actual Implemented State | Delta / Gap |
|---|---|---|---|
| **Mode A Shared Earbuds** | Built-in mic lock + Left/Right `StereoPannerNode` + `EarbudTestModal` | **Implemented** (`micManager.ts`, `stereoEngine.ts`, `EarbudTestModal.tsx`) | Shared `liveStreamPanner` (`stereoEngine.ts:539`) lacks per-channel isolation during overlap; physical Bluetooth hardware untested here. |
| **Local Silero VAD** | Stream only active speech; pause on silence (`50-70%` savings) | **Implemented** (`vadManager.ts`) | Push-to-Talk mode accidentally still gated by VAD; `73.79 MiB` WASM bundle includes unused `legacy.onnx`, `jsep.wasm`, `asyncify.wasm`. |
| **Gemini Live BFF Security** | Ephemeral token route (`/api/session`), never expose `GEMINI_API_KEY` | **Partially Implemented** (`app/api/session/route.ts`) | Key is safely server-side, **but** endpoint is wide-open unauthenticated, rate-unlimited, and omits `lockAdditionalFields` & `sessionResumption`. |
| **Sliding Context Window** | Compression / history trim keeping cost `~$0.015-$0.02/min` | **Implemented** (`triggerTokens: "12000"`, `targetTokens: "4000"`) | No automatic reconnect on `15m` token expiry / `goAway`; no server usage telemetry yet. |
| **Mode B QR Rooms** | QR creation, link join, no login, full-duplex two-phone audio + transcript | **Implemented** (`ModeBCreateClient.tsx`, `RoomClient.tsx`, `webrtcCallManager.ts`) | Exceeded spec with WebRTC P2P voice + smart ducking & QR scanner, **but** rooms lack access tokens, TURN relay, and Redis/multi-instance state. |
| **PWA & Production Tracking** | Manifest + SW + session timer + Supabase hooks + Safari/Chrome unlock | **Partially Implemented** | Manifest, icons, `unlockSync`, and call timer exist; `public/sw.js` is a no-op stub and usage tracking hooks (`SPEC.md.md:81`) are absent. |

---

## 4. Critical Security Findings

### [SEC-01] Critical — Unauthenticated `/api/session` Enables Public Gemini Quota & Cost Drain
- **File & Lines:** `app/api/session/route.ts:20-99`
- **Evidence:** `POST /api/session` parses `{ langA, langB, voiceName }` and immediately calls `ai.authTokens.create(...)` using server `GEMINI_API_KEY` without session cookies, CAPTCHA, proof-of-work, signed invite verification, or IP rate limiting. Live probe against production confirmed:  
  `PROD_SESSION_STATUS:200 MS:717 MODEL:models/gemini-2.5-flash-native-audio-latest HAS_TOKEN:True UNAUTHED_SESSION_ALLOWED:True`.
- **User Impact:** Any automated script can repeatedly call `POST /api/session` against the public Railway URL to steal 15-minute Gemini Live audio sessions billed directly to the project owner's Google Cloud/AI Studio account.
- **Recommended Fix (aligns with Next.js 16 `proxy.ts` & BFF guide `node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md`):**
  1. Add Origin/Fetch-Metadata enforcement (`Sec-Fetch-Site: same-origin` / `Origin` allowlist) and signed anonymous HttpOnly session cookies via Next.js 16 `proxy.ts` (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`).
  2. Enforce sliding-window per-IP + per-session rate limiting and concurrency caps before calling `ai.authTokens.create`.
  3. Lock ephemeral token fields via `lockAdditionalFields` (`node_modules/@google/genai/dist/genai.d.ts:3043`) and validate `langA`/`langB` strictly against `SUPPORTED_LANGUAGES` allowlist codes rather than free-text strings (`app/api/session/route.ts:8-13`).
- **Required Regression Tests:** Unauthenticated cross-origin `POST /api/session` returns `403`; exceeding per-IP quota returns `429`; arbitrary non-allowlisted `langA` strings return `400` or resolve strictly to canonical `SUPPORTED_LANGUAGES` labels.

### [SEC-02] Critical — Complete Lack of Room Authorization (IDOR, Impersonation, Eavesdropping & Remote DoS)
- **File & Lines:** `lib/rooms/roomStore.ts:118-396`, `app/api/rooms/[roomId]/route.ts:9-76`, `app/api/rooms/[roomId]/relay/route.ts:40-106`, `app/api/rooms/[roomId]/events/route.ts:9-80`
- **Evidence:**
  1. Any 4–12 character alphanumeric room ID is accepted and silently auto-created via `GET /api/rooms/[roomId]` (`roomStore.ts:204-225`) — a 4-character ID space (`~1.67M`) is trivially enumerable.
  2. Verified locally against `http://127.0.0.1:3000`: calling `GET /api/rooms/AAAA?role=guest` succeeded (`200`), `POST /api/rooms/AAAA/relay` with `role: "host"` injected spoofed host messages (`SPOOF_HOST_TRANSCRIPT_OK:True`), and `DELETE /api/rooms/AAAA` killed the room (`UNAUTHED_DELETE_OK:True`).
  3. Relayed PCM16 partner audio (`afterAudioSeq`) and WebRTC SDPs (`afterSignalSeq`) are readable without credentials.
- **User Impact:** Any third party guessing a room code can listen to private translated voice audio, inject forged messages or WebRTC offers/hangups as the partner, or terminate an ongoing call.
- **Recommended Fix:** Issue high-entropy cryptographic `hostToken` and `guestJoinSecret` (embedded in QR fragment/query, exchanged for per-participant bearer token/HttpOnly cookie on join), enforce role ownership on `PATCH`/`DELETE`/`relay`/`events`/`GET`, disallow silent auto-creation of unknown room codes on `GET` (`404` unless created via `POST /api/rooms`), and generate >= 8-char random room IDs (`crypto.randomBytes`).
- **Required Regression Tests:** Accessing `/api/rooms/[id]` without valid participant token returns `401`/`403`; guest token cannot `DELETE` room or relay with `role: "host"`; nonexistent 4-char code `GET` returns `404`.

### [SEC-03] High — Missing HTTP Security Headers (`CSP`, `HSTS`, `X-Frame-Options`, `nosniff`, `Permissions-Policy`)
- **File & Lines:** `next.config.ts:1-18`, absence of `proxy.ts` (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`)
- **Evidence:** `HEAD https://nova-web-production-928bbc38.up.railway.app/` returned `HTTP 200` with `X-Powered-By: Next.js` and **zero** security headers (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).
- **User Impact:** Increases blast radius of clickjacking overlays (forcing accidental mic/call clicks), MIME sniffing, and third-party script injection against ephemeral tokens/localStorage transcripts.
- **Recommended Fix:** Configure strict `headers()` in `next.config.ts` (`poweredByHeader: false`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security`, `Permissions-Policy: microphone=(self), camera=(self)`), and implement nonce-based or strict `Content-Security-Policy` per `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:44-87` allowing `wss://generativelanguage.googleapis.com` and WASM `'wasm-unsafe-eval'`.
- **Required Regression Tests:** Automated header check asserts presence of all 6 security headers and absence of `X-Powered-By` on `/`, `/mode-a`, `/mode-b`, and `/api/*`.

### [SEC-04] High — Unbounded Payload Size & Missing Schema Validation in `/api/rooms/[roomId]/relay`
- **File & Lines:** `app/api/rooms/[roomId]/relay/route.ts:40-106`, `lib/rooms/roomStore.ts:314-420`
- **Evidence:** `POST /api/rooms/[roomId]/relay` spreads untrusted `...body.item` (`line 55`) without verifying `sourceText`/`translatedText` string types or lengths, accepts arbitrarily huge `body.data` base64 strings into `room.audioBuffer` (`MAX_AUDIO_BUFFER = 40`), and accepts arbitrary `body.payload` into `room.signalBuffer` (`MAX_SIGNAL_BUFFER = 80`).
- **User Impact:** Malicious or buggy clients can exhaust Node heap memory on Railway (`OOM` crash killing all concurrent rooms) or inject non-string fields breaking UI rendering.
- **Recommended Fix:** Enforce strict Zod/manual schema validation, truncate/cap transcript fields (`<= 2000` chars), cap `data` payload (`<= 256 KB`), validate ICE/SDP field shapes, and rate-limit per participant.
- **Required Regression Tests:** Oversized `>256KB` `audio` POST returns `413`; malformed `item` missing strings returns `400`.

### [SEC-05] Medium — Plaintext Bilingual Transcripts Persisted Indefinitely in `localStorage` & Client-Only Ephemeral Token Hygiene Verified Clean
- **File & Lines:** `lib/transcriptStore.ts:1-162`, `lib/settingsStore.ts:29-85`
- **Evidence:** Positive check: `.next/static/**/*.js` scan returned `AIzaSy_IN_CLIENT_JS: 0` and `GEMINI_API_KEY_IN_CLIENT_JS: 0`; git tracked scan returned `0` `.env` secrets (`*.pem` also excluded `certificates/localhost-key.pem`). However, `lib/transcriptStore.ts:96-143` persists up to `40` turns per language pair / room indefinitely in unencrypted `localStorage` across sessions without TTL auto-purge.
- **User Impact:** Sensitive medical, travel, or private conversations remain readable in `localStorage` on shared phones until manually cleared.
- **Recommended Fix:** Add optional "Ephemeral / Incognito Session" default or 24-hour expiration pruning for stored transcripts in `lib/transcriptStore.ts`.
- **Required Regression Tests:** Stored entries older than TTL are pruned on hydration and never re-rendered.

---

## 5. Translation Quality Findings & Benchmark Suite

### Technical Translation Pipeline Findings

#### [TRN-01] High — Same-Script Language Misclassification & Latin-Numeral Bias in Mode A Speaker Routing
- **File & Lines:** `lib/languages.ts:61-134`, `lib/ai/geminiLiveClient.ts:218-254`
- **Evidence:**
  1. `SCRIPT_PATTERNS` (`lib/languages.ts:61-69`) classifies `ar` vs Latin-script languages using Unicode block regexes (`[\u0600-\u06FF...]`). When Arabic output/input contains Western digits (`2026`, `500`), phone numbers, dates, or Algerian Darija French loanwords (`"normal"`, `"merci"`, `"bus"`, `"urgence"`), Latin characters increment `latinCount`, weakening `nonLatinCount > latinCount` margin on short turns (`lines 115-126`).
  2. For same-script pairs (e.g., `fr` ↔ `en`, `fr` ↔ `es`, `ar` ↔ `ur`, `de` ↔ `tr`), `STOPWORDS` (`lines 71-79`) lacks entries for `ja`, `ko`, `zh`, `hi`, **`ur`**, **`ar`** (no Arabic/Urdu disambiguation via Urdu-specific letters `پ چ ژ گ ٹ ڈ ڑ ے`), and **`tr`** is limited to 10 words (`line 78`). And `Math.abs(scoreA - scoreB) < 1.5` returns `null`, falling back to `lastResolvedSpeaker` (`line 255`) — causing **wrong-earbud routing**.
- **User Impact:** In Mode A (`fr ↔ en`, `fr ↔ es`, or code-switched Algerian Darija), short phrases or numbers frequently route to the wrong speaker's earbud.
- **Recommended Fix:** Expand `STOPWORDS` (`>=40` high-frequency function words + diacritics/characters like French `é è ê ç à` and Turkish `ğ ş ı ç ö ü`, Urdu-specific glyphs vs Arabic), strip ASCII digits `[0-9]` before script-ratio comparison, and instruct Gemini Live (or parse turn direction tag) cleanly when ambiguous.
- **Required Regression Tests:** Unit test `detectLanguageSide` across mixed Darija+French (`"راني رايح للـ bus على 8"` -> `"A"`), Arabic numerals (`"الساعة 14:30"` -> `"A"`), French vs English short phrases, and `ar` vs `ur`.

#### [TRN-02] Medium — Unused `enableAffectiveDialog` & `proactivity` Config Flags + `autoDetect` Toggle Bug
- **File & Lines:** `app/api/session/route.ts:58-73`, `lib/ai/geminiLiveClient.ts:330-355`, `components/ModeAClient.tsx:64-66`, `node_modules/@google/genai/dist/genai.d.ts:12582-12613`
- **Evidence:**
  1. `@google/genai` `LiveConnectConfig` exposes `enableAffectiveDialog?: boolean` (emotion-adaptive vocal delivery) and `proactivity?: ProactivityConfig` (ignoring irrelevant background chatter). Neither is configured; natural tone relies purely on prompt text (`lib/languages.ts:52`).
  2. In `ModeAClient.tsx:64-66`, `useState<SpeakerOverride>(settings.autoDetect ? "auto" : "A")` only reads `settings.autoDetect` at initial mount. Toggling **"Automatic Language Detection"** in `AudioSettingsDrawer` does nothing live unless the page reloads.
- **User Impact:** Toggling Auto-Detect in Settings has no visible effect; noisy cafes risk occasional filler responses instead of leveraging native model proactivity filtering.
- **Recommended Fix:** Validate whether `models/gemini-2.5-flash-native-audio-latest` supports `enableAffectiveDialog: true` / `proactivity: { proactiveAudio: true }` via ephemeral test, and sync `settings.autoDetect` updates in `ModeAClient.tsx`.
- **Required Regression Tests:** Toggling `autoDetect` in Settings updates active `speakerOverride` state and syncs active `GeminiLiveTranslatorClient`.

#### [TRN-03] Medium — Ambiguous `"Arabic"` Prompt Framing Without Explicit Dialect Output Guidance for Mode B Target Listeners
- **File & Lines:** `lib/languages.ts:39-59`, `app/api/session/route.ts:8-39`
- **Evidence:** `buildInterpreterSystemPrompt` handles Darija understanding (`lines 45-47`) well, **but** outputs "spoken translation" without clarifying whether Arabic output should favor **warm conversational Levantine/Maghrebi-accessible MSA** vs formal classical Fusha when speaking casually vs professionally. Also, prompt uses `this.options.langALabel` (e.g., `"Arabic"`), not distinguishing dialect preferences.
- **User Impact:** English/French -> Arabic output occasionally shifts register mid-conversation between stiff news-style Fusha and colloquial phrasing.
- **Recommended Fix:** Clarify target register ("clear, natural, warm everyday spoken Arabic understood across the Arab world, matching casual vs formal register of the source").
- **Required Regression Tests:** Evaluate consistency across the 32-case benchmark below on physical live runs.

---

### Reproducible 32-Case Translation Benchmark Matrix

> **Honest Status Declaration:** **All 32 live audio translation cases below are currently UNTESTED end-to-end against recorded human speech.** No audio files or synthetic TTS runs were executed during this read-only audit, and no scores are fabricated. All cases are structured for reproducible execution on `http://127.0.0.1:3000/mode-a` and `/mode-b`.

**Rubric per Case (Score 0–2 each, Max 6):**
- **Meaning & Intent Accuracy (`0-2`):** Preserves core meaning + speaker intent (`0` wrong/hallucinated, `1` partial/awkward, `2` accurate).
- **Idiomatic Fluency & Register (`0-2`):** Sounds like natural everyday speech, not literal translation.
- **Channel / Noise Discipline (`0-2`):** Routes to correct speaker/earbud (Mode A) or remains silent on non-speech/hallucination traps.

| # | Pair / Scenario | Input Utterance (Source) | Expected Idiomatic Target / Intent | Focus & Edge Case | Status |
|---|---|---|---|---|---|
| 1 | Darija -> French | "صحيت خويا، وين جاي المحطة تاع الترامواي؟" | "Merci mon frère, où se trouve l'arrêt de tramway ?" | Algerian greeting + French loanword | **UNTESTED** |
| 2 | Darija -> French | "ماعليش، راني جاي دوك فالطريق، عشر دقايق ونكون تما." | "Pas de souci, j'arrive là en route, je serai là dans dix minutes." | Colloquial time & reassurance | **UNTESTED** |
| 3 | Darija -> French | "هادي بزاف غالية، ما تقدرش تنقصلنا شوية؟" | "C'est trop cher, vous ne pouvez pas nous faire un petit prix ?" | Market bargaining intent | **UNTESTED** |
| 4 | Darija -> French | "الريزو راهو مقطع هنا، ما سمعتكش مليح." | "Le réseau coupe ici, je ne t'ai pas bien entendu." | Code-switch ("الريزو") | **UNTESTED** |
| 5 | Darija -> English | "يعطيك الصحة، الماكلة كانت هايلة بزاف." | "Thank you, the food was really delicious." | Idiom "يعطيك الصحة" (not literal) | **UNTESTED** |
| 6 | Darija -> English | "واش حوالك؟ كلش لاباس فـ الدار؟" | "How are you doing? Everything good at home?" | Maghrebi greeting idiom | **UNTESTED** |
| 7 | Darija -> English | "راني مقلق شوية، الطيارة تقلع على الربعة ونص." | "I'm a bit in a rush, the flight leaves at 4:30." | Urgency prosody + time ("الربعة ونص") | **UNTESTED** |
| 8 | Darija -> English | "علاش راك تزعّف؟ ما قصدتش والو!" | "Why are you getting upset? I didn't mean anything by it!" | Emotional nuance / defensive tone | **UNTESTED** |
| 9 | French -> Algerian AR | "Excusez-moi, est-ce que cette place est prise ?" | "سمحلي، هل هاد البلاصة محجوزة؟ / هل هذا المقعد مشغول؟" | Polite inquiry, natural spoken register | **UNTESTED** |
| 10 | French -> Algerian AR | "Mon téléphone n'a presque plus de batterie, je peux charger ici ?" | "تيليفوني قريب يطفى (ما فيهش شارج)، نقدر نشارجي هنا؟" | Everyday natural phrasing | **UNTESTED** |
| 11 | French -> Algerian AR | "On se retrouve devant la pharmacie à dix-neuf heures pile." | "نتلاقاو قدام الفرماسيان على السبعة قدقد تاع العشية." | Time conversion (`19h`) | **UNTESTED** |
| 12 | French -> Algerian AR | "Franchement, c'est dommage qu'on n'ait pas pu visiter la Casbah." | "بصراحة خسارة ما قدرناش نزورو القصبة." | Cultural proper noun ("Casbah") | **UNTESTED** |
| 13 | English -> French | "Could you break a fifty? I only have large bills." | "Pourriez-vous me faire la monnaie sur un billet de cinquante ?" | Slang/idiom ("break a fifty") | **UNTESTED** |
| 14 | English -> French | "Don't sweat it, we'll figure it out once we get to the hotel." | "Ne t'en fais pas, on verra ça une fois arrivés à l'hôtel." | Colloquial idiom ("Don't sweat it") | **UNTESTED** |
| 15 | English -> French | "The meeting got pushed back to next Thursday at 2:15 PM." | "La réunion a été repoussée à jeudi prochain à 14h15." | Phrasal verb ("pushed back") | **UNTESTED** |
| 16 | Arabic (MSA) -> English | "أحتاج إلى وصفة طبية لهذا الدواء لأنني أعاني من حساسية." | "I need a prescription for this medication because I have allergies." | Medical accuracy | **UNTESTED** |
| 17 | Arabic (MSA) -> English | "هل يشمل السعر الضرائب ورسوم الخدمة أم يُدفعان بشكل منفصل؟" | "Does the price include taxes and service fees, or are they paid separately?" | Financial precision | **UNTESTED** |
| 18 | Arabic (MSA) -> English | "من فضلك، أين بوابة الصعود رقم اثني عشر للرحلة المتجهة إلى إسطنبول؟" | "Excuse me, where is boarding gate 12 for the flight to Istanbul?" | Number + proper noun clarity | **UNTESTED** |
| 19 | English -> Arabic | "My luggage didn't arrive on the carousel; who handles lost bags?" | "حقائبي لم تصل على السير، من المسؤول عن الأمتعة المفقودة؟" | Airport domain terms | **UNTESTED** |
| 20 | English -> Arabic | "Wait — are you saying the train already left?" | "استنى — تقصد باللي القطار ديجا مشى / هل غادر القطار بالفعل؟" | Questioning surprise cadence | **UNTESTED** |
| 21 | English -> Arabic | "Please send the invoice to billing at nova dash app dot io." | "من فضلك ابعث الفاتورة إلى billing@nova-app.io." | Spoken email spelling formatting | **UNTESTED** |
| 22 | Mixed Darija+FR -> EN | "الدوسيي راهو ناقصو الـ attestation de résidence، لازم تجيبها غدوة." | "The file is missing the proof of residence certificate; you need to bring it tomorrow." | Intra-sentence AR/FR code-switch | **UNTESTED** |
| 23 | Mixed EN+AR -> AR/EN | "We need to deploy the backend before التست تاع السيرفر." | Proper single-direction resolution OR clear preservation without confusion | Mixed-language turn classification | **UNTESTED** |
| 24 | Slang/Idiom EN -> AR | "Let's call it a day and pick this up fresh tomorrow morning." | "خلينا نوقفو هنا اليوم ونكملو بنشاط غدوة الصباح." | Idiom ("call it a day") | **UNTESTED** |
| 25 | Slang/Idiom AR -> EN | "اللي فات مات، خلينا نبداو صفحة جديدة." | "What's past is past; let's start fresh." | Proverbial equivalent | **UNTESTED** |
| 26 | Numbers/Currency | "المجموع ألفين وأربعمية وخمسين دينار جزائري، أو حوالي سبعطاش يورو." | "The total is 2,450 Algerian dinars, or about 17 euros." | Exact numeric fidelity | **UNTESTED** |
| 27 | Names & Addresses | "اسمي عبد الرحمن بلقاسم، نسكن في 14 نهج ديدوش مراد، الجزائر الوسطى." | "My name is Abderrahmane Belkacem, I live at 14 Didouche Mourad Street, Algiers Center." | Proper name + street transliteration | **UNTESTED** |
| 28 | Technical Terminology | "جرب تطفي الـ Bluetooth وتعاود تـ connect-ي غير بـ A2DP بلا HFP." | "Try turning Bluetooth off and reconnecting in A2DP mode without HFP." | Tech loanwords + acronyms | **UNTESTED** |
| 29 | Urgent Warning | "حذاري! الطوموبيل راهي جاية من اليسار!" | "Watch out! A car is coming from the left!" | Urgent intonation + short latency | **UNTESTED** |
| 30 | Anti-Hallucination Trap | *(3s cafe noise, clinking cup, sigh, breath)* | **Complete silence** (0 output text/audio) | Strict anti-hallucination rule | **UNTESTED** |
| 31 | Same-Script FR <-> EN | "Oui, je comprends." -> then "Yes, got it." (Mode A Auto) | Alternate Left (`pan -1.0`) and Right (`pan +1.0`) correctly | Same-script turn detection | **UNTESTED** |
| 32 | Rapid Barge-In | Speaker B starts talking mid-way through Speaker A translation | `interrupted` -> immediate `StereoEngine.stopAll()` + duck restore | Barge-in cancellation | **UNTESTED** |

---

## 6. Audio Engineering Findings

### [AUD-01] High — Mode B Speakerphone Acoustic Echo & Double-Translation Loop (`echoCancellation: false`)
- **File & Lines:** `lib/audio/micManager.ts:108-122`, `components/RoomClient.tsx:734-736`
- **Evidence:** `buildAudioConstraints` (`micManager.ts:111-115`) unconditionally disables browser echo cancellation, noise suppression, and auto-gain control (`echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`). While documented cleanly (`line 109`) for **Mode A** (preventing Android Chrome `MODE_IN_COMMUNICATION` HFP Mono fallback when sharing Bluetooth earbuds), **Mode B** calls `getMicManager().acquireMic()` with these exact same constraints.
- **User Impact:** Whenever two Mode B users talk without wearing headphones (using phone speakerphones), each phone's loudspeaker output (remote WebRTC voice + Gemini dubbed audio) feeds directly back into its own mic -> `VadManager` -> Gemini Live, triggering acoustic echo and infinite re-translation loops.
- **Recommended Fix:** Parameterize `acquireMic(preferredDeviceId, { voiceCallAec?: boolean })`: keep `echoCancellation: false` in Mode A for Bluetooth A2DP protection, and enable `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }` by default in Mode B (optionally disabling if user confirms wired/BT stereo earbuds).
- **Required Regression Tests:** Automated constraint unit test asserting `acquireMic(..., { voiceCallAec: true })` requests `echoCancellation: true`; Mode A continues requesting `false`.

### [AUD-02] High — Push-to-Talk Mode Still Gated by Silero VAD Thresholds (`this.isSpeaking`)
- **File & Lines:** `lib/audio/vadManager.ts:131-155`, `components/ModeAClient.tsx:290-294`, `components/RoomClient.tsx:762-766`
- **Evidence:** `VadManager.onFrameProcessed` (`vadManager.ts:135-143`) ONLY invokes `this.callbacks.onAudioFrame?.(pcm16)` when `this.isSpeaking` is `true` (after Silero v5 exceeds `positiveSpeechThreshold` `0.65..0.86` for `minSpeechMs` `220..420ms`). When `this.isSpeaking` is `false`, frames only go into `preSpeechRing`. Thus in `Push-to-Talk` mode, holding `"Hold to Speak"` (`pttActiveRef.current = true`) STILL fails to transmit whispered words, non-speech-confident dialects, or first `320ms` until Silero triggers!
- **User Impact:** Users explicitly switching to **Push-to-Talk** in noisy streets/airports (or speaking softly) experience cut-off words or zero transmission despite holding the button.
- **Recommended Fix:** Add an `onRawFrame?: (pcm16: Int16Array) => void` callback (or `bypassVadGate` flag) in `VadManager.onFrameProcessed`, so when `captureModeRef.current === "ptt" && pttActiveRef.current`, raw 16kHz PCM frames stream immediately while the user holds the PTT button, and emit `audioStreamEnd` cleanly on release.
- **Required Regression Tests:** Unit test verifying `Push-to-Talk` streams frames even when Silero probability is `0.1`.

### [AUD-03] High — Single Shared `StereoPannerNode` Causes Cross-Talk Pan Shifts on Overlapping Turns
- **File & Lines:** `lib/audio/stereoEngine.ts:74-76`, `538-555`, `362-369`
- **Evidence:** `StereoEngine` routes ALL `enqueuePcm16` sources through a single `this.liveStreamPanner` node (`lines 538-547`). Calling `this.liveStreamPanner.pan.setValueAtTime(pan, ctx.currentTime)` (`line 547`) or `setLiveStreamChannel` (`line 368`) mutates the pan parameter **at `ctx.currentTime`** for every `AudioBufferSourceNode` currently playing on `liveStreamPanner`.
- **User Impact:** If Person B's previous chunk hasn't quite finished draining on `liveStreamPanner` (`startTime <= nextStreamTime`) and Person A triggers an output chunk (or `onChannelResolved` flips from `"left"` to `"right"`), the tail of Person B's audio instantly snaps into Person A's earbud.
- **Recommended Fix:** Maintain dedicated `leftPanner` (`-1.0`), `rightPanner` (`+1.0`), and `centerPanner` (`0.0`) nodes (with independent `nextStreamTimeL/R/C` cursors!) or attach a lightweight per-turn/per-chunk panner so Left and Right audio streams remain strictly isolated.
- **Required Regression Tests:** Unit/Web Audio mock test confirming scheduling a `-1.0` chunk after a `+1.0` chunk does not modify the pan node feeding active `+1.0` sources.

### [AUD-04] Medium — Subtle Boundary Crossfade Applies Fade-Out Before Overlap Window Verification & Uses Fixed Overlap on Variable Chunks
- **File & Lines:** `lib/audio/stereoEngine.ts:496-566`
- **Evidence:** `decodePcmToFloat32` applies linear `3ms` fade-in AND `3ms` fade-out on every chunk (`lines 541-547`), and `enqueuePcm16` schedules continuous chunks `3ms` early (`this.nextStreamTime - 0.003`, `line 562`). While linear fade-out + fade-in adds cleanly to `1.0` amplitude when perfectly contiguous, slight Web Audio sample-rate clock rounding or tiny chunks (`len < 192`) can yield minor phase modulation; also `playReplayPcm16` (`lines 575-596`) creates un-buffered zero-overlap one-shot playback.
- **User Impact:** Minimal audible effect on typical `2400+` sample Gemini chunks, though slightly suboptimal compared to continuous `AudioWorklet` ring-buffer playback (notice SPEC `Section 2` envisioned an `AudioWorklet` output sink, whereas only Silero's input capture uses an `AudioWorklet`).
- **Recommended Fix:** Upgrade live output playback to an `AudioWorkletNode` stereo ring buffer (or sample-exact zero-crossing continuity tracking fading ONLY at true silence gaps), reserving `AudioBufferSourceNode` fallback for restricted contexts.
- **Required Regression Tests:** Continuity RMS amplitude test across 10 concatenated synthetic sine chunks verifying zero zero-crossing clicks and <1% amplitude ripple.

### [AUD-05] Info — Bluetooth A2DP vs HFP Hardware Behavior Verification Status
- **File & Lines:** `lib/audio/micManager.ts:28-35`, `151-233`, `components/EarbudTestModal.tsx`
- **Evidence & Scope Declaration:** Code review confirms `MicManager` matches common BT/builtin naming patterns (`BLUETOOTH_MIC_PATTERN` / `BUILTIN_MIC_PATTERN`) and prioritizes non-Bluetooth built-in microphones before falling back. However, **physical Bluetooth earbuds connected to iOS Safari and Android Chrome were NOT available in this headless Windows server audit environment**. Notably, iOS Safari (`WebKit`) frequently hides individual Bluetooth vs iPhone mic separation once an HFP profile negotiates unless carefully tested per OS release.
- **Required Physical-Device Verification:** Test `EarbudTestModal` + live Mode A session simultaneously on (a) Android Chrome + TWS Bluetooth earbuds (`USB/BT`) confirming `audioCtx.destination.channelCount === 2`, A2DP L/R isolation, and built-in mic lock; (b) iOS Safari 17/18 + AirPods confirming whether `getUserMedia` forces HFP Mono across Bluetooth.

---

## 7. Two-Phone QR Mode Findings

### [QR-01] Critical (Security + Concurrency) — See [SEC-02] on Missing Room Auth Tokens & Auto-Create Hijacking
- Summarized in Section 4 (`lib/rooms/roomStore.ts:204-225`, `app/api/rooms/[roomId]/route.ts`).

### [QR-02] High — Single-Process In-Memory `globalThis.__earbudRooms` Store Prevents Multi-Instance Scaling & Loses Rooms on Restart
- **File & Lines:** `lib/rooms/roomStore.ts:82-104`, `161-193`
- **Evidence:** Active rooms, audio buffers, WebRTC signals, and SSE subscribers reside exclusively in `globalThis.__earbudRooms` inside a single Node.js process (`lines 82-91`). On any Railway redeploy, worker crash, or horizontal scale-out (`replicas > 1`), active calls immediately lose room state (`GET` silently re-creates an empty blank room with default `"ar"`/`"en"`!). Furthermore, `pruneExpiredRooms` (`lines 93-104`) ONLY runs inside `createInternalRoom()`, AND **tombstoned `ended: true` rooms (`lines 315-333`) are never pruned by `pruneExpiredRooms` unless their `updatedAt` ages past `ROOM_TTL_MS` (2 hours)**!
- **User Impact:** Server restarts wipe active room languages and partner presence; multi-instance hosting breaks Mode B completely; memory grows during idle periods without active periodic sweeping.
- **Recommended Fix:** Back `roomStore` with Redis (`Upstash` / Railway Redis Pub/Sub) + periodic `setInterval` sweep (with faster `10m` TTL on `ended: true` rooms), enabling zero-downtime horizontal scaling.
- **Required Regression Tests:** Integration test verifying room state survives process boundary (with Redis adapter) and ended rooms purge within TTL.

### [QR-03] High — Partner Replay Audio Race (`latestPartnerMessageIdRef`) Drops or Misattributes Chunks
- **File & Lines:** `components/RoomClient.tsx:222`, `435-439`, `539-546`, `626-633`, `712-716`
- **Evidence:** When Phone B's Gemini Live session translates, `onAudioOutput` (`line 712`) queues audio every `160ms` (`line 270`), while `onTranscriptUpdate` (`line 690`) throttles/posts transcripts (`240ms`, `line 692`). On the receiving Phone A, `RoomClient` binds incoming relayed audio packets to whichever ID is currently in `latestPartnerMessageIdRef.current` (`line 542`). If the first audio packet arrives over SSE *before* the first `transcript` item, those chunks are dropped from replay (`latestPartnerMessageIdRef` points to an older message or `null`, corrupting older turns' replay audio!).
- **User Impact:** Clicking `"Play"` on a partner bubble in Mode B can replay the start of the *next* turn attached to the wrong message or fall back to robotic browser TTS.
- **Recommended Fix:** Include `turnId` directly inside the `POST /api/rooms/[roomId]/relay` `kind: "audio"` packet (`RelayedAudioPacket.turnId`) so the receiver keys `appendTurnAudioChunk("room:" + pkt.turnId, ...)` deterministically regardless of SSE/HTTP ordering.
- **Required Regression Tests:** Out-of-order SSE test where `audio(turnId=T2)` arrives before `transcript(id=T2)` still attaches replay audio accurately to `T2`.

### [QR-04] High — No TURN Server Configured for Mobile Symmetric NAT / Carrier Firewalls
- **File & Lines:** `lib/audio/webrtcCallManager.ts:18-24`
- **Evidence:** `RTC_CONFIGURATION` only includes public Google STUN servers (`stun:stun.l.google.com:19302`, `stun1.l.google.com:19302`) with no TURN/TURNS relay servers.
- **User Impact:** Two phones on symmetric cellular CGNAT (common on mobile 4G/5G carriers) or restrictive university/hotel Wi-Fi will stick on `"Connecting Call..."` forever for P2P WebRTC voice (`AI Dub` relay over HTTPS still works).
- **Recommended Fix:** Mint short-lived TURN credentials (e.g., Cloudflare Calls/TURN, metered.ca, or self-hosted `coturn` via `/api/rooms/[roomId]/turn`) and append to `iceServers` while gracefully keeping AI Dub functional if WebRTC ICE fails.
- **Required Regression Tests:** Fallback verification when ICE `iceCandidateType` only yields relay or fails cleanly after timeout with user feedback (`"Direct voice unavailable on this network; using AI Dubbing"`).

### [QR-05] Medium — QR Guest Confirmation & Race Condition on Rapid Hangup/Reconnect
- **File & Lines:** `components/RoomClient.tsx:127`, `467-475`, `1580-1650`, `lib/audio/webrtcCallManager.ts:165-177`, `314-322`
- **Evidence:**
  1. When `role === "guest"` opens `/room/[roomId]` from a phone's native camera, `joinConfirmed` starts `false` (`line 127`), showing the confirmation modal, **yet SSE already joined as `role=guest` at line 515** — setting `guestConnected = true` on Host's screen (`"Partner connected"`) before the guest actually confirms or before their audio is ready!
  2. When Host calls `stopAudioSession()`, `callManager.hangup(true)` fires async `"hangup"`, while a reconnect before previous ICE settles can leave `"connecting"` UI stale if partner rejected.
- **User Impact:** Host sees `"Partner connected"` and starts speaking before Guest finishes picking their language and tapping `"Confirm & Join"`.
- **Recommended Fix:** Delay SSE `role=guest` presence subscription until `joinConfirmed === true` (or add explicit `guestReady` / `audioActive` presence state alongside `joined`).
- **Required Regression Tests:** Host UI distinguishes `"QR Opened"` vs `"Partner Joined & Ready"`.

---

## 8. Performance and Cost Findings

### Latency & Footprint Measurements (Observed vs Estimated)

| Metric | Value | Classification | Method / Evidence |
|---|---|---|---|
| **Production Edge `GET /`** | `773 ms` (`200`, `x-nextjs-cache: HIT`, `cdg1`) | **Measured** | `Invoke-WebRequest` from local client to Railway edge |
| **Local `GET /`** | `120 ms` (`200`) | **Measured** | `Invoke-WebRequest` to `127.0.0.1:3000` |
| **Production `POST /api/session`** | `717 ms` (`200`, token minted) | **Measured** | `Invoke-WebRequest` to Railway |
| **Local `POST /api/session` + Gemini Live WS `setupComplete`** | `656 ms` (token) + `1060 ms` (WS setup) = **`1,716 ms`** | **Measured** | Node `@google/genai` handshake probe on `127.0.0.1:3000` |
| **Speech-to-First-Translated-Audio (Mode A)** | `~1,100 - 1,900 ms` after speech onset (`>=320ms` VAD `minSpeechMs` + `650ms` `redemptionMs` + `60ms` audio jitter buffer + Gemini round-trip) | **Estimated** (live human utterance timing untested) | Derived from constants `vadManager.ts:116-118`, `stereoEngine.ts:561` |
| **Speech-to-Partner-Audio (Mode B AI Dub)** | Mode A latency + `120–160 ms` relay batching (`RoomClient.tsx:270-275`) + up to `1000 ms` if polling fallback active | **Estimated** | Derived from `RoomClient.tsx:270`, `599` |
| **Mode A/B API Cost per Active Minute** | Dual-stream Mode B runs **2 concurrent Gemini Live sessions** (one per phone); VAD saves ~50–70% during silence | **Estimated** | Architectural analysis (no Google Billing usage export inspected) |

### Key Performance & Cost Findings

#### [PRF-01] High — No Session Resumption or Automatic Reconnect on `goAway` / `15m` Ephemeral Token Expiration
- **File & Lines:** `lib/ai/geminiLiveClient.ts:359-382`, `app/api/session/route.ts:42-73`, `components/ModeAClient.tsx:240-245`, `components/RoomClient.tsx:726-730`
- **Evidence:** `/api/session` sets token `expireTime` to `15` minutes (`app/api/session/route.ts:42`). Neither `/api/session` nor `geminiLiveClient.ts` enables `sessionResumption` (`genai.d.ts:12597`), nor do `ModeAClient` / `RoomClient` subscribe to `onGoAway` (`geminiLiveClient.ts:380`) or handle unexpected `onclose` (`line 367`). When Gemini disconnects after ~10–15m, `status` changes to `"disconnected"` while `isRunning` stays `true` (`ModeAClient.tsx`), silently dropping all `VadManager` PCM frames (`geminiLiveClient.ts:498`).
- **User Impact:** Long conversations silently stop translating after 10–15 minutes without an audible warning or auto-reconnect.
- **Recommended Fix:** Enable `sessionResumption: {}` (storing latest `SessionResumptionUpdate.newHandle`), handle `onGoAway` / non-manual `onclose` cleanly by minting a fresh ephemeral token and resuming with `"reconnecting"` UI feedback (`reconnecting` status already exists in `SplitTranscript`!).
- **Required Regression Tests:** Simulated WebSocket close / `goAway` triggers `status === "reconnecting"` -> transparent reconnect -> `status === "connected"`.

#### [PRF-02] Medium — `73.79 MiB` Static WASM/ONNX Assets Committed in Git & Redundant Variants Served Uncached
- **File & Lines:** `scripts/copy-vad-assets.mjs:11-21`, `lib/audio/vadManager.ts:109-124`, `public/sw.js:1-12`
- **Evidence:** Verified sizes on disk: `ort-wasm-simd-threaded.jsep.wasm` (`28.15 MB`), `ort-wasm-simd-threaded.asyncify.wasm` (`27.42 MB`), `ort-wasm-simd-threaded.wasm` (`14.16 MB`), `silero_vad_v5.onnx` (`2.22 MB`), `silero_vad_legacy.onnx` (`1.72 MB`). All 73.79 MiB are committed to Git even though `postinstall` copies them from `node_modules` AND `vadManager.ts:110` hardcodes `model: "v5"` + `numThreads: 1` (never needing `legacy.onnx` or `jsep` WebGPU builds unless requested). Meanwhile `public/sw.js` does zero caching.
- **User Impact:** Heavy first-visit mobile cellular download (`~16.4 MB` minimum WASM+ONNX per cold session if browser HTTP cache evicts) + bloated `24 MB` Railway uploads & slow Git clones.
- **Recommended Fix:** Remove generated `public/vad/*` from Git tracking (keep `.gitignore` entry + `postinstall` build step), remove unused `silero_vad_legacy.onnx`, consider disabling JSEP/asyncify fallback unless needed, and cache `/vad/*` immutably via `public/sw.js` (`CacheFirst` / versioned cache key).
- **Required Regression Tests:** Fresh `npm ci` + `npm run build` populates required v5 WASM/ONNX assets cleanly and SW caches `/vad/silero_vad_v5.onnx`.

#### [PRF-03] Medium — Cold `656ms + 1060ms` Session Startup Latency & Duplicated Mode B Relay Traffic
- **File & Lines:** `components/ModeAClient.tsx:250-307`, `components/RoomClient.tsx:732-776`, `app/api/rooms/[roomId]/relay/route.ts:62-73`
- **Evidence:**
  1. `ModeAClient` (`line 250` -> `line 301`) awaits `client.connect()` (`~1.7s`) *sequentially* before calling `getMicManager().acquireMic()` and `vad.start()`, rather than running WebSocket setup and WASM/mic initialization in parallel (`Promise.all`).
  2. In Mode B **when WebRTC Voice Call is active**, each device STILL uploads raw 24kHz uncompressed PCM16 (`384 kbps` mono -> `~512 kbps` base64 JSON POSTs every `160ms` = `~6 HTTP POST/sec` per active speaker!) to `/api/rooms/[roomId]/relay` instead of sending Gemini's translated audio over a WebRTC `RTCDataChannel` or compressed Opus/AudioTrack!
- **User Impact:** Slower session startup (`+1–2s`) and high HTTP POST frequency / mobile battery drain / Railway bandwidth cost on Mode B voice calls.
- **Recommended Fix:** Parallelize `client.connect()` and `getMicManager().acquireMic()` + Silero ONNX model preload; optionally stream Mode B translated PCM16 or Opus chunks over WebRTC `DataChannel` when P2P connected, falling back to HTTP relay only when P2P is unavailable.
- **Required Regression Tests:** Measure parallel startup improvement (`< 1.8s` total mic+WS ready); verify fallback HTTP relay continues working when WebRTC is unavailable.

#### [PRF-04] Low — `next.config.ts` `cacheComponents` & `partialPrefetching` Over Pure Client Roots
- **File & Lines:** `next.config.ts:6-7`, `app/page.tsx:1-5`, `app/mode-a/page.tsx`, `app/mode-b/page.tsx`, `app/room/[roomId]/page.tsx`
- **Evidence:** Per `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:87-145` and `next.config.ts`, `cacheComponents: true` optimizes mixed Server/Client component trees with `"use cache"`. Here, every page immediately mounts a `"use client"` component inside `<Suspense>`, giving no PPR dynamic streaming advantage while keeping experimental build constraints active.
- **Recommended Fix:** Keep clean static shell rendering on `/`, `/mode-a`, `/mode-b` or consider dropping unnecessary `cacheComponents: true` unless Server Components adopt `"use cache"` data loading cleanly.

---

## 9. UX and Product Audit

Using the preserved **NOVA warm ivory (`#F5F3ED`) + forest green (`#315F4A`) + warm sand (`#C58B62` / `#E8D8BF`)** identity (no architectural redesign needed):

#### [UX-01] Medium — `document.documentElement.dir` Remains `"ltr"` in Arabic Mode
- **File & Lines:** `app/layout.tsx:52-55`, `components/HomeClient.tsx:218`, `components/SplitTranscript.tsx:543`, `components/RoomClient.tsx:1079`
- **Evidence:** `dir="rtl"` is applied to component wrapper `<div>`s rather than `<html>`, causing browser-native scrollbars, `<select>` OS picker alignment, and system focus behaviors on mobile Chrome/Safari to remain LTR even when UI is Arabic. (Also flagged during prior Chromium QA audit.)
- **Recommended Fix:** Synchronize `document.documentElement.dir` and `.lang` inside a lightweight client hook triggered by `useNovaSettings().uiLocale`.

#### [UX-02] Medium — Changing Voice Persona or VAD Sensitivity Requires Manual Session Restart Without Clear Prompt
- **File & Lines:** `components/AudioSettingsDrawer.tsx:318-344`, `components/ModeAClient.tsx:301-306`, `components/RoomClient.tsx:771-776`
- **Evidence:** Settings Drawer notes `"Applies when starting or restarting a live session"`, so switching `Aoede` -> `Puck` or `Strict` -> `Sensitive` VAD mid-call leaves the active session unchanged unless the user manually stops and restarts audio.
- **Recommended Fix:** Show a crisp inline `"Restart Audio to Apply"` pill inside `AudioSettingsDrawer` whenever `voiceName` or `vadSensitivity` changes while `isRunning` is active.

#### [UX-03] Medium — Mode B Speakerphone vs Earbuds Echo Warning + Non-Interactive Truncation in Settings Drawer
- **File & Lines:** `components/AudioSettingsDrawer.tsx:263-290`, `components/RoomClient.tsx:1360-1435`
- **Evidence:** As noted in `[AUD-01]` and the `360x800` browser check, `AudioSettingsDrawer`'s Audio card truncates `"Left / Right Ear..."` next to `"Open Test"`, and Mode B offers no brief tip recommending **AI Dub Only** (or earbuds) when users experience speakerphone bleed.
- **Recommended Fix:** Allow text wrapping (`line-clamp-2` instead of `truncate`) on Settings card titles, and display a gentle Mode B tooltip `"Wear earbuds for Original + AI voice, or switch to AI Only on speakerphone"` until `[AUD-01]` AEC selection ships.

#### [UX-04] Low — Mode A Live Conversation Timer & End-to-End Transcript Accessibility
- **File & Lines:** `components/SplitTranscript.tsx:460-540`, `components/ModeAClient.tsx:66`
- **Evidence:** Mode B (`RoomClient.tsx:1525-1531`) displays a live `MM:SS` duration timer, whereas Mode A shows no session elapsed timer and lacks an explicit `"Share"` action alongside `"Copy"` for exporting bilingual notes (`formatTranscriptForExport` already exists in `lib/languages.ts:142-150`).
- **Recommended Fix:** Add a compact `MM:SS` timer to Mode A's center bar and a subtle native Web Share / download `.txt` option alongside Copy.

---

## 10. Prioritized Recommendations & Implementation Roadmap

| Priority | ID | Issue Summary | Target Area | Effort |
|---|---|---|---|---|
| **P0** | `[SEC-01]` | Lock down `/api/session` (origin check, signed anon session cookie via `proxy.ts`, rate-limit, `lockAdditionalFields`, allowlisted langs) | Security & Cost | Medium |
| **P0** | `[SEC-02]` / `[QR-01]` | Add cryptographic room host/guest access tokens + disable 4-char auto-create on `GET` | Security & Privacy | Medium |
| **P0** | `[AUD-01]` | Enable browser AEC/NS/AGC automatically in Mode B voice calls (keep A2DP `false` lock strictly for Mode A) | Audio Stability | Small |
| **P1** | `[AUD-02]` | Fix Push-to-Talk to stream raw PCM16 frames bypassing Silero VAD gate | Audio / UX | Small |
| **P1** | `[PRF-01]` | Wire Gemini Live `sessionResumption` + `onGoAway` / unexpected-close auto-reconnect | Reliability | Medium |
| **P1** | `[AUD-03]` | Split `StereoEngine.liveStreamPanner` into isolated Left/Right/Center panners | Mode A Stereo | Small |
| **P1** | `[QR-03]` | Attach deterministic `turnId` on relayed audio packets for accurate per-turn replay | Mode B UX | Small |
| **P1** | `[SEC-03]` / `[SEC-04]` | Add `CSP`, `HSTS`, `nosniff`, `Permissions-Policy`, `poweredByHeader: false`, and strict `/relay` Zod payload bounds | Security | Small |
| **P2** | `[TRN-01]` / `[TRN-02]` | Fix `detectLanguageSide` (`STOPWORDS`, Urdu/Turkish/Arabic digits), sync `autoDetect` live, evaluate `enableAffectiveDialog` & `proactivity` | Translation Quality | Small |
| **P2** | `[QR-02]` / `[QR-04]` | Move `roomStore` to Redis Pub/Sub + active TTL sweep + add TURN credentials for CGNAT WebRTC | Scalability & P2P | Large |
| **P2** | `[PRF-02]` / `[PRF-03]` | Un-track `public/vad/*` from Git, prune unused WASM/legacy ONNX, add SW caching + parallel `connect()` + mic warmup | Speed & Size | Medium |
| **P3** | `[UX-01]`..`[UX-04]` | Sync `html[dir="rtl"]`, settings `"Restart Audio"` chip, Settings wrap fix, Mode A timer + `.txt` share | Polish | Small |

---

### Phased Execution Roadmap (Independent Phases)

- **Phase A — Security Hardening & Token Lockdown (No UI Breaking Changes):**
  - Implement `proxy.ts` security headers (`CSP`, `HSTS`, `X-Frame-Options`, `nosniff`, `Permissions-Policy`) + signed session middleware.
  - Secure `POST /api/session` (rate limiting, origin check, language allowlist, `lockAdditionalFields`).
  - Add payload bounds/validation to `/api/rooms/[roomId]/relay` and cryptographic `hostToken`/`guestToken` enforcement across `/api/rooms/*`.
- **Phase B — Audio Engine, PTT & Long-Session Reliability:**
  - Enable `voiceCallAec: true` in Mode B (`micManager.ts`, `RoomClient.tsx`).
  - Fix Push-to-Talk raw frame bypass in `VadManager` (`onRawFrame`).
  - Split `StereoEngine` `liveStreamPanner` into isolated `leftPanner`/`rightPanner`/`centerPanner` channels.
  - Enable Gemini Live `sessionResumption` + `onGoAway` auto-reconnection.
- **Phase C — Translation Accuracy, Latency & Bundle Optimization:**
  - Upgrade `lib/languages.ts` `detectLanguageSide` + `STOPWORDS` + digit stripping, sync `settings.autoDetect` live, and evaluate `enableAffectiveDialog` & `proactivity` against the 32-case benchmark on real voices.
  - Parallelize `geminiLiveClient.connect()` + `acquireMic()`, attach `turnId` to relayed audio chunks, prune redundant WASM assets from Git, and implement `/vad/*` + app-shell caching in `public/sw.js`.
- **Phase D — Multi-Instance Persistence, TURN & UX Polish:**
  - Replace `globalThis.__earbudRooms` with Redis + add TURN relay support for cellular CGNAT.
  - Polish `html[dir="rtl"]` sync, Settings restart prompt, `360px` wrap fixes, and Mode A timer/export.

---

## Verification Boundary Statement

- **Directly Tested & Observed in This Audit:**
  - Repository inspection across `app/`, `components/`, `lib/`, `scripts/`, `package.json`, `next.config.ts`, `SPEC.md.md`, `node_modules/@google/genai/dist/genai.d.ts`, and Next.js `16.4.6` documentation under `node_modules/next/dist/docs/`.
  - Client JS bundle scan (`.next/static/**/*.js`: `0` key leaks) and `.gitignore` verification (`*.pem` and `.env*` untracked).
  - Read-only production checks on `https://nova-web-production-928bbc38.up.railway.app`: `HEAD /` (`200`, headers captured), `GET /` (`200`, `773ms`), `POST /api/session` (`200`, `717ms`, `UNAUTHED_SESSION_ALLOWED:True`).
  - Local isolated `http://127.0.0.1:3000` checks: `GET /` (`120ms`), Gemini model catalog `models.list()` verification (`models/gemini-2.5-flash-native-audio-latest` confirmed with `countTokens,bidiGenerateContent`), real WebSocket handshake latency (`TOKEN_MINT_MS: 656`, `WS_SETUP_COMPLETE_MS: 1060`), and unauthenticated Mode B room spoofing/`DELETE` (`SPOOF_HOST_TRANSCRIPT_OK:True`, `UNAUTHED_DELETE_OK:True`).
- **Untested / Requires Physical-Device & Human Verification:**
  - **All 32 translation benchmark cases** (live human Darija/French/English/Arabic audio runs).
  - **Physical Bluetooth TWS earbuds (`A2DP Stereo` vs `HFP Mono`)** on real Android Chrome and iOS Safari hardware (`EarbudTestModal`, simultaneous built-in mic lock, L/R physical isolation).
  - **Two-phone cellular NAT/CGNAT WebRTC voice call & speakerphone acoustic echo** across live LTE/5G and restrictive Wi-Fi networks.
  - **15+ minute continuous live session soak testing** and per-minute Google Cloud Billing cost measurement.
