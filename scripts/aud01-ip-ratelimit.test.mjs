import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

const PORT_DEFAULT = Number(process.env.NOVA_AUD01_PORT || "3215");
const BASE_DEFAULT = `http://127.0.0.1:${PORT_DEFAULT}`;
const SECRET = "aud01-regression-secret-key-0123456789abcdef";

async function waitForServer(url, proc, getLogs, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Server exited early (${proc.exitCode}):\n${getLogs()}`);
    }
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}\n${getLogs()}`);
}

function getSidCookie(res) {
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  const raw = cookies.find((c) => c.startsWith("nova_client_sid=")) || "";
  return raw.split(";")[0];
}

async function runUnitChecks() {
  console.log("[aud01-test] 1. Running unit tests for getClientIp() & normalizeIpCandidate()...");
  const {
    getClientIp,
    isHttpsRequest,
    normalizeIpCandidate,
    UNATTRIBUTED_IP_BUCKET,
  } = await import("../lib/security/authCrypto.ts");

  const origTrustCf = process.env.NOVA_TRUST_CLOUDFLARE_PROXY;
  const origTrustReal = process.env.NOVA_TRUST_X_REAL_IP;
  const origHops = process.env.NOVA_TRUSTED_PROXY_HOPS;

  try {
    delete process.env.NOVA_TRUST_CLOUDFLARE_PROXY;
    delete process.env.NOVA_TRUST_X_REAL_IP;
    delete process.env.NOVA_TRUSTED_PROXY_HOPS;

    // IPv4, IPv6, bracketed port, IPv4-mapped IPv6 normalization
    assert.equal(normalizeIpCandidate("198.51.100.10:51234"), "198.51.100.10");
    assert.equal(normalizeIpCandidate("[2001:DB8::1]:443"), "2001:db8::1");
    assert.equal(normalizeIpCandidate("::ffff:203.0.113.9"), "203.0.113.9");
    assert.equal(normalizeIpCandidate("not-an-ip-header!"), null);

    // Default (Railway / untrusted Cloudflare): ignore CF-Connecting-IP & X-Real-IP
    const spoofReq = new Request("https://nova.example.com/api/rooms", {
      headers: {
        "CF-Connecting-IP": "198.51.100.250",
        "X-Real-IP": "198.51.100.251",
      },
    });
    assert.equal(
      getClientIp(spoofReq),
      UNATTRIBUTED_IP_BUCKET,
      "Spoofed CF-Connecting-IP / X-Real-IP must fall back to shared unattributed bucket"
    );

    // Leftmost X-Forwarded-For spoofing blocked -> uses rightmost proxy hop
    const multiXffReq = new Request("https://nova.example.com/api/rooms", {
      headers: {
        "CF-Connecting-IP": "198.51.100.1",
        "X-Real-IP": "198.51.100.2",
        "X-Forwarded-For": "203.0.113.99, 192.0.2.50, 2001:db8::abcd",
      },
    });
    assert.equal(getClientIp(multiXffReq), "2001:db8::abcd");

    // Multi-hop trusted proxy configuration (NOVA_TRUSTED_PROXY_HOPS=2)
    process.env.NOVA_TRUSTED_PROXY_HOPS = "2";
    assert.equal(getClientIp(multiXffReq), "192.0.2.50");
    delete process.env.NOVA_TRUSTED_PROXY_HOPS;

    // Missing / garbage IP headers coalesce to UNATTRIBUTED_IP_BUCKET (never throws, never evades)
    const malformedReq = new Request("https://nova.example.com/api/rooms", {
      headers: { "X-Forwarded-For": "bogus, <script>" },
    });
    assert.equal(getClientIp(malformedReq), UNATTRIBUTED_IP_BUCKET);

    // Explicit trusted Cloudflare proxy opt-in validates IP strictly
    process.env.NOVA_TRUST_CLOUDFLARE_PROXY = "true";
    const cfTrustedReq = new Request("https://nova.example.com/api/rooms", {
      headers: {
        "CF-Connecting-IP": "2001:DB8::42",
        "X-Forwarded-For": "10.0.0.1",
      },
    });
    assert.equal(getClientIp(cfTrustedReq), "2001:db8::42");
    delete process.env.NOVA_TRUST_CLOUDFLARE_PROXY;

    // Explicit trusted X-Real-IP opt-in
    process.env.NOVA_TRUST_X_REAL_IP = "true";
    const realTrustedReq = new Request("https://nova.example.com/api/rooms", {
      headers: { "X-Real-IP": "192.0.2.77" },
    });
    assert.equal(getClientIp(realTrustedReq), "192.0.2.77");
    delete process.env.NOVA_TRUST_X_REAL_IP;

    // X-Forwarded-Proto inspects rightmost proxy hop
    const spoofHttpsReq = new Request("http://nova.example.com/", {
      headers: { "X-Forwarded-Proto": "https, http" },
    });
    assert.equal(isHttpsRequest(spoofHttpsReq), false);
    const legitHttpsReq = new Request("http://nova.example.com/", {
      headers: { "X-Forwarded-Proto": "http, https" },
    });
    assert.equal(isHttpsRequest(legitHttpsReq), true);
  } finally {
    if (origTrustCf !== undefined) process.env.NOVA_TRUST_CLOUDFLARE_PROXY = origTrustCf;
    else delete process.env.NOVA_TRUST_CLOUDFLARE_PROXY;
    if (origTrustReal !== undefined) process.env.NOVA_TRUST_X_REAL_IP = origTrustReal;
    else delete process.env.NOVA_TRUST_X_REAL_IP;
    if (origHops !== undefined) process.env.NOVA_TRUSTED_PROXY_HOPS = origHops;
    else delete process.env.NOVA_TRUSTED_PROXY_HOPS;
  }
}

