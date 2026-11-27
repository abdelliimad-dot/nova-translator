# NOVA — Phase 1.1 Production Security Readiness Audit & Architecture Report

**Audit Scope:** Independent security & production-readiness review following Phase 1 local hardening (`NOVA_AUTH_SECRET` enforcement, secret rotation, distributed rate-limit & persistent room feasibility, replay/impersonation/header verification, and multi-instance testing).  
**Execution Scope:** **Local development only.** Zero production deployments, zero live database/Railway changes, zero committed secrets, and zero external paid services introduced.

---

## 1. Confirmed Findings & Implemented Local Hardening

### 1.1 Priority 1 — Mandatory `NOVA_AUTH_SECRET` & Safe Rotation
- **Prior Risk Identified:** `lib/security/authCrypto.ts` fell back to `crypto.randomBytes(32)` in `NODE_ENV === "production"` when `NOVA_AUTH_SECRET` was missing or short, allowing production `next start` servers to boot with mismatched per-process keys (breaking cookies across restarts/replicas). Additionally, `.env.local` currently contains only `GEMINI_API_KEY` and `NEXT_PUBLIC_APP_URL` — `NOVA_AUTH_SECRET` is not set yet.
- **Implemented Local Solution:**
  - Updated [`lib/security/authCrypto.ts`](../../lib/security/authCrypto.ts):
    - Added `MIN_AUTH_SECRET_LENGTH = 32`, `AuthConfigurationError`, weak/placeholder rejection (`isWeakSecretValue`), and `assertProductionAuthSecret()`.
    - Production runtime strictly rejects missing, `< 32`-character, or placeholder/low-entropy `NOVA_AUTH_SECRET` values — **never** falling back to static or random keys in `production` (per-process CSPRNG fallback remains strictly scoped to non-production dev/test runs).
    - Added zero-downtime key rotation via optional `NOVA_AUTH_SECRET_PREVIOUS`: all new cookies sign strictly under the active primary key (`NOVA_AUTH_SECRET`), while `verifyTokenWithRotation()` accepts active-key tokens first and falling-back-verified previous-key tokens second. [`proxy.ts`](../../proxy.ts) automatically re-issues previous-key `nova_client_sid` cookies onto the new primary key.
  - Created [`instrumentation.ts`](../../instrumentation.ts):
    - Uses Next.js 16 server `register()` hook (`NEXT_RUNTIME === "nodejs"`, skipping `PHASE_PRODUCTION_BUILD` so `next build` stays clean) to run `assertProductionAuthSecret()` at boot and terminate immediately with `process.exit(1)` if `NOVA_AUTH_SECRET` is absent or weak.
  - Updated [`proxy.ts`](../../proxy.ts) and all `/api/session` + `/api/rooms/*` routes to catch `AuthConfigurationError` and fail closed with HTTP `503` (`{ error: "Server security configuration error." }`, `Cache-Control: no-store`) without exposing environment internals.
  - **Secret Rotation Runbook:**
    1. Generate a new `32+`-byte random secret (`openssl rand -hex 32`).
    2. Move the active `NOVA_AUTH_SECRET` value into `NOVA_AUTH_SECRET_PREVIOUS` and set the new value in `NOVA_AUTH_SECRET`.
    3. Restart/roll instances cleanly. Existing client sessions (`12h` TTL) and active Mode B rooms (`2h` TTL) continue authenticating cleanly while new sessions migrate automatically to the new key.
    4. Remove `NOVA_AUTH_SECRET_PREVIOUS` after `12h`.

### 1.2 Priority 4 — Independent Security Audit Fixes Applied Locally
1. **`X-Forwarded-For` Spoofing Bypass Fixed (`lib/security/authCrypto.ts`):**
   - Previously `getClientIp()` took the **leftmost** `x-forwarded-for` address (`forwarded.split(",")[0]`), which a malicious client can spoof per request (`X-Forwarded-For: 1.2.3.x`) behind append-only reverse proxies.
   - Now prefers `cf-connecting-ip`, then `x-real-ip`, then the **rightmost** hop of `x-forwarded-for` added by the trusted ingress proxy, and hashes bucket keys with `hashRateLimitKey()` (HMAC-SHA256 truncated digest) so raw IP strings are never retained in rate-limiter maps.
