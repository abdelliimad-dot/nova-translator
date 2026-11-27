# NOVA — Phase 1 Security Implementation Report

**Scope:** Local development hardening addressing critical findings in `docs/NOVA_FULL_AUDIT.md` (Phase 1A: Gemini Session Security, Phase 1B: Mode B Room & Relay Authorization, Global Security Headers, and Automated Regression Verification).  
**Environment Status:** Local development only (`next build` + isolated local server verified). No production Railway deployment, database change, secret rotation, or git commit/push was performed.

---

## 1. Summary of Changes

### 1.1 Cryptographic Session & Rate-Limit Primitives (`lib/security/authCrypto.ts`)
- Implemented HMAC-SHA256 token signing and `crypto.timingSafeEqual` verification (`signToken`, `verifyToken`, `constantTimeEqual`) for:
  - `nova_client_sid`: anonymous signed `HttpOnly; SameSite=Lax` browser session token (`CLIENT_SID_TTL_MS = 12h`).
  - `nova_room_auth`: role-bound, room-scoped signed `HttpOnly; SameSite=Lax` participant credential (`ROOM_AUTH_TTL_MS = 2h`) carrying `{ roomId, role, credId, iat, exp }`.
- Uses `NOVA_AUTH_SECRET` when configured (`>= 16` chars recommended `32+` byte random string in `.env.example`); falls back cleanly to a process-local 32-byte CSPRNG key in local single-process runs.
- Implemented `createRateLimiter` (sliding-window limiter) and `readBoundedJsonBody` (strict `Content-Type: application/json` -> `415`, byte-cap enforcement -> `413`, strict JSON object parsing -> `400`).

### 1.2 Next.js 16 Anonymous Session Cookie Issuance (`proxy.ts`)
- Added Next.js 16 `proxy.ts` (`export function proxy(request: NextRequest)`) matching page navigations while excluding static/VAD/asset paths and `/api/*`.
- Issues and slides the `HttpOnly`, `SameSite=Lax` (`Secure` on HTTPS requests) `nova_client_sid` cookie automatically so first-party browser sessions authenticate cleanly without storing secrets in `localStorage` or exposing tokens to JS.

### 1.3 Phase 1A — Gemini Session Endpoint & Client (`app/api/session/route.ts`, `lib/ai/geminiLiveClient.ts`)
- Enforces valid `nova_client_sid` or `nova_room_auth` cookie (`401 Unauthorized` otherwise).
- Enforces sliding-window rate limiting per authenticated subject (`15 req / 60s`) and per client IP (`35 req / 60s`) returning `429` + `Retry-After`.
- Enforces strict `Content-Type: application/json` (`415`), max `2048`-byte body (`413`), and strict ISO/language code matching against `SUPPORTED_LANGUAGES` (`400`, rejecting free-text prompt-injection payloads or unknown codes).
- Validates `voiceName` strictly against `ALLOWED_VOICES` (`400` otherwise).
- Updated `lib/ai/geminiLiveClient.ts` to send `langACode` / `langBCode` (with `credentials: "same-origin"`) rather than free-text labels.
- Tightened Gemini Ephemeral Token constraints:
  - `uses: 1`
  - `newSessionExpireTime`: `60s`
  - `expireTime`: `10m`
  - `lockAdditionalFields`: `["tools", "safetySettings", "realtimeInputConfig", "generationConfig", "proactivity"]`
- Removed internal error strings and `GEMINI_API_KEY` env-var details from client-facing responses (`503` / `502` generic errors, `Cache-Control: no-store`).

### 1.4 Phase 1B — Mode B Room Lifecycle, Auth, & Relay (`lib/rooms/roomStore.ts`, `app/api/rooms/*`)
- **Disabled implicit room creation on `GET`:** Unknown or expired room IDs return `404`; unauthenticated `GET` returns `401`.
- **High-entropy Room IDs & Invite Credentials:** `POST /api/rooms` now creates 14-char CSPRNG readable room codes (`~69` bits), a separate 132-bit `inviteToken` (`generateRandomToken(16)`), and a 6-char readable `passcode` (`generateReadableCode(6)`).
- **Explicit Join Authentication (`POST /api/rooms/[roomId]/join`):** Validates `inviteToken` or `passcode` using `constantTimeEqual`, rate-limits brute-force attempts per IP+room (`10 req / 5m` -> `429`), prevents hijacking an already-connected active guest seat (`409 Conflict`), rotates any inactive guest credential cleanly, and mints the role-bound `HttpOnly` `nova_room_auth` (`guest`) cookie.
- **Strict Authorization Across All Room Endpoints:**
  - `GET /api/rooms/[roomId]`, `PATCH /api/rooms/[roomId]`, `DELETE /api/rooms/[roomId]`, `GET /api/rooms/[roomId]/events`, and `POST /api/rooms/[roomId]/relay` all verify `nova_room_auth` (`roomId`, signature, expiry, revocation, non-ended room).
  - Server derives participant `role` solely from the verified cookie — ignoring/blocking `?role=` query parameters and rejecting mismatched `body.role` spoofing attempts with `403`.
  - Host-only `DELETE /api/rooms/[roomId]` ends the room, broadcasts `room_ended`, revokes active credentials (`hostCredId` + `guestCredId`), clears audio/signal buffers, clears the cookie, and rejects subsequent reads/relays/SSE streams (`410 Gone`).
  - `PATCH /api/rooms/[roomId]` restricts `host` to updating `hostLang` and `guest` to updating `guestLang` using strict `SUPPORTED_LANGUAGES` codes.
  - `POST /api/rooms/[roomId]/relay` bounds payload size (`128 KB` -> `413`), rate-limits bursts (`240 req / 60s`), and validates transcript lengths (`<= 2000`), strict base64 PCM chunks (`<= 96,000` chars), and WebRTC signal kinds (`offer`, `answer`, `ice-candidate`, `call-ready`, `hangup`) + sizes (`<= 16 KB`).