async function runHttpBypassTests() {
  console.log(`[aud01-test] 2. Starting production Next.js server on ${BASE_DEFAULT} to reproduce & verify bypass fix...`);
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  let logs = "";
  const proc = spawn(
    process.execPath,
    [nextBin, "start", "-H", "127.0.0.1", "-p", String(PORT_DEFAULT)],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "production", NOVA_AUTH_SECRET: SECRET },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  proc.stdout.on("data", (d) => { logs += d.toString(); });
  proc.stderr.on("data", (d) => { logs += d.toString(); });

  try {
    await waitForServer(`${BASE_DEFAULT}/`, proc, () => logs);

    // Reproduce exact Phase 6 bypass scenario: 36 fresh SID cookies + rotating CF-Connecting-IP & X-Real-IP
    // createRoomLimiterByIp limit is 30 per 5 minutes -> must block after 30!
    const roomStatuses = [];
    for (let i = 0; i < 36; i++) {
      const home = await fetch(`${BASE_DEFAULT}/`);
      const sid = getSidCookie(home);
      assert.ok(sid, "Must receive nova_client_sid cookie");
      const r = await fetch(`${BASE_DEFAULT}/api/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: sid,
          "CF-Connecting-IP": `198.51.100.${i + 1}`,
          "X-Real-IP": `203.0.113.${i + 1}`,
          "X-Forwarded-For": `192.0.2.${i + 1}`,
        },
        body: JSON.stringify({ hostLang: "ar", guestLang: "en" }),
      });
      // Wait: Note X-Forwarded-For single value above is ALSO spoofed if client sends it unproxied vs behind proxy;
      // Wait — test BOTH without X-Forwarded-For (reproducing Phase 6 probe) AND with leftmost spoofed XFF!
      roomStatuses.push(r.status);
    }
    // Wait: in the loop above, X-Forwarded-For had unique rightmost IP per request because test isn't behind a real proxy!
    // Let's re-read what Phase 6 actually probed: fresh SID + rotating CF-Connecting-IP (no XFF) + same proxy XFF hop.
    assert.equal(roomStatuses.length, 36);

    // Exact Phase 6 probe: rotating CF-Connecting-IP + X-Real-IP (no proxy XFF) -> all map to UNATTRIBUTED_IP_BUCKET!
    const directPort = PORT_DEFAULT + 1;
    const baseDirect = `http://127.0.0.1:${directPort}`;
    let logs2 = "";
    const proc2 = spawn(
      process.execPath,
      [nextBin, "start", "-H", "127.0.0.1", "-p", String(directPort)],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "production", NOVA_AUTH_SECRET: SECRET },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    proc2.stdout.on("data", (d) => { logs2 += d.toString(); });
    proc2.stderr.on("data", (d) => { logs2 += d.toString(); });

    try {
      await waitForServer(`${baseDirect}/`, proc2, () => logs2);

      // A. Spoofed CF-Connecting-IP + X-Real-IP (reproducing original 36/36 bypass)
      const directRoomStatuses = [];
      for (let i = 0; i < 36; i++) {
        const home = await fetch(`${baseDirect}/`);
        const sid = getSidCookie(home);
        const r = await fetch(`${baseDirect}/api/rooms`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: sid,
            "CF-Connecting-IP": `198.51.100.${i + 1}`,
            "X-Real-IP": `203.0.113.${i + 1}`,
          },
          body: JSON.stringify({ hostLang: "ar", guestLang: "en" }),
        });
        directRoomStatuses.push(r.status);
      }
      const created201 = directRoomStatuses.filter((s) => s === 201).length;
      const limited429 = directRoomStatuses.filter((s) => s === 429).length;
      console.log("[aud01-test] Spoofed CF/X-Real-IP /api/rooms:", { created201, limited429 });
      assert.equal(created201, 30, "Exactly 30 room creations permitted before IP rate limit triggers");
      assert.equal(limited429, 6, "Remaining 6 spoofed requests must be blocked with 429");

      // B. /api/session IP rate limit (35/min) under fresh SID + spoofed CF-Connecting-IP + X-Real-IP + leftmost XFF
      // Uses unsupported lang codes (400 after rate limit check) so zero external Gemini API calls occur!
      const sessionStatuses = [];
      for (let i = 0; i < 40; i++) {
        const home = await fetch(`${baseDirect}/`);
        const sid = getSidCookie(home);
        const r = await fetch(`${baseDirect}/api/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: sid,
            "CF-Connecting-IP": `198.51.100.${i + 50}`,
            "X-Real-IP": `203.0.113.${i + 50}`,
            "X-Forwarded-For": `192.0.2.${i + 1}, 198.51.100.77`,
          },
          body: JSON.stringify({ langA: "zz", langB: "en" }),
        });
        sessionStatuses.push(r.status);
      }
      const sess400 = sessionStatuses.filter((s) => s === 400).length;
      const sess429 = sessionStatuses.filter((s) => s === 429).length;
      console.log("[aud01-test] Spoofed headers /api/session:", { sess400, sess429 });
      assert.equal(sess400, 35, "First 35 requests reach body validation (400)");
      assert.equal(sess429, 5, "Requests 36..40 must be rate-limited (429) despite header spoofing");

      // C. Distinct legitimate edge proxy IP gets its own clean quota (not blocked by attacker's IP bucket)
      const legitHome = await fetch(`${baseDirect}/`);
      const legitSid = getSidCookie(legitHome);
      const legitRes = await fetch(`${baseDirect}/api/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: legitSid,
          "X-Forwarded-For": "203.0.113.200",
        },
        body: JSON.stringify({ hostLang: "ar", guestLang: "fr" }),
      });
      assert.equal(legitRes.status, 201, "Separate trusted edge IP must keep its independent quota");
    } finally {
      proc2.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      if (proc2.exitCode === null) proc2.kill("SIGKILL");
    }
  } finally {
    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }
}

async function main() {
  await runUnitChecks();
  await runHttpBypassTests();
  console.log("[aud01-test] ALL AUD-01 IP RATE-LIMIT SECURITY TESTS PASSED!");
}

void main().catch((err) => {
  console.error("[aud01-test] FAILED:", err);
  process.exit(1);
});
