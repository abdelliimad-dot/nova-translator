# NOVA — Phase 5 Release Readiness & Pre-Audit Checklist

**Scope:** Local preparation and deployment readiness verification prior to independent final audit and physical device QA (NO deployment, DB mutations, or secret changes performed).  
**Date:** 2026-11-26

---

## 1. Environment & Configuration Validation

| Variable | Required in Prod? | Validation Behavior | Reference |
| --- | :---: | --- | --- |
| `GEMINI_API_KEY` | **Yes** | Server-side only; minted into single-use 10-min constrained ephemeral tokens via `POST /api/session`; never returned to client bundle | [app/api/session/route.ts](file:///c:/Users/iat/earbud-translator/app/api/session/route.ts#L138-L201) |
| `NOVA_AUTH_SECRET` | **Yes (Mandatory)** | `instrumentation.ts` enforces `>= 32` chars and non-placeholder entropy at `next start` startup; exits `1` if missing/weak (`503` fail-closed on routes) | [instrumentation.ts](file:///c:/Users/iat/earbud-translator/instrumentation.ts), [lib/security/authCrypto.ts](file:///c:/Users/iat/earbud-translator/lib/security/authCrypto.ts) |
| `NOVA_AUTH_SECRET_PREVIOUS` | Optional (Rotation) | Accepted cleanly for verification; `proxy.ts` automatically migrates verified cookies onto `NOVA_AUTH_SECRET` | [proxy.ts](file:///c:/Users/iat/earbud-translator/proxy.ts#L24-L40) |
| `GEMINI_LIVE_MODEL` | Optional | Defaults cleanly to `models/gemini-2.5-flash-native-audio-latest` | [app/api/session/route.ts](file:///c:/Users/iat/earbud-translator/app/api/session/route.ts#L17-L19) |
| `PORT` | Runtime (`3000` default) | Bound via `"start": "next start -p ${PORT:-3000} -H 0.0.0.0"` | [package.json](file:///c:/Users/iat/earbud-translator/package.json#L9) |

- `.env.example` verified clean with zero live keys.
- `postinstall` runs `node scripts/copy-vad-assets.mjs` so Silero VAD v5 ONNX + AudioWorklet + ORT WASM assets exist under `public/vad/`.

---

## 2. Security & Logging Verification

- **CSP & Security Headers (`next.config.ts`):** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: microphone=(self), camera=(self), geolocation=(), payment=()`, HSTS (`1 year`), `poweredByHeader: false`, strict `connect-src 'self' https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com`.
- **Logging Safety Audit:** Verified across `app/api/**`, `lib/rooms/roomStore.ts`, and `lib/security/authCrypto.ts` — logs contain only error class names or safe configuration messages; zero API keys, room PINs, invite tokens, or speech transcripts appear in server logs.
- **Room Lifecycle & Abuse Bounds (`lib/rooms/roomStore.ts`):**
  - Bounded `MAX_ROOMS = 2000`, `ROOM_TTL_MS = 2h`, `ENDED_RETENTION_MS = 5m`, `MAX_MESSAGES = 80`, `MAX_AUDIO_PACKETS = 60`, `MAX_SIGNAL_PACKETS = 40`, `MAX_TRANSCRIPT_CHARS = 2000`, `MAX_AUDIO_BASE64_CHARS = 96_000`.
  - Per-subject and per-IP sliding-window rate limits + `MAX_ROOM_FAILED_JOINS = 15` (10-min window) on PIN guesses + single-use QR invite consumption (`inviteTokenConsumed`) + URL fragment `#invite=...` scrubbing before HTTP fetches.
- **Dependency Vulnerability Scan:** `npm audit --omit=dev` -> **`0` vulnerabilities**.

---

## 3. PWA & Runtime Resource Hygiene

- `app/manifest.ts` serves standalone portrait metadata (`theme_color: "#315F4A"`, `background_color: "#F5F3ED"`).
- `public/sw.js` intentionally uses network passthrough (avoiding stale Next.js hashed chunk/HTML caching mismatches across builds).
- Client timers (`copiedTimerRef`, `replayTimerRef`, `flushTimerRef`, `pingPongTimer`, `duckRestoreTimer`), WebSocket sessions, Silero VAD AudioWorklet, MediaStream tracks, and WebRTC peer connections clean up deterministically on unmount / `End` / error stop.

---

## 4. Remaining External Prerequisites Before Production Rollout

1. **Completed Bilingual Human Review:** Native Algerian Darija / French / English reviewers must complete [PHASE_2C_HUMAN_REVIEW.md](file:///c:/Users/iat/earbud-translator/docs/reviews/PHASE_2C_HUMAN_REVIEW.md) (`#55`, `#81`, register comfort).
2. **Physical Mobile Device & Bluetooth QA:** Real iOS Safari & Android Chrome validation of Mode A dual-earbud stereo separation (`L`/`R`), Bluetooth HFP vs A2DP phone mic lock, Mode B WebRTC smart ducking, cellular TURN/NAT traversal (currently Google public STUN only), and wake-lock/background resume.
3. **Production Scaling Decision (Single-Instance vs Multi-Replica):** Current `roomStore` and rate limiters run in-memory (`Map`) and require single-instance sticky execution on Railway until a shared durable backing store (e.g., Supabase/PostgreSQL schema in [0001_phase_1_1_rate_limits_and_rooms.sql](file:///c:/Users/iat/earbud-translator/docs/migrations/0001_phase_1_1_rate_limits_and_rooms.sql) or Redis) is intentionally provisioned and audited.
4. **Independent Final Certification Audit:** Full end-to-end verification pass before committing, pushing, or updating Railway production.
