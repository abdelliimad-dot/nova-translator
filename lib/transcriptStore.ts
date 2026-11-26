"use client";

import { useSyncExternalStore } from "react";
import type { LiveTranscriptTurn } from "@/lib/ai/geminiLiveClient";
import type { RoomTranscriptItem } from "@/lib/rooms/roomStore";

const MODE_A_PREFIX = "nova_modea_turns_v1:";
const MODE_B_PREFIX = "nova_room_turns_v1:";
const MAX_STORED_TURNS = 200;

const storeListeners = new Set<() => void>();
const memoryRawCache = new Map<string, string | null>();
const memoryParsedCache = new Map<string, unknown[]>();
const EMPTY_LIST: never[] = [];

function notifyStoreListeners() {
  for (const listener of storeListeners) {
    listener();
  }
}

function subscribeTranscriptStore(cb: () => void): () => void {
  storeListeners.add(cb);
  const handleStorage = (e: StorageEvent) => {
    if (
      e.key &&
      (e.key.startsWith(MODE_A_PREFIX) || e.key.startsWith(MODE_B_PREFIX))
    ) {
      cb();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    storeListeners.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

function readStoredList<T>(key: string): T[] {
  if (typeof window === "undefined") return EMPTY_LIST as T[];
  try {
    const raw = window.localStorage.getItem(key);
    const prevRaw = memoryRawCache.get(key);
    if (raw === prevRaw && memoryParsedCache.has(key)) {
      return memoryParsedCache.get(key) as T[];
    }
    memoryRawCache.set(key, raw);
    if (!raw) {
      memoryParsedCache.set(key, EMPTY_LIST);
      return EMPTY_LIST as T[];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      memoryParsedCache.set(key, EMPTY_LIST);
      return EMPTY_LIST as T[];
    }
    memoryParsedCache.set(key, parsed);
    return parsed as T[];
  } catch {
    return EMPTY_LIST as T[];
  }
}

function writeStoredList<T>(key: string, items: T[]): void {
  if (typeof window === "undefined") return;
  const trimmed = items.slice(-MAX_STORED_TURNS);
  try {
    const serialized = JSON.stringify(trimmed);
    window.localStorage.setItem(key, serialized);
    memoryRawCache.set(key, serialized);
    memoryParsedCache.set(key, trimmed);
  } catch {
    // Progressive fallback if storage quota is tight without failing the session
    for (const fallbackCap of [80, 40]) {
      try {
        const subset = trimmed.slice(-fallbackCap);
        const serialized = JSON.stringify(subset);
        window.localStorage.setItem(key, serialized);
        memoryRawCache.set(key, serialized);
        memoryParsedCache.set(key, subset);
        break;
      } catch {
        // Try smaller subset
      }
    }
  }
  notifyStoreListeners();
}

export function getModeATurnsStorageKey(langA: string, langB: string): string {
  return `${MODE_A_PREFIX}${langA}_${langB}`;
}

export function getRoomTurnsStorageKey(roomId: string): string {
  return `${MODE_B_PREFIX}${roomId.toUpperCase()}`;
}

export function usePersistedModeATurns(
  langA: string,
  langB: string
): LiveTranscriptTurn[] {
  const key = getModeATurnsStorageKey(langA, langB);
  return useSyncExternalStore(
    subscribeTranscriptStore,
    () => readStoredList<LiveTranscriptTurn>(key),
    () => EMPTY_LIST as LiveTranscriptTurn[]
  );
}

export function upsertPersistedModeATurn(
  langA: string,
  langB: string,
  turn: LiveTranscriptTurn
): void {
  const key = getModeATurnsStorageKey(langA, langB);
  const current = readStoredList<LiveTranscriptTurn>(key);
  const idx = current.findIndex((t) => t.id === turn.id);
  const next =
    idx >= 0
      ? current.map((item, i) => (i === idx ? turn : item))
      : [...current, turn];
  writeStoredList(key, next);
}

export function clearPersistedModeATurns(langA: string, langB: string): void {
  const key = getModeATurnsStorageKey(langA, langB);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore
  }
  memoryRawCache.set(key, null);
  memoryParsedCache.set(key, EMPTY_LIST);
  notifyStoreListeners();
}

export function usePersistedRoomMessages(roomId: string): RoomTranscriptItem[] {
  const key = getRoomTurnsStorageKey(roomId);
  return useSyncExternalStore(
    subscribeTranscriptStore,
    () => readStoredList<RoomTranscriptItem>(key),
    () => EMPTY_LIST as RoomTranscriptItem[]
  );
}

export function savePersistedRoomMessages(
  roomId: string,
  items: RoomTranscriptItem[]
): void {
  if (!roomId) return;
  writeStoredList(getRoomTurnsStorageKey(roomId), items);
}

export function upsertPersistedRoomMessage(
  roomId: string,
  item: RoomTranscriptItem
): void {
  if (!roomId) return;
  const key = getRoomTurnsStorageKey(roomId);
  const current = readStoredList<RoomTranscriptItem>(key);
  const idx = current.findIndex((m) => m.id === item.id);
  const next =
    idx >= 0
      ? current.map((existing, i) => (i === idx ? item : existing))
      : [...current, item];
  writeStoredList(key, next);
}

export function mergeAndSaveRoomMessages(
  roomId: string,
  serverMessages: RoomTranscriptItem[]
): void {
  if (!roomId) return;
  const key = getRoomTurnsStorageKey(roomId);
  const existing = readStoredList<RoomTranscriptItem>(key);
  if (serverMessages.length === 0 && existing.length > 0) {
    return;
  }
  const byId = new Map<string, RoomTranscriptItem>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of serverMessages) byId.set(item.id, item);
  const merged = Array.from(byId.values()).sort(
    (a, b) => a.timestamp - b.timestamp
  );
  writeStoredList(key, merged);
}

export function clearPersistedRoomMessages(roomId: string): void {
  if (!roomId) return;
  const key = getRoomTurnsStorageKey(roomId);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore
  }
  memoryRawCache.set(key, null);
  memoryParsedCache.set(key, EMPTY_LIST);
  notifyStoreListeners();
}