### 1.5 QR Invite Fragment Privacy & Join UX (`components/RoomQRCode.tsx`, `components/QrScannerModal.tsx`, `components/ModeBCreateClient.tsx`, `components/RoomClient.tsx`)
- `RoomQRCode` embeds the secret `inviteToken` strictly in the URL fragment (`#invite=...`) — never in URL path or query parameters — so invite secrets do not traverse HTTP request lines, server logs, or `Referer` headers, and displays the Host-only 6-char `PIN` for manual joining.
- `QrScannerModal` exports `extractRoomJoinFromQr` to capture both `roomId` and `#invite=...` tokens cleanly.
- `RoomClient` reads and immediately scrubs `#invite=...` via `window.history.replaceState(...)` on mount prior to issuing network requests, renders a clean pre-auth Guest Join confirmation modal (`Confirm & Join` with one-tap QR invite verification or manual 6-char passcode entry), and limits QR display + `End Room` controls strictly to verified `host` sessions.
- `ModeBCreateClient` removes pre-auth `GET /api/rooms/[roomId]` metadata leaks and authenticates manual/QR joins directly via `POST /api/rooms/[roomId]/join`.

### 1.6 Global Security Headers (`next.config.ts`)
- Enabled `poweredByHeader: false`.
- Configured `headers()` across `/(.*)`:
  - `Content-Security-Policy`: `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` (plus `'unsafe-eval'` only in `development`), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `font-src 'self' data:`, `media-src 'self' blob:`, `worker-src 'self' blob:`, `connect-src 'self' https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com`.
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: DENY`
  - `Permissions-Policy: microphone=(self), camera=(self), geolocation=(), payment=()`

---

## 2. Verification Results (Local Only)

- `npx tsc --noEmit`: **Passed** (0 errors).
- `npm run lint` (`eslint`): **Passed** (0 errors, 0 warnings).
- `npm run build` (`next build`): **Passed** (`cacheComponents: true` + `Partial Prefetching` + `Proxy` built cleanly).
- `node scripts/security-regression.test.mjs` against isolated `next start` on `http://127.0.0.1:3199`: **Passed** (`exit 0`), verifying:
  - All security headers (`CSP`, `HSTS`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, absence of `X-Powered-By`).
  - `proxy.ts` issuance of `HttpOnly; SameSite=Lax` `nova_client_sid` cookie.
  - `/api/session` enforcement (`401` missing/tampered cookie, `405` GET, `415` non-JSON, `400` malformed JSON / prompt-injection free-text / unsupported voice, `413` oversized body, `429` + `Retry-After` rate limiting).
  - Live `/api/session` ephemeral token creation (`Cache-Control: no-store`, non-key token, `~10m` lifetime) AND live Gemini Live `v1alpha` WebSocket `setupComplete` handshake using the locked ephemeral token.
  - Mode B Room authorization (`401`/`403` unauthenticated or cross-room access, `400` short IDs, `403` wrong PIN, `200` QR `inviteToken` join without exposing host `inviteToken`/`passcode`, `409` active guest hijack block, `403` guest `DELETE`/cross-language `PATCH`/spoofed `/relay` role, `413` oversized relay payload, `429` brute-force `/join` rate limit, `410` ended-room access rejection).

---

## 3. Architectural Limitations & Production Notes

1. **Single-Process In-Memory State (Rate Limiters & Room Store):**
   - `createRateLimiter` (`lib/security/authCrypto.ts`) and `__novaRoomsStore` (`lib/rooms/roomStore.ts`) store state in Node.js process memory.
   - This is effective for local development and single-container deployments, but is **non-durable across process restarts** and **not shared across multiple horizontal replicas or serverless isolates**. Shared backing storage (e.g., Redis) is recommended in a later scaling phase if multi-instance deployment is enabled.
2. **HMAC Signing Key Configuration:**
   - Without `NOVA_AUTH_SECRET` set in environment variables, `authCrypto.ts` generates an ephemeral per-process secret on startup, invalidating existing cookies across server restarts. Set a persistent 32+ byte `NOVA_AUTH_SECRET` in production secrets when deploying later.
3. **CSP `'unsafe-inline'` Tradeoff:**
   - Because NOVA uses static prerendering with Next.js 16 `cacheComponents: true`, Next.js inline hydration/runtime scripts use `'unsafe-inline'` (`'wasm-unsafe-eval'` is also present exclusively for Silero ONNX WASM execution in browser VAD). Per-request nonce CSP would require opting pages into dynamic rendering and remains an optional hardening tradeoff for a future phase.
