import { getStereoEngine, type AudioChannel } from "@/lib/audio/stereoEngine";

interface BufferedAudioTurn {
  chunks: Int16Array[];
  sampleRate: number;
}

const MAX_CACHED_TURNS = 36;
const turnAudioMap = new Map<string, BufferedAudioTurn>();

const SPEECH_BCP47: Record<string, string> = {
  ar: "ar-SA",
  en: "en-US",
  fr: "fr-FR",
  tr: "tr-TR",
  es: "es-ES",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-PT",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-CN",
  hi: "hi-IN",
  ur: "ur-PK",
};

export function appendTurnAudioChunk(
  turnId: string,
  pcm16: Int16Array,
  sampleRate: number
): void {
  if (!turnId || pcm16.length === 0) return;
  let entry = turnAudioMap.get(turnId);
  if (!entry) {
    if (turnAudioMap.size >= MAX_CACHED_TURNS) {
      const oldestKey = turnAudioMap.keys().next().value;
      if (oldestKey) turnAudioMap.delete(oldestKey);
    }
    entry = { chunks: [], sampleRate };
    turnAudioMap.set(turnId, entry);
  }
  entry.chunks.push(new Int16Array(pcm16));
  entry.sampleRate = sampleRate;
}

export function clearTurnAudioCache(prefix?: string): void {
  if (!prefix) {
    turnAudioMap.clear();
    return;
  }
  for (const key of turnAudioMap.keys()) {
    if (key.startsWith(prefix)) {
      turnAudioMap.delete(key);
    }
  }
}

export function hasCachedTurnAudio(turnId: string): boolean {
  const entry = turnAudioMap.get(turnId);
  return Boolean(entry && entry.chunks.length > 0);
}

/**
 * Replays recorded Gemini PCM16 audio for a turn routed to the exact AudioChannel,
 * or falls back cleanly to browser Web Speech synthesis if no PCM buffer exists
 * (for example, restored turns after page reload).
 */
export function replayTurnAudio(opts: {
  turnId: string;
  text: string;
  langCode: string;
  channel: AudioChannel;
}): "pcm" | "tts" | "unavailable" {
  const entry = turnAudioMap.get(opts.turnId);
  if (entry && entry.chunks.length > 0) {
    const totalLen = entry.chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Int16Array(totalLen);
    let offset = 0;
    for (const chunk of entry.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    getStereoEngine().playReplayPcm16(merged, opts.channel, entry.sampleRate);
    return "pcm";
  }

  const trimmed = opts.text.trim();
  if (
    trimmed &&
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  ) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.lang = SPEECH_BCP47[opts.langCode] ?? opts.langCode;
      utterance.rate = 0.98;
      window.speechSynthesis.speak(utterance);
      return "tts";
    } catch {
      return "unavailable";
    }
  }

  return "unavailable";
}
