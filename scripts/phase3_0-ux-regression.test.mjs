import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

console.log("[phase3.0-ux] 1. Verifying frozen Phase 2C prompt, model, and benchmark integrity...");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "docs/snapshots/phase2c-freeze-manifest.json"), "utf8")
);
for (const entry of manifest.frozenFiles) {
  const buf = fs.readFileSync(path.join(root, entry.path));
  const actualSha = crypto.createHash("sha256").update(buf).digest("hex");
  assert.equal(
    actualSha,
    entry.sha256,
    `Frozen Phase 2C artifact modified unexpectedly: ${entry.path}`
  );
}

console.log("[phase3.0-ux] 2. Verifying consumer UI copy has no developer jargon leaks...");
const homeSrc = fs.readFileSync(path.join(root, "components/HomeClient.tsx"), "utf8");
const splitSrc = fs.readFileSync(path.join(root, "components/SplitTranscript.tsx"), "utf8");
const roomSrc = fs.readFileSync(path.join(root, "components/RoomClient.tsx"), "utf8");
const modeBSrc = fs.readFileSync(path.join(root, "components/ModeBCreateClient.tsx"), "utf8");
const i18nSrc = fs.readFileSync(path.join(root, "lib/i18n.ts"), "utf8");

// Ensure consumer screens do not expose technical labels
for (const [label, src] of [
  ["SplitTranscript", splitSrc],
  ["RoomClient", roomSrc],
  ["ModeBCreateClient", modeBSrc],
  ["i18n", i18nSrc],
]) {
  assert.ok(!src.includes("Auto-VAD"), `${label} must not show 'Auto-VAD' to users`);
  assert.ok(!src.includes("الصوت P2P"), `${label} must not show 'P2P' to users`);
  assert.ok(!src.includes("Left (-1.0 L)"), `${label} must not expose raw '-1.0' pan float`);
  assert.ok(!src.includes("AI Live · "), `${label} must not expose raw liveStatus enum string`);
  assert.ok(!src.includes("Original (Ducked)"), `${label} must not expose internal 'Ducked' jargon`);
}

console.log("[phase3.0-ux] 3. Verifying Accessibility, RTL, Searchable Language Modal & Recovery UX...");
const modalSrc = fs.readFileSync(path.join(root, "components/nova/MoreLanguagesModal.tsx"), "utf8");
assert.ok(modalSrc.includes('type="search"'), "MoreLanguagesModal must provide searchable language input");
assert.ok(modalSrc.includes('e.key === "Escape"'), "MoreLanguagesModal must support Escape key closing");
assert.ok(splitSrc.includes('aria-live="polite"'), "SplitTranscript status must use aria-live polite");
assert.ok(roomSrc.includes('aria-live="polite"'), "RoomClient status must use aria-live polite");
assert.ok(homeSrc.includes('dir={isRtl ? "rtl" : "ltr"}'), "HomeClient must toggle RTL/LTR direction");
assert.ok(splitSrc.includes('dir={isArabicUi ? "rtl" : "ltr"}'), "SplitTranscript must toggle RTL/LTR direction");
assert.ok(roomSrc.includes('dir={isArabicUi ? "rtl" : "ltr"}'), "RoomClient must toggle RTL/LTR direction");
assert.ok(modeBSrc.includes('dir={isArabicUi ? "rtl" : "ltr"}'), "ModeBCreateClient must toggle RTL/LTR direction");

const cssSrc = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
assert.ok(cssSrc.includes(":focus-visible"), "Global CSS must provide accessible focus-visible styling");
assert.ok(cssSrc.includes("prefers-reduced-motion"), "Global CSS must honor prefers-reduced-motion");

console.log("[phase3.0-ux] ALL PHASE 3.0 STATIC UX & FREEZE INTEGRITY ASSERTIONS PASSED!");
