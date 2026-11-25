import type { MicVAD } from "@ricky0123/vad-web";
import { getMicManager, type ActiveMicInfo } from "@/lib/audio/micManager";

export interface VadCallbacks {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onVADMisfire?: () => void;
  onAudioFrame?: (pcm16: Int16Array) => void;
  onInputLevel?: (level: number, speechProb: number) => void;
  onMicAcquired?: (info: ActiveMicInfo) => void;
  onError?: (message: string) => void;
}

export interface VadStartOptions {
  stream?: MediaStream;
  preferredDeviceId?: string;
  audioContext?: AudioContext | null;
  sensitivity?: "low" | "balanced" | "high";
}

function float32ToInt16(frame: Float32Array): Int16Array {
  const pcm16 = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const clamped = Math.max(-1, Math.min(1, frame[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm16;
}

function computeFrameLevel(frame: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < frame.length; i++) {
    sumSq += frame[i] * frame[i];
  }
  return Math.min(1, Math.sqrt(sumSq / frame.length) * 4.2);
}

// Silero v5 uses 512 samples/frame @ 16kHz (32ms/frame).
// Hold ~500ms (16 frames) in the pre-speech ring so when onSpeechRealStart fires
// after minSpeechMs (320ms / 10 frames), ~200ms pre-speech + initial speech are preserved.
const PRE_SPEECH_RING_FRAMES = 16;

/**
 * Local Voice Activity Detection (Silero VAD v5 via @ricky0123/vad-web).
 * Tuned with strict thresholds (0.78 / 0.55), 320ms minSpeechMs (~10 frames),
 * and 650ms redemptionMs (~20 frames) so brief clicks/noise never reach Gemini Live
 * and mid-sentence pauses don't cut off sentences early.
 */
export class VadManager {
  private vad: MicVAD | null = null;
  private callbacks: VadCallbacks;
  private preferredDeviceId?: string;
  private preAcquiredStream: MediaStream | null = null;
  private isSpeaking = false;
  private preSpeechRing: Int16Array[] = [];
  private active = false;

  constructor(callbacks: VadCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public setPreferredDeviceId(deviceId?: string): void {
    this.preferredDeviceId = deviceId;
  }

  public isActive(): boolean {
    return this.active;
  }

  public async start(opts: VadStartOptions = {}): Promise<void> {
    if (opts.preferredDeviceId !== undefined) {
      this.preferredDeviceId = opts.preferredDeviceId;
    }
    if (opts.stream) {
      this.preAcquiredStream = opts.stream;
    }

    if (this.vad) {
      await this.vad.start();
      this.active = true;
      return;
    }

    const { MicVAD: MicVADCtor } = await import("@ricky0123/vad-web");
    const micManager = getMicManager();

    // Pre-acquire non-BT built-in mic via MicManager if caller did not pass a stream
    if (!this.preAcquiredStream) {
      const info = await micManager.acquireMic(this.preferredDeviceId);
      this.preAcquiredStream = info.stream;
      this.callbacks.onMicAcquired?.(info);
    }

    const provideExistingOrAcquireStream = async (): Promise<MediaStream> => {
      if (
        this.preAcquiredStream &&
        this.preAcquiredStream
          .getAudioTracks()
          .some((track) => track.readyState === "live")
      ) {
        return this.preAcquiredStream;
      }
      const info = await micManager.acquireMic(this.preferredDeviceId);
      this.preAcquiredStream = info.stream;
      this.callbacks.onMicAcquired?.(info);
      return info.stream;
    };

    const thresholdPreset =
      opts.sensitivity === "low"
        ? { positive: 0.86, negative: 0.65, minSpeechMs: 420 }
        : opts.sensitivity === "high"
          ? { positive: 0.65, negative: 0.45, minSpeechMs: 220 }
          : { positive: 0.78, negative: 0.55, minSpeechMs: 320 };

    try {
      this.vad = await MicVADCtor.new({
        model: "v5",
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        audioContext: opts.audioContext ?? undefined,
        positiveSpeechThreshold: thresholdPreset.positive,
        negativeSpeechThreshold: thresholdPreset.negative,
        redemptionMs: 650,
        minSpeechMs: thresholdPreset.minSpeechMs,
        preSpeechPadMs: 224,
        submitUserSpeechOnPause: false,
        startOnLoad: false,
        ortConfig: (ort) => {
          ort.env.logLevel = "error";
          ort.env.wasm.numThreads = 1;
        },
        getStream: provideExistingOrAcquireStream,
        resumeStream: provideExistingOrAcquireStream,
        pauseStream: async () => {
          this.preAcquiredStream = null;
          micManager.releaseMic();
        },
        onFrameProcessed: (probs, frame) => {
          const level = computeFrameLevel(frame);
          this.callbacks.onInputLevel?.(level, probs.isSpeech);

          const pcm16 = float32ToInt16(frame);
          if (this.isSpeaking) {
            this.callbacks.onAudioFrame?.(pcm16);
          } else {
            this.preSpeechRing.push(pcm16);
            if (this.preSpeechRing.length > PRE_SPEECH_RING_FRAMES) {
              this.preSpeechRing.shift();
            }
          }
        },
        onSpeechRealStart: () => {
          // Wait until minSpeechMs (320ms / ~10 frames) confirms real speech before streaming
          this.isSpeaking = true;
          this.callbacks.onSpeechStart?.();

          if (this.preSpeechRing.length > 0) {
            for (const buffered of this.preSpeechRing) {
              this.callbacks.onAudioFrame?.(buffered);
            }
            this.preSpeechRing = [];
          }
        },
        onSpeechEnd: () => {
          const wasSpeaking = this.isSpeaking;
          this.isSpeaking = false;
          this.preSpeechRing = [];
          if (wasSpeaking) {
            this.callbacks.onSpeechEnd?.();
          }
        },
        onVADMisfire: () => {
          this.isSpeaking = false;
          this.preSpeechRing = [];
          this.callbacks.onVADMisfire?.();
        },
      });

      await this.vad.start();
      this.active = true;
    } catch (err) {
      this.active = false;
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to initialize local Silero VAD.";
      this.callbacks.onError?.(msg);
      throw err;
    }
  }

  public async pause(): Promise<void> {
    this.isSpeaking = false;
    this.preSpeechRing = [];
    this.active = false;
    this.preAcquiredStream = null;
    if (this.vad) {
      await this.vad.pause();
    }
  }

  public async destroy(): Promise<void> {
    this.isSpeaking = false;
    this.preSpeechRing = [];
    this.active = false;
    this.preAcquiredStream = null;
    if (this.vad) {
      try {
        await this.vad.destroy();
      } catch {
        // Ignore teardown error
      }
      this.vad = null;
    }
    getMicManager().releaseMic();
  }
}
