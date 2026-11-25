import {
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import {
  buildInterpreterSystemPrompt,
  detectLanguageSide,
} from "@/lib/languages";
import type { NovaVoiceName } from "@/lib/settingsStore";

export type LiveConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type SpeakerOverride = "auto" | "A" | "B";

export interface LiveTranscriptTurn {
  id: string;
  speaker: "A" | "B";
  sourceText: string;
  translatedText: string;
  isFinal: boolean;
  timestamp: number;
}

export interface SessionInitPayload {
  token: string;
  model: string;
  expiresAt: string;
  langA: string;
  langB: string;
  systemInstruction: string;
}

export interface GeminiLiveCallbacks {
  onStatusChange?: (status: LiveConnectionStatus, detail?: string) => void;
  onTranscriptUpdate?: (turn: LiveTranscriptTurn) => void;
  onAudioOutput?: (
    pcm16: Int16Array,
    sampleRate: number,
    channel: "left" | "right",
    turnId?: string
  ) => void;
  onChannelResolved?: (channel: "left" | "right") => void;
  onDebugNotice?: (notice: string) => void;
  onInterrupted?: () => void;
  onGoAway?: (timeLeft?: string) => void;
  onError?: (message: string) => void;
}

export interface GeminiLiveOptions {
  langACode: string;
  langALabel: string;
  langBCode: string;
  langBLabel: string;
  voiceName?: NovaVoiceName;
  speakerOverride?: SpeakerOverride;
  swapChannels?: boolean;
  callbacks?: GeminiLiveCallbacks;
}

const NOISE_TAG_PATTERN =
  /<\/?(?:noise|silence|inaudible|music|applause|laughter|crosstalk|cough|breath(?:ing)?)[^>]*>|\[(?:noise|silence|inaudible|music|laughter|cough)\]|\((?:noise|silence|inaudible)\)/gi;

export function sanitizeTranscriptText(text: string): string {
  return text.replace(NOISE_TAG_PATTERN, " ").replace(/\s+/g, " ").trim();
}

export function hasSpeakableText(text: string): boolean {
  const cleaned = sanitizeTranscriptText(text);
  return /[\p{L}\p{N}]/u.test(cleaned);
}

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function decodeInlineAudioToInt16(
  data: string | Uint8Array | ArrayBuffer
): Int16Array {
  let bytes: Uint8Array;
  if (typeof data === "string") {
    let normalized = data
      .replace(/\s+/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const pad = normalized.length % 4;
    if (pad > 0) {
      normalized += "=".repeat(4 - pad);
    }
    const binary = atob(normalized);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    bytes = new Uint8Array(data);
  }

  const evenSamples = Math.floor(bytes.byteLength / 2);
  if (evenSamples <= 0) return new Int16Array(0);
  const aligned = bytes.slice(0, evenSamples * 2).buffer;
  return new Int16Array(aligned);
}

function parsePcmSampleRate(mimeType?: string): number {
  if (!mimeType) return 24000;
  const match = /rate=(\d+)/i.exec(mimeType);
  return match ? Number(match[1]) : 24000;
}

/**
 * Gemini Live API WebSocket client for bidirectional speech-to-speech translation.
 * Uses short-lived ephemeral tokens from /api/session and streams incoming PCM16 audio
 * immediately to StereoEngine while dynamically updating pan when language resolves.
 */
export class GeminiLiveTranslatorClient {
  private session: Session | null = null;
  private status: LiveConnectionStatus = "idle";
  private options: Required<
    Pick<
      GeminiLiveOptions,
      | "langACode"
      | "langALabel"
      | "langBCode"
      | "langBLabel"
      | "voiceName"
      | "speakerOverride"
      | "swapChannels"
    >
  >;
  private callbacks: GeminiLiveCallbacks;

  // Per-turn state for language detection & transcript pairing
  private turnCounter = 0;
  private currentTurnId = "";
  private turnInputText = "";
  private turnOutputText = "";
  private turnHasAudio = false;
  private resolvedSpeaker: "A" | "B" | null = null;
  private lastResolvedSpeaker: "A" | "B" = "A";
  private manualDisconnect = false;

  constructor(opts: GeminiLiveOptions) {
    this.options = {
      langACode: opts.langACode,
      langALabel: opts.langALabel,
      langBCode: opts.langBCode,
      langBLabel: opts.langBLabel,
      voiceName: opts.voiceName ?? "Aoede",
      speakerOverride: opts.speakerOverride ?? "auto",
      swapChannels: opts.swapChannels ?? false,
    };
    this.callbacks = opts.callbacks ?? {};
    this.resetTurnState();
  }

  public getStatus(): LiveConnectionStatus {
    return this.status;
  }

  public setSpeakerOverride(override: SpeakerOverride): void {
    this.options.speakerOverride = override;
    if (override !== "auto") {
      this.resolvedSpeaker = override;
      this.lastResolvedSpeaker = override;
      this.callbacks.onChannelResolved?.(this.speakerToChannel(override));
    }
  }

  public setSwapChannels(swap: boolean): void {
    this.options.swapChannels = swap;
    const activeSpeaker =
      this.resolvedSpeaker ??
      (this.options.speakerOverride !== "auto"
        ? this.options.speakerOverride
        : this.lastResolvedSpeaker);
    this.callbacks.onChannelResolved?.(this.speakerToChannel(activeSpeaker));
  }

  private setStatus(status: LiveConnectionStatus, detail?: string): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status, detail);
  }

  private resetTurnState(): void {
    this.turnCounter += 1;
    this.currentTurnId = `turn-${Date.now()}-${this.turnCounter}`;
    this.turnInputText = "";
    this.turnOutputText = "";
    this.turnHasAudio = false;
    this.resolvedSpeaker = null;
  }

  private speakerToChannel(speaker: "A" | "B"): "left" | "right" {
    // Speaker A (Lang A) -> translated to Lang B -> Right (+1.0)
    // Speaker B (Lang B) -> translated to Lang A -> Left (-1.0)
    const normalChannel: "left" | "right" = speaker === "A" ? "right" : "left";
    if (!this.options.swapChannels) return normalChannel;
    return normalChannel === "right" ? "left" : "right";
  }

  private detectSpeakerFromTranscripts(): "A" | "B" | null {
    if (this.options.speakerOverride !== "auto") {
      return this.options.speakerOverride;
    }

    const cleanOutput = sanitizeTranscriptText(this.turnOutputText);
    if (hasSpeakableText(cleanOutput)) {
      const outSide = detectLanguageSide(
        cleanOutput,
        this.options.langACode,
        this.options.langBCode
      );
      if (outSide === "B") return "A";
      if (outSide === "A") return "B";
    }

    const cleanInput = sanitizeTranscriptText(this.turnInputText);
    if (hasSpeakableText(cleanInput)) {
      const inSide = detectLanguageSide(
        cleanInput,
        this.options.langACode,
        this.options.langBCode
      );
      if (inSide === "A" || inSide === "B") return inSide;
    }

    return null;
  }

  private tryClassifyTurn(): void {
    const detected = this.detectSpeakerFromTranscripts();
    if (detected && detected !== this.resolvedSpeaker) {
      this.resolvedSpeaker = detected;
      this.lastResolvedSpeaker = detected;
      this.callbacks.onChannelResolved?.(this.speakerToChannel(detected));
    }
  }

  private getEffectiveChannel(): "left" | "right" {
    const effectiveSpeaker =
      this.options.speakerOverride !== "auto"
        ? this.options.speakerOverride
        : this.resolvedSpeaker ?? this.lastResolvedSpeaker;
    return this.speakerToChannel(effectiveSpeaker);
  }

  private emitTranscript(isFinal: boolean): void {
    const cleanSource = sanitizeTranscriptText(this.turnInputText);
    const cleanTranslated = sanitizeTranscriptText(this.turnOutputText);

    // Drop <noise> / empty / punctuation-only bubbles
    if (!hasSpeakableText(cleanSource) && !hasSpeakableText(cleanTranslated)) {
      return;
    }

    const detected = this.detectSpeakerFromTranscripts();
    const speaker =
      detected ??
      this.resolvedSpeaker ??
      (this.options.speakerOverride !== "auto"
        ? this.options.speakerOverride
        : this.lastResolvedSpeaker);

    this.callbacks.onTranscriptUpdate?.({
      id: this.currentTurnId,
      speaker,
      sourceText: hasSpeakableText(cleanSource) ? cleanSource : "",
      translatedText: hasSpeakableText(cleanTranslated) ? cleanTranslated : "",
      isFinal,
      timestamp: Date.now(),
    });
  }

  public async connect(): Promise<void> {
    this.disconnect();
    this.manualDisconnect = false;
    this.resetTurnState();
    this.setStatus("connecting", "Requesting secure session token...");

    const voiceName = this.options.voiceName || "Aoede";
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        langA: this.options.langALabel,
        langB: this.options.langBLabel,
        voiceName,
      }),
    });

    const payload = (await response.json()) as Partial<SessionInitPayload> & {
      error?: string;
    };

    if (!response.ok || !payload.token || !payload.model) {
      const errMsg = payload.error || "Failed to initialize translation session.";
      this.setStatus("error", errMsg);
      this.callbacks.onError?.(errMsg);
      throw new Error(errMsg);
    }

    const ai = new GoogleGenAI({
      apiKey: payload.token,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const systemInstruction =
      payload.systemInstruction ||
      buildInterpreterSystemPrompt(
        this.options.langALabel,
        this.options.langBLabel
      );

    // @google/genai serializes config.responseModalities & temperature into setup.generationConfig
    const liveSession = await ai.live.connect({
      model: payload.model,
      config: {
        responseModalities: [Modality.AUDIO],
        temperature: 0.35,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName,
            },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        thinkingConfig: {
          thinkingBudget: 0,
        },
        contextWindowCompression: {
          triggerTokens: "12000",
          slidingWindow: { targetTokens: "4000" },
        },
        systemInstruction,
      },
      callbacks: {
        onopen: () => {
          this.setStatus("connecting", "Handshaking with Gemini Live...");
        },
        onmessage: (msg: LiveServerMessage) => {
          try {
            this.handleServerMessage(msg);
          } catch (err) {
            const detail =
              err instanceof Error ? err.message : "Failed to parse server message";
            this.callbacks.onDebugNotice?.(`Message parse error: ${detail}`);
          }
        },
        onerror: (err: ErrorEvent) => {
          const msg = err.message || "WebSocket error during live translation.";
          this.setStatus("error", msg);
          this.callbacks.onError?.(msg);
        },
        onclose: (ev: CloseEvent) => {
          if (this.manualDisconnect) {
            this.setStatus("disconnected");
            return;
          }
          const reason = ev.reason
            ? `Closed (${ev.code}): ${ev.reason}`
            : `Connection closed (${ev.code})`;
          this.setStatus("disconnected", reason);
        },
      },
    });

    this.session = liveSession;
  }

  private handleServerMessage(msg: LiveServerMessage): void {
    if (msg.setupComplete) {
      this.setStatus("connected", "Live bidirectional interpreter ready");
    }

    if (msg.goAway) {
      this.callbacks.onGoAway?.(msg.goAway.timeLeft);
    }

    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.interrupted) {
      this.callbacks.onInterrupted?.();
      this.emitTranscript(true);
      this.resetTurnState();
      return;
    }

    const inputText =
      sc.inputTranscription?.text ?? sc.interimInputTranscription?.text;
    if (inputText) {
      this.turnInputText += inputText;
      this.tryClassifyTurn();
      this.emitTranscript(false);
    }

    if (sc.outputTranscription?.text) {
      this.turnOutputText += sc.outputTranscription.text;
      this.tryClassifyTurn();
      this.emitTranscript(false);
    }

    if (sc.modelTurn?.parts && sc.modelTurn.parts.length > 0) {
      let matchedInlineAudio = false;
      const partDescriptions: string[] = [];

      for (const part of sc.modelTurn.parts) {
        const inline = part.inlineData;
        const mime = inline?.mimeType?.toLowerCase() ?? "";
        if (inline?.data) {
          if (
            !mime ||
            mime.includes("audio/pcm") ||
            mime.includes("audio/l16") ||
            mime.startsWith("audio/")
          ) {
            matchedInlineAudio = true;
            this.turnHasAudio = true;
            this.tryClassifyTurn();
            const pcm16 = decodeInlineAudioToInt16(
              inline.data as string | Uint8Array | ArrayBuffer
            );
            const sampleRate = parsePcmSampleRate(inline.mimeType);
            const channel = this.getEffectiveChannel();
            if (pcm16.length > 0) {
              this.callbacks.onAudioOutput?.(
                pcm16,
                sampleRate,
                channel,
                this.currentTurnId
              );
            } else {
              this.callbacks.onDebugNotice?.(
                `Empty PCM chunk (mime=${inline.mimeType || "none"})`
              );
            }
          } else {
            partDescriptions.push(`inline(${mime})`);
          }
        } else {
          partDescriptions.push(Object.keys(part).join("+") || "emptyPart");
        }
      }

      if (!matchedInlineAudio) {
        this.callbacks.onDebugNotice?.(
          `modelTurn had no audio inlineData (${partDescriptions.join(", ")})`
        );
      }
    }

    if (sc.turnComplete) {
      const hasSpeakableOutput = hasSpeakableText(this.turnOutputText);
      const hasSpeakableInput = hasSpeakableText(this.turnInputText);

      // If it was only noise/silence with no audio, clear turn silently
      if (!this.turnHasAudio && !hasSpeakableOutput && !hasSpeakableInput) {
        this.resetTurnState();
        return;
      }

      // Ignore intermediate empty turnComplete while user is finishing an utterance
      if (!this.turnHasAudio && !hasSpeakableOutput) {
        this.tryClassifyTurn();
        this.emitTranscript(false);
        return;
      }

      this.tryClassifyTurn();
      this.emitTranscript(true);
      this.resetTurnState();
    }
  }

  /**
   * Streams a 16kHz mono PCM16 audio chunk from Silero VAD to Gemini Live API.
   */
  public sendPcm16Frame(pcm16: Int16Array): void {
    if (!this.session || this.status !== "connected" || pcm16.length === 0) {
      return;
    }

    const base64 = int16ToBase64(pcm16);
    this.session.sendRealtimeInput({
      audio: {
        data: base64,
        mimeType: "audio/pcm;rate=16000",
      },
    });
  }

  /**
   * Signals end-of-speech pause detected by local Silero VAD for immediate translation.
   */
  public sendAudioStreamEnd(): void {
    if (!this.session || this.status !== "connected") return;
    this.session.sendRealtimeInput({ audioStreamEnd: true });
  }

  public disconnect(): void {
    this.manualDisconnect = true;
    if (this.session) {
      try {
        this.session.close();
      } catch {
        // Ignore close errors
      }
      this.session = null;
    }
    if (this.status !== "idle") {
      this.setStatus("disconnected");
    }
  }
}
