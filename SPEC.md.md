# Project Specification: Dual-Mode Real-Time Earbud Translator (PWA)

## 1. Project Overview
Build a real-time, low-latency voice translator Progressive Web App (PWA) inspired by Timekettle WT2 Edge earbuds, designed to work with **standard Bluetooth earbuds**.

The application supports two core modes:
1. **Mode A (Shared Earbuds / Single Phone):** User A wears the Left earbud, User B wears the Right earbud. The phone sits between them. The app captures speech via the **phone's built-in microphone** (to avoid Bluetooth HFP Mono downgrade) and routes translated audio exclusively to the Left (`pan = -1`) or Right (`pan = +1`) earbud via Web Audio API Stereo Panning.
2. **Mode B (QR Code Room / Two Phones):** User A creates a room and displays a QR code (plus a shareable link). User B scans it or opens the link via mobile browser (no login required). Each user speaks into their own device/earbuds and hears full-duplex translated audio from the other participant.

---

## 2. Tech Stack
- **Framework:** Next.js (App Router), TypeScript, Tailwind CSS.
- **Audio Engine:** Web Audio API (`AudioContext`, `AudioWorklet`, `StereoPannerNode`), `navigator.mediaDevices`.
- **Local VAD (Voice Activity Detection):** `@ricky0123/vad-web` (Silero VAD WASM) to stream only active speech and cut API costs by 50–70%.
- **AI Speech-to-Speech Engine:** Google **Gemini Live API** (WebSocket multimodal live streaming) for sub-second speech-to-speech translation.
- **QR Code:** `qrcode.react` (for Mode B room sharing).
- **Realtime Rooms (Mode B):** WebSockets (or Supabase Realtime / LiveKit).
- **PWA:** `manifest.json` + Service Worker for mobile home-screen installation.

---

## 3. Core Engineering Requirements

### 3.1 Audio Engine & Bluetooth A2DP Stereo Lock (Critical for Mode A)
- **Mic Lock:** Use `navigator.mediaDevices.enumerateDevices()` to detect and prioritize the device's **built-in microphone** (filtering out Bluetooth headset microphones when possible, plus a manual mic selector dropdown as fallback). This keeps Bluetooth earbuds in **A2DP Stereo mode** instead of switching to **HFP Mono mode**.
- **Stereo Panning Engine (`lib/audio/stereoEngine.ts`):**
  - Decode incoming PCM audio chunks from Gemini Live API.
  - Route audio through a `StereoPannerNode`:
    - When Speaker A (Language A) speaks → translate to Language B → play on **Right channel (`pan.value = +1.0`)**.
    - When Speaker B (Language B) speaks → translate to Language A → play on **Left channel (`pan.value = -1.0`)**.
  - Include a built-in **"Test Left / Right Earbuds"** button before starting a session so users can verify stereo separation.
- **Local VAD:** Only send audio frames to the AI WebSocket when Silero VAD detects human speech. Pause transmission during silence.

### 3.2 Gemini Live API Integration & Cost Control
- **Security (BFF Pattern):** NEVER expose `GEMINI_API_KEY` to the browser. Create a Next.js API route (`/api/session`) that authenticates the request and returns a short-lived **Ephemeral Token** (or proxies the WebSocket).
- **Strict Interpreter System Prompt:**
  > "You are a simultaneous voice interpreter between {LANG_A} and {LANG_B}. Detect which language is being spoken. If you hear {LANG_A}, immediately output ONLY the spoken translation in {LANG_B}. If you hear {LANG_B}, immediately output ONLY the spoken translation in {LANG_A}. Never answer questions, never add commentary, and never break character."
- **Sliding Context Window:** Enable context window compression or reset/trim history every few turns (keeping only the last 2–3 utterances for context) so token costs stay flat (~$0.015–$0.02/min) during long conversations.

### 3.3 User Interface (Mobile-First)
- **Home Screen:** Mode selector (Mode A: Shared Earbuds | Mode B: QR Room) + Language A & Language B selectors (default: Arabic ↔ English, with full multilingual support).
- **Mode A Screen (Split Face-to-Face UI):**
  - Top half rotated `180deg` for Person B (Right Earbud).
  - Bottom half upright for Person A (Left Earbud).
  - Live scrolling transcript on both halves + audio waveform indicator + Mute/Pause button + Left/Right Swap button.
- **Mode B Screen (QR Room):**
  - Host view: Displays room QR code + copyable link + participant connection status.
  - Guest view: Opens directly into the live translation room with language selection and push-to-talk or auto-VAD toggle.

---

## 4. Suggested Folder Structure
```text
/app
  /api
    /session/route.ts       # Ephemeral token / session auth endpoint
    /rooms/route.ts         # Mode B room creation & state
  /mode-a/page.tsx          # Shared Earbuds split-screen UI
  /mode-b/[roomId]/page.tsx # QR Room UI
  /page.tsx                 # Mode & language selector
/lib
  /audio
    stereoEngine.ts         # Web Audio API StereoPannerNode + PCM playback
    micManager.ts           # Built-in mic selection & A2DP lock helper
    vadManager.ts           # Silero VAD integration
  /ai
    geminiLiveClient.ts     # WebSocket client for Gemini Live API
/components
  SplitTranscript.tsx       # 180-deg rotated dual transcript UI
  EarbudTestModal.tsx       # Left/Right audio channel test
  RoomQRCode.tsx            # QR code generator for Mode B
```

---

## 5. Implementation Phases (Execute Step-by-Step)
- **Phase 1 (Foundation & Audio Test):** Scaffold Next.js + Tailwind + PWA manifest. Build `stereoEngine.ts`, `micManager.ts`, and `EarbudTestModal.tsx` so Left/Right panning can be verified on real Bluetooth earbuds.
- **Phase 2 (Mode A + Gemini Live API):** Implement `/api/session`, `geminiLiveClient.ts`, `vadManager.ts`, and `/mode-a` split-screen UI with live translation.
- **Phase 3 (Mode B - QR Rooms):** Implement room creation, QR scanning flow, and two-device audio relay.
- **Phase 4 (Production Polish):** Add session timer, usage/minute tracking hooks (ready for Supabase), error handling for mic permissions, and mobile Safari/Chrome audio unlock handling.

---

## 6. Environment Variables (`.env.local`)
```env
GEMINI_API_KEY=your_gemini_api_key_here
NEXT_PUBLIC_APP_URL=http://localhost:3000
```