2. **One-Time QR Invite Redemption Against Browser History Replay (`lib/rooms/roomStore.ts`):**
   - Even with `#invite=...` URL fragments scrubbed client-side via `window.history.replaceState()`, native mobile camera handoffs briefly record the initial `#invite=...` URL in device browser history prior to React hydration.
   - `joinRoomAsGuest()` now enforces single-use redemption on `inviteToken` (`room.inviteTokenConsumed = true` once claimed), rejecting subsequent replays of the QR invite URL with `403`. Existing joined guests keep access cleanly across page reloads via their signed `HttpOnly` `nova_room_auth` cookie.
3. **Distributed Brute-Force Protection on Mode B Room PINs (`lib/rooms/roomStore.ts`, `join/route.ts`):**
   - Added a per-room failed-attempt sliding window (`MAX_ROOM_FAILED_JOINS = 15` per `10m`) returning `429` + `Retry-After`, blocking distributed multi-IP PIN guessing against a single room.
4. **Transcript Entry Ownership Enforcement (`lib/rooms/roomStore.ts`, `relay/route.ts`):**
   - `relayTranscript()` previously matched existing messages solely by `item.id`. Now rejects attempts by Guest or Host to overwrite a transcript message owned by the other participant (`403 Forbidden`).

---

## 2. Confirmed Remaining Production Risks (Infrastructure-Dependent)

### 2.1 Process-Local Rate Limiting & Room Store (Not Shared Across Replicas or Restarts)
- **Repository Investigation:** `package.json` and `.env.local` currently contain **no** Redis client (`ioredis`, `@upstash/redis`), **no** Supabase client (`@supabase/supabase-js`), and **no** PostgreSQL driver (`pg`).
- **Measured Multi-Instance Evidence (`phase1_1-readiness.test.mjs`):**
  - While `nova_client_sid` cookies work seamlessly across two independent Next.js servers sharing `NOVA_AUTH_SECRET`, creating a Mode B room on Instance A (`:3201`) returns `404` on Instance B (`:3202`), and each instance maintains independent rate-limit counters.
  - Restarting a server preserves valid client session cookies (`nova_client_sid`), cleanly resets volatile rooms to `404` (no zombie recreation), and drops in-flight Mode B rooms.
- **Anonymous Cookie Caveat:** `nova_client_sid` verifies first-party issuance and binds rate-limit quotas; it is an **anonymous session identifier**, not proof of human identity. An automated actor fetching `/` cleanly without cookies can obtain new `nova_client_sid` tokens, bounded only by the IP rate-limiter until backed by shared Redis/Postgres limits (or edge WAF).

