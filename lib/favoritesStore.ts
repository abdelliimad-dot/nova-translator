"use client";

import { useSyncExternalStore } from "react";

export interface SavedPhraseItem {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  modeLabel: string;
  savedAt: number;
}

const FAVORITES_STORAGE_KEY = "nova_saved_phrases_v1";
const MAX_SAVED_PHRASES = 150;
const EMPTY_SAVED: SavedPhraseItem[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedParsed: SavedPhraseItem[] = EMPTY_SAVED;

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === FAVORITES_STORAGE_KEY) cb();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function readSavedPhrases(): SavedPhraseItem[] {
  if (typeof window === "undefined") return EMPTY_SAVED;
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (raw === cachedRaw) return cachedParsed;
    cachedRaw = raw;
    if (!raw) {
      cachedParsed = EMPTY_SAVED;
      return cachedParsed;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cachedParsed = EMPTY_SAVED;
      return cachedParsed;
    }
    cachedParsed = parsed as SavedPhraseItem[];
    return cachedParsed;
  } catch {
    return EMPTY_SAVED;
  }
}

function writeSavedPhrases(items: SavedPhraseItem[]): void {
  if (typeof window === "undefined") return;
  const trimmed = items.slice(0, MAX_SAVED_PHRASES);
  try {
    const serialized = JSON.stringify(trimmed);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, serialized);
    cachedRaw = serialized;
    cachedParsed = trimmed;
  } catch {
    // Ignore quota errors cleanly
  }
  notify();
}

export function buildSavedPhraseKey(
  sourceText: string,
  translatedText: string
): string {
  return `${sourceText.trim().toLowerCase()}::${translatedText.trim().toLowerCase()}`;
}

export function useSavedPhrases(): SavedPhraseItem[] {
  return useSyncExternalStore(
    subscribe,
    readSavedPhrases,
    () => EMPTY_SAVED
  );
}

export function toggleSavedPhrase(input: {
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  modeLabel: string;
}): boolean {
  const src = input.sourceText.trim();
  const trn = input.translatedText.trim();
  if (!src && !trn) return false;

  const targetKey = buildSavedPhraseKey(src, trn);
  const current = readSavedPhrases();
  const exists = current.some(
    (item) =>
      buildSavedPhraseKey(item.sourceText, item.translatedText) === targetKey
  );

  if (exists) {
    writeSavedPhrases(
      current.filter(
        (item) =>
          buildSavedPhraseKey(item.sourceText, item.translatedText) !==
          targetKey
      )
    );
    return false;
  }

  const entry: SavedPhraseItem = {
    id: `fav-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sourceText: src,
    translatedText: trn,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    modeLabel: input.modeLabel,
    savedAt: Date.now(),
  };
  writeSavedPhrases([entry, ...current]);
  return true;
}

export function removeSavedPhrase(id: string): void {
  const current = readSavedPhrases();
  writeSavedPhrases(current.filter((item) => item.id !== id));
}

export function clearSavedPhrases(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FAVORITES_STORAGE_KEY);
  } catch {
    // Ignore
  }
  cachedRaw = null;
  cachedParsed = EMPTY_SAVED;
  notify();
}
