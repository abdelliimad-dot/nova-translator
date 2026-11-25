"use client";

import { useSyncExternalStore } from "react";
import type { UiLocale } from "@/lib/i18n";

export type VadSensitivity = "low" | "balanced" | "high";
export type CapturePreference = "vad" | "ptt";
export type NovaVoiceName = "Aoede" | "Kore" | "Puck" | "Charon" | "Fenrir";

export interface VoicePresetMeta {
  id: NovaVoiceName;
  enLabel: string;
  arLabel: string;
}

export const NOVA_VOICE_PRESETS: readonly VoicePresetMeta[] = [
  { id: "Aoede", enLabel: "Aoede — Warm Natural (Female)", arLabel: "Aoede — دافئ وطبيعي (أنثى)" },
  { id: "Kore", enLabel: "Kore — Clear Calm (Female)", arLabel: "Kore — واضح وهادئ (أنثى)" },
  { id: "Puck", enLabel: "Puck — Friendly Natural (Male)", arLabel: "Puck — ودود وطبيعي (ذكر)" },
  { id: "Charon", enLabel: "Charon — Deep Calm (Male)", arLabel: "Charon — عميق وهادئ (ذكر)" },
  { id: "Fenrir", enLabel: "Fenrir — Expressive (Male)", arLabel: "Fenrir — معبّر وحيوي (ذكر)" },
] as const;

export interface NovaSettings {
  uiLocale: UiLocale;
  autoDetect: boolean;
  captureMode: CapturePreference;
  vadSensitivity: VadSensitivity;
  voiceName: NovaVoiceName;
  wakeLockEnabled: boolean;
  saveTranscripts: boolean;
  hapticsEnabled: boolean;
}

const DEFAULT_SETTINGS: NovaSettings = {
  uiLocale: "en",
  autoDetect: true,
  captureMode: "vad",
  vadSensitivity: "balanced",
  voiceName: "Aoede",
  wakeLockEnabled: true,
  saveTranscripts: true,
  hapticsEnabled: true,
};

const STORAGE_KEY = "nova_settings_v1";
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSnapshot: NovaSettings = DEFAULT_SETTINGS;

function notifyListeners(): void {
  for (const l of listeners) l();
}

function readSettingsSnapshot(): NovaSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedSnapshot;
    cachedRaw = raw;
    if (!raw) {
      cachedSnapshot = DEFAULT_SETTINGS;
      return cachedSnapshot;
    }
    const parsed = JSON.parse(raw) as Partial<NovaSettings>;
    cachedSnapshot = { ...DEFAULT_SETTINGS, ...parsed };
    return cachedSnapshot;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function subscribeSettings(cb: () => void): () => void {
  listeners.add(cb);
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function updateNovaSettings(patch: Partial<NovaSettings>): void {
  if (typeof window === "undefined") return;
  const next: NovaSettings = { ...readSettingsSnapshot(), ...patch };
  const serialized = JSON.stringify(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Ignore storage quota errors
  }
  cachedRaw = serialized;
  cachedSnapshot = next;
  notifyListeners();
}

export function resetNovaSettings(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
  cachedRaw = null;
  cachedSnapshot = DEFAULT_SETTINGS;
  notifyListeners();
}

export function useNovaSettings(): NovaSettings {
  return useSyncExternalStore(
    subscribeSettings,
    readSettingsSnapshot,
    () => DEFAULT_SETTINGS
  );
}

export function triggerHaptic(enabled: boolean, ms = 12): void {
  if (!enabled || typeof navigator === "undefined" || !navigator.vibrate) return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Ignore unsupported platforms
  }
}
