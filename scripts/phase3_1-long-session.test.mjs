import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

console.log("[phase3.1-long] 1. Verifying Phase 2C frozen engine & audio pipeline remain unmodified...");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "docs/snapshots/phase2c-freeze-manifest.json"), "utf8")
);
for (const entry of manifest.frozenFiles) {
  const actualSha = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, entry.path)))
    .digest("hex");
  assert.equal(actualSha, entry.sha256, `Frozen artifact mutated: ${entry.path}`);
}

console.log("[phase3.1-long] 2. Testing 150-turn transcript store & QuotaExceededError fallback...");
// Provide minimal browser-like window.localStorage mock
const storageMap = new Map();
let simulateQuotaLimit = Infinity;
globalThis.window = {
  localStorage: {
    getItem(k) {
      return storageMap.has(k) ? storageMap.get(k) : null;
    },
    setItem(k, v) {
      if (v.length > simulateQuotaLimit) {
        throw new Error("QuotaExceededError");
      }
      storageMap.set(k, v);
    },
    removeItem(k) {
      storageMap.delete(k);
    },
  },
  addEventListener() {},
  removeEventListener() {},
};

const transcriptStore = await import("../lib/transcriptStore.ts");

// Push 150 Mode A turns sequentially and confirm all 150 persist (no 40-turn truncation loss)
for (let i = 1; i <= 150; i++) {
  transcriptStore.upsertPersistedModeATurn("ar", "en", {
    id: `turn-${i}`,
    speaker: i % 2 === 1 ? "A" : "B",
    sourceText: `Input turn ${i}`,
    translatedText: `Translated turn ${i}`,
    isFinal: true,
    hasAudio: true,
    timestamp: 1_700_000_000_000 + i * 1000,
  });
}
const modeAKey = transcriptStore.getModeATurnsStorageKey("ar", "en");
const stored150 = JSON.parse(storageMap.get(modeAKey));
assert.equal(stored150.length, 150, "Expected all 150 Mode A turns preserved without 40-turn silent loss");
assert.equal(stored150[0].id, "turn-1");
assert.equal(stored150[149].id, "turn-150");

// Out-of-order Mode B merge keeps chronological timestamp ordering and deduplicates identical IDs
const roomId = "PHASE3LONG";
transcriptStore.upsertPersistedRoomMessage(roomId, {
  id: "msg-late",
  sender: "guest",
  sourceText: "Second chronologically",
  translatedText: "الثاني",
  sourceLang: "en",
  targetLang: "ar",
  isFinal: true,
  timestamp: 2000,
});
transcriptStore.mergeAndSaveRoomMessages(roomId, [
  {
    id: "msg-early",
    sender: "host",
    sourceText: "أولاً",
    translatedText: "First chronologically",
    sourceLang: "ar",
    targetLang: "en",
    isFinal: true,
    timestamp: 1000,
  },
  {
    id: "msg-late",
    sender: "guest",
    sourceText: "Second updated",
    translatedText: "الثاني محدّث",
    sourceLang: "en",
    targetLang: "ar",
    isFinal: true,
    timestamp: 2000,
  },
]);
const roomKey = transcriptStore.getRoomTurnsStorageKey(roomId);
const mergedRoom = JSON.parse(storageMap.get(roomKey));
assert.equal(mergedRoom.length, 2, "Duplicate message IDs must merge cleanly");
assert.equal(mergedRoom[0].id, "msg-early", "Earliest timestamp must sort first");
assert.equal(mergedRoom[1].sourceText, "Second updated", "Updated message fields must win");

// QuotaExceeded fallback keeps latest 80 (or 40 under tighter limit) turns cleanly without throwing
simulateQuotaLimit = 30_000;
const bigTurns = [];
for (let i = 1; i <= 150; i++) {
  bigTurns.push({
    id: `room-big-${i}`,
    sender: "host",
    sourceText: `Long message payload ${i} `.repeat(3),
    translatedText: `Long translated payload ${i} `.repeat(3),
    sourceLang: "ar",
    targetLang: "en",
    isFinal: true,
    timestamp: 3000 + i,
  });
}
transcriptStore.savePersistedRoomMessages("QUOTATEST", bigTurns);
const quotaStored80 = JSON.parse(storageMap.get(transcriptStore.getRoomTurnsStorageKey("QUOTATEST")));
assert.equal(quotaStored80.length, 80, "Quota fallback must keep latest 80 turns when 80 fit");
assert.equal(quotaStored80[quotaStored80.length - 1].id, "room-big-150");

simulateQuotaLimit = 15_000;
transcriptStore.savePersistedRoomMessages("QUOTATEST40", bigTurns);
const quotaStored40 = JSON.parse(storageMap.get(transcriptStore.getRoomTurnsStorageKey("QUOTATEST40")));
assert.equal(quotaStored40.length, 40, "Tighter quota fallback must step down to latest 40 turns");
assert.equal(quotaStored40[quotaStored40.length - 1].id, "room-big-150");

console.log("[phase3.1-long] 3. Verifying Phase 3.1-3.4 component & store safeguards...");
const modeASrc = fs.readFileSync(path.join(root, "components/ModeAClient.tsx"), "utf8");
const splitSrc = fs.readFileSync(path.join(root, "components/SplitTranscript.tsx"), "utf8");
const roomSrc = fs.readFileSync(path.join(root, "components/RoomClient.tsx"), "utf8");

assert.ok(splitSrc.includes("VISIBLE_WINDOW_STEP"), "Mode A must support progressive transcript windowing");
assert.ok(splitSrc.includes("onChangeLanguagePair"), "Mode A must support live language pair changing");
assert.ok(modeASrc.includes("stopSession(true)"), "Mode A must preserve error status on connection failure");
assert.ok(roomSrc.includes("stopAudioSession(true)"), "Mode B must preserve error status on connection failure");
assert.ok(!modeASrc.includes("prev.slice(-30)"), "Mode A ephemeral mode must not silently discard >30 turns");
assert.ok(!roomSrc.includes("prev.slice(-49)"), "Mode B ephemeral mode must not silently discard >49 turns");

console.log("[phase3.1-long] ALL PHASE 3.1-3.4 LONG-SESSION & CONSISTENCY CHECKS PASSED!");