### 2.2 Static `CacheComponents` CSP Tradeoff (`next.config.ts`)
- `next.config.ts` enforces `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, and `Permissions-Policy: microphone=(self), camera=(self), geolocation=(), payment=()` while removing `X-Powered-By`.
- `script-src` retains `'unsafe-inline'` and `'wasm-unsafe-eval'`:
  - `'wasm-unsafe-eval'` is strictly required for Silero ONNX VAD WebAssembly execution (does **not** enable JS `eval`).
  - `'unsafe-inline'` is required because NOVA uses Next.js 16 `cacheComponents: true` static prerendering for `/`, `/mode-a`, and `/mode-b`. Moving to strict cryptographic nonce CSP requires dynamic per-request rendering (`await connection()`) and disables static optimization.

### 2.3 WebRTC Symmetric CGNAT Traversal
- Mode B P2P voice (`WebRtcCallManager`) currently uses public Google STUN servers (`stun:stun.l.google.com:19302`) with automatic fallback to chunked audio relay; mobile carrier symmetric CGNAT networks that block UDP P2P still lack a dedicated TURN relay (requires paid/hosted TURN credentials if P2P voice call reliability over restrictive LTE networks is desired).

---

## 3. Proposed Shared Backend Architecture & Cost Options (Requires Approval Before Provisioning)

Because NOVA relays Mode B transcripts, WebRTC signaling (`offer`, `answer`, `ice-candidate`), and fallback PCM audio chunks alongside distributed sliding-window rate limits across replicas, here are the three candidate architectures:

| Option | Distributed Rate Limit | Mode B Shared State & SSE Fan-Out | Pros & Tradeoffs | Estimated Cost |
|---|---|---|---|---|
| **Option A — Redis + Pub/Sub (Recommended)** *(Railway Redis or Upstash)* | Atomic Lua / `INCR` + `PX` expiry (< 1ms) on hashed keys | `room:<id>` JSON/Hash (`EX 7200`) + atomic Lua seat lock (`SET NX` / Lua check) + `PUBLISH room:<id>` to all Next.js replicas | Best fit for 24kHz ephemeral relay & instant cross-instance SSE fan-out; automatic TTL cleanup | **Railway Redis:** ~$0.50–$2/mo within Hobby credits ($5/mo base plan). **Upstash Free:** $0/mo (capped at 10k cmds/day — fallback PCM audio relay would quickly exhaust 10k/day if WebRTC falls back). |
| **Option B — Supabase Postgres Atomic RPC + Realtime** *(Local schema drafted in `docs/migrations/0001_phase_1_1_rate_limits_and_rooms.sql`)* | Atomic Postgres RPC `nova_consume_rate_limit` with HMAC-hashed keys (`ON CONFLICT DO UPDATE`) | `nova_rooms` + `nova_claim_guest_seat` (`SELECT ... FOR UPDATE`) + Realtime Broadcast for ephemeral audio/ICE | Zero new Railway add-on needed; reuses Supabase free tier; SQL migrations stay clean; higher DB latency (~20–60ms) so fallback audio chunks must use Realtime Broadcast instead of Postgres rows | **$0/month** on Supabase Free Tier (500 MB DB, 2M Realtime messages/mo, auto-pauses after 7 days inactivity; **$25/mo** Pro if active always-on). |
| **Option C — Single-Replica Pinned Node Container (Interim $0)** | Current hardened process-local limiter | Current hardened process-local `roomStore` | Zero new dependencies or cost; completely eliminates cross-replica split-brain **as long as Railway replicas remain `1`**; container restarts close active rooms cleanly (`404`) | **$0 additional cost** beyond existing Railway container. |

> **Local Draft Migration Created (NOT Applied):** [`docs/migrations/0001_phase_1_1_rate_limits_and_rooms.sql`](./migrations/0001_phase_1_1_rate_limits_and_rooms.sql) contains the atomic Postgres schema and RPC functions for Option B (`nova_rate_limits`, `nova_consume_rate_limit`, `nova_rooms`, `nova_claim_guest_seat`, `nova_cleanup_expired_state`) for review only. It has **not** been executed against any database.

---

## 4. Verification & Test Evidence (Ran After Final Source Edit)

| Check / Suite | Outcome | Verified Behaviors |
|---|---|---|
| `npx tsc --noEmit` | **Passed** (`exit 0`) | Zero TypeScript errors across app, proxy, instrumentation, and API routes. |
| `npm run lint` (`eslint`) | **Passed** (`exit 0`) | Zero lint errors or React hook warnings. |
| `npm run build` (`next build`) | **Passed** (`exit 0`, zero warnings) | Static + partial prerendering (`cacheComponents: true`), `Proxy`, and `Instrumentation` compiled cleanly with zero Edge runtime warnings and without runtime secrets embedded at build time. |
| `node scripts/security-regression.test.mjs` | **Passed** (`exit 0`) | Verified CSP/HSTS/`Permissions-Policy`/`X-Frame-Options` headers, `nova_client_sid` `HttpOnly` cookie, `/api/session` auth/validation/rate-limit, live Gemini `v1alpha` WebSocket `setupComplete` with locked ephemeral token, and all Mode B auth/anti-impersonation/end-room checks. |
| `node scripts/phase1_1-readiness.test.mjs` | **Passed** (`exit 0`) | 1. Missing & weak `<32`-char `NOVA_AUTH_SECRET` both cause `next start` (`NODE_ENV=production`) to fail fast with non-zero exit.<br>2. Multi-instance setup (`:3201` + `:3202`): `NOVA_AUTH_SECRET_PREVIOUS` -> `NOVA_AUTH_SECRET` zero-downtime cookie migration verified; leftmost `X-Forwarded-For` spoofing defeated.<br>3. Proven multi-instance room isolation (`404` across instances without Redis/DB).<br>4. Five concurrent `Promise.all` room joins allow strictly **1** guest (`200`) and reject **4** (`409`/`403`).<br>5. Replayed QR `inviteToken` rejected (`403`); Host transcript entry ID protected from Guest overwrite (`403`); distributed 20-IP PIN guessing triggers per-room `429`.<br>6. Restart retains signed client cookies cleanly while expired/volatile rooms return `404`. |

---

## 5. Remaining Blockers Before Production Scaling

1. **Infrastructure Decision Required:** Approve **Option A (Railway/Upstash Redis)**, **Option B (Supabase Postgres + Realtime)**, or **Option C (Pinned Single-Replica Railway)**.
2. **Production Environment Secret Required:** Generate and configure a persistent `32+` byte `NOVA_AUTH_SECRET` in Railway production environment variables before deploying; production server startup now enforces this at boot and refuses to start without it.
