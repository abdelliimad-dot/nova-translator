export type AudioChannel = "left" | "right" | "both";

export interface StereoEngineDiagnostics {
  contextState: AudioContextState | "uninitialized";
  sampleRate: number;
  channelCount: number;
  maxChannelCount: number;
  activeSources: number;
}

export interface ChannelLevels {
  left: number;
  right: number;
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

export function channelToPan(channel: AudioChannel): number {
  switch (channel) {
    case "left":
      return -1.0;
    case "right":
      return 1.0;
    case "both":
      return 0.0;
  }
}

/**
 * Web Audio API Stereo Engine for Mode A (A2DP Stereo Lock) and PCM playback.
 * Routes audio exclusively to Left (-1.0), Right (+1.0), or Center (0.0)
 * using StereoPannerNode and provides real-time post-pan channel metering.
 */
export class StereoEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private leftAnalyser: AnalyserNode | null = null;
  private rightAnalyser: AnalyserNode | null = null;
  private levelBufferL: Uint8Array<ArrayBuffer> | null = null;
  private levelBufferR: Uint8Array<ArrayBuffer> | null = null;

  private activeNodes = new Set<AudioScheduledSourceNode>();
  private playbackListeners = new Set<(playing: boolean) => void>();
  private lastPlaybackActive = false;
  private pingPongTimer: ReturnType<typeof setInterval> | null = null;
  // Separate panners + scheduling cursors keep Left (-1.0) and Right (+1.0) isolated during overlaps.
  private streamPanners: Record<AudioChannel, StereoPannerNode | null> = {
    left: null,
    right: null,
    both: null,
  };
  private streamNextTime: Record<AudioChannel, number> = {
    left: 0,
    right: 0,
    both: 0,
  };
  private activeNodesByChannel: Record<AudioChannel, Set<AudioScheduledSourceNode>> = {
    left: new Set(),
    right: new Set(),
    both: new Set(),
  };

  // Remote WebRTC voice ducking branch
  private remoteVoiceStream: MediaStream | null = null;
  private remoteVoiceSource: MediaStreamAudioSourceNode | null = null;
  private remoteVoiceGain: GainNode | null = null;
  private remoteVoiceAnalyser: AnalyserNode | null = null;
  private remoteVoiceBuffer: Uint8Array<ArrayBuffer> | null = null;
  private originalVoiceEnabled = true;
  private isDucked = false;
  private duckRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Synchronously creates and resumes the AudioContext inside a user click/tap
   * BEFORE any `await` (required by mobile Chrome and iOS Safari).
   */
  public unlockSync(): AudioContext {
    if (!this.ctx) {
      const Ctor = getAudioContextConstructor();
      if (!Ctor) {
        throw new Error("Web Audio API is not supported in this browser.");
      }

      this.ctx = new Ctor({ latencyHint: "interactive" });

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.9;
      this.masterGain.channelCount = 2;
      this.masterGain.channelCountMode = "explicit";
      this.masterGain.connect(this.ctx.destination);

      this.streamPanners.left = this.createPanner(this.ctx, "left");
      this.streamPanners.right = this.createPanner(this.ctx, "right");
      this.streamPanners.both = this.createPanner(this.ctx, "both");

      // Post-pan stereo metering branch
      this.splitter = this.ctx.createChannelSplitter(2);
      this.leftAnalyser = this.ctx.createAnalyser();
      this.rightAnalyser = this.ctx.createAnalyser();
      this.leftAnalyser.fftSize = 256;
      this.rightAnalyser.fftSize = 256;
      this.levelBufferL = new Uint8Array(new ArrayBuffer(this.leftAnalyser.fftSize));
      this.levelBufferR = new Uint8Array(new ArrayBuffer(this.rightAnalyser.fftSize));

      this.masterGain.connect(this.splitter);
      this.splitter.connect(this.leftAnalyser, 0);
      this.splitter.connect(this.rightAnalyser, 1);
    }

    // Always enforce stereo 2-channel speaker output when supported
    try {
      if (this.ctx.destination.maxChannelCount >= 2) {
        this.ctx.destination.channelCount = 2;
      }
      this.ctx.destination.channelCountMode = "explicit";
      this.ctx.destination.channelInterpretation = "speakers";
    } catch {
      // Ignore if browser locks destination properties
    }

    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }

    // Play a 1-sample silent buffer synchronously to unlock mobile Safari/Chrome audio
    try {
      const silent = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = silent;
      src.connect(this.ctx.destination);
      src.start(0);
    } catch {
      // Non-fatal
    }

    return this.ctx;
  }

  /**
   * Async wrapper that unlocks synchronously first and awaits resume if needed.
   */
  public async unlock(): Promise<AudioContext> {
    const ctx = this.unlockSync();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    return ctx;
  }

  public getContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Subscribes to AudioContext state changes & document foreground returns so
   * OS interruptions (calls, backgrounding, lock screen) auto-resume cleanly.
   */
  public attachLifecycleRecovery(
    onStateChange?: (state: AudioContextState) => void
  ): () => void {
    const ctx = this.ctx;
    if (!ctx || typeof document === "undefined") {
      return () => {};
    }

    const handleState = () => {
      onStateChange?.(ctx.state);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
      }
    };

    ctx.addEventListener("statechange", handleState);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      ctx.removeEventListener("statechange", handleState);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }

  public getDiagnostics(): StereoEngineDiagnostics {
    if (!this.ctx) {
      return {
        contextState: "uninitialized",
        sampleRate: 0,
        channelCount: 0,
        maxChannelCount: 0,
        activeSources: 0,
      };
    }

    return {
      contextState: this.ctx.state,
      sampleRate: this.ctx.sampleRate,
      channelCount: this.ctx.destination.channelCount,
      maxChannelCount: this.ctx.destination.maxChannelCount,
      activeSources: this.activeNodes.size,
    };
  }

  /**
   * Returns normalized RMS output level (0..1) for Left and Right channels post-panning.
   */
  public getChannelLevels(): ChannelLevels {
    if (
      !this.leftAnalyser ||
      !this.rightAnalyser ||
      !this.levelBufferL ||
      !this.levelBufferR
    ) {
      return { left: 0, right: 0 };
    }

    return {
      left: this.computeRms(this.leftAnalyser, this.levelBufferL),
      right: this.computeRms(this.rightAnalyser, this.levelBufferR),
    };
  }

  private computeRms(
    analyser: AnalyserNode,
    buf: Uint8Array<ArrayBuffer>
  ): number {
    analyser.getByteTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const normalized = (buf[i] - 128) / 128;
      sumSq += normalized * normalized;
    }
    const rms = Math.sqrt(sumSq / buf.length);
    return Math.min(1, rms * 3.2);
  }

  private createPanner(ctx: AudioContext, channel: AudioChannel): StereoPannerNode {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(channelToPan(channel), ctx.currentTime);
    if (this.masterGain) {
      panner.connect(this.masterGain);
    } else {
      panner.connect(ctx.destination);
    }
    return panner;
  }

  /**
   * Synthesizes a distinct, click-free two-note stereo chime hard-panned to Left, Right, or Center.
   * Uses pure Web Audio oscillators routed through StereoPannerNode so channel isolation is exact.
   */
  public async playTestTone(
    channel: AudioChannel,
    options?: { durationMs?: number }
  ): Promise<void> {
    const ctx = await this.unlock();
    const panner = this.createPanner(ctx, channel);

    const totalSec = Math.max(0.35, (options?.durationMs ?? 700) / 1000);
    const now = ctx.currentTime + 0.01;

    // Distinct musical intervals so Left vs Right are immediately distinguishable
    const notes: [number, number] =
      channel === "left"
        ? [392.0, 493.88] // G4 -> B4 (warm)
        : channel === "right"
          ? [523.25, 659.25] // C5 -> E5 (bright)
          : [440.0, 554.37]; // A4 -> C#5 (center)

    const noteDuration = totalSec * 0.52;
    const stepOffset = totalSec * 0.42;

    notes.forEach((freq, idx) => {
      const start = now + idx * stepOffset;
      const stop = start + noteDuration;

      const oscPrimary = ctx.createOscillator();
      const oscHarmonic = ctx.createOscillator();
      const envGain = ctx.createGain();
      const harmonicGain = ctx.createGain();

      oscPrimary.type = "sine";
      oscPrimary.frequency.setValueAtTime(freq, start);

      oscHarmonic.type = "triangle";
      oscHarmonic.frequency.setValueAtTime(freq * 2, start);
      harmonicGain.gain.setValueAtTime(0.14, start);

      envGain.gain.setValueAtTime(0.0001, start);
      envGain.gain.exponentialRampToValueAtTime(0.45, start + 0.02);
      envGain.gain.exponentialRampToValueAtTime(0.0001, stop);

      oscPrimary.connect(envGain);
      oscHarmonic.connect(harmonicGain);
      harmonicGain.connect(envGain);
      envGain.connect(panner);

      this.trackNode(oscPrimary);
      this.trackNode(oscHarmonic);

      oscPrimary.start(start);
      oscHarmonic.start(start);
      oscPrimary.stop(stop + 0.02);
      oscHarmonic.stop(stop + 0.02);
    });

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        try {
          panner.disconnect();
        } catch {
          // Ignore
        }
        resolve();
      }, Math.ceil(totalSec * 1000) + 40);
    });
  }

  /**
   * Starts an alternating Left <-> Right ping-pong test loop for hands-free earbud verification.
   */
  public async startPingPong(
    onStep?: (channel: "left" | "right") => void,
    intervalMs = 1250
  ): Promise<void> {
    this.stopPingPong();
    await this.unlock();

    let next: "left" | "right" = "left";
    const trigger = () => {
      const current = next;
      next = current === "left" ? "right" : "left";
      onStep?.(current);
      void this.playTestTone(current, { durationMs: 650 });
    };

    trigger();
    this.pingPongTimer = setInterval(trigger, intervalMs);
  }

  public stopPingPong(): void {
    if (this.pingPongTimer) {
      clearInterval(this.pingPongTimer);
      this.pingPongTimer = null;
    }
  }

  /**
   * Plays a sample-accurate Left (440Hz, pan=-1.0) followed 600ms later by
   * Right (880Hz, pan=+1.0) beep sequence scheduled on ctx.currentTime.
   */
  public playBeepTestSequence(
    onStep?: (channel: "left" | "right") => void
  ): void {
    const ctx = this.unlockSync();
    const baseTime = ctx.currentTime + 0.02;

    const scheduleSingleBeep = (
      channel: "left" | "right",
      freqHz: number,
      startAt: number,
      durationSec = 0.28
    ) => {
      const panner = this.createPanner(ctx, channel);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freqHz, startAt);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.45, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);

      osc.connect(gain);
      gain.connect(panner);
      this.trackNode(osc, () => {
        try {
          panner.disconnect();
        } catch {
          // Ignore
        }
      });

      osc.start(startAt);
      osc.stop(startAt + durationSec + 0.02);
    };

    onStep?.("left");
    scheduleSingleBeep("left", 440, baseTime, 0.28);
    scheduleSingleBeep("right", 880, baseTime + 0.6, 0.28);
    if (onStep) {
      setTimeout(() => onStep("right"), 600);
    }
  }

  /**
   * Resolves a pan value or channel name to one of the three isolated stereo branches.
   */
  private resolveStreamBranch(panOrChannel: number | AudioChannel): AudioChannel {
    if (typeof panOrChannel === "string") return panOrChannel;
    if (panOrChannel < -0.25) return "left";
    if (panOrChannel > 0.25) return "right";
    return "both";
  }

  private getOrCreateStreamPanner(
    ctx: AudioContext,
    channel: AudioChannel
  ): StereoPannerNode {
    const existing = this.streamPanners[channel];
    if (existing) return existing;
    const created = this.createPanner(ctx, channel);
    this.streamPanners[channel] = created;
    return created;
  }

  /**
   * Adjusts active live stream branch pan dynamically without disturbing already
   * scheduled audio on the opposite ear channel.
   */
  public setLiveStreamChannel(channelOrPan: AudioChannel | number): void {
    if (!this.ctx) return;
    const branch = this.resolveStreamBranch(channelOrPan);
    const panner = this.streamPanners[branch];
    if (panner && typeof channelOrPan === "number") {
      const pan = Math.max(-1, Math.min(1, channelOrPan));
      panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.015);
    }
  }

  private static readonly VOICE_IDLE_GAIN = 0.85;
  private static readonly VOICE_DUCK_GAIN = 0.15;

  private getTargetVoiceGain(): number {
    if (!this.originalVoiceEnabled) return 0;
    return this.isDucked
      ? StereoEngine.VOICE_DUCK_GAIN
      : StereoEngine.VOICE_IDLE_GAIN;
  }

  private applyVoiceGainRamp(timeConstant = 0.06): void {
    if (!this.ctx || !this.remoteVoiceGain) return;
    const target = this.getTargetVoiceGain();
    this.remoteVoiceGain.gain.setTargetAtTime(
      target,
      this.ctx.currentTime,
      timeConstant
    );
  }

  /**
   * Attaches a remote WebRTC MediaStream to Web Audio GainNode for smooth
   * smart ducking whenever Gemini translated PCM audio plays.
   */
  public attachRemoteVoiceStream(stream: MediaStream): boolean {
    try {
      const ctx = this.unlockSync();
      if (this.remoteVoiceStream === stream && this.remoteVoiceSource) {
        this.applyVoiceGainRamp(0.05);
        return true;
      }

      this.detachRemoteVoiceStream();

      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(this.getTargetVoiceGain(), ctx.currentTime);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));

      source.connect(gain);
      gain.connect(analyser);
      if (this.masterGain) {
        gain.connect(this.masterGain);
      } else {
        gain.connect(ctx.destination);
      }

      this.remoteVoiceStream = stream;
      this.remoteVoiceSource = source;
      this.remoteVoiceGain = gain;
      this.remoteVoiceAnalyser = analyser;
      this.remoteVoiceBuffer = buf;
      return true;
    } catch {
      return false;
    }
  }

  public detachRemoteVoiceStream(): void {
    if (this.duckRestoreTimer) {
      clearTimeout(this.duckRestoreTimer);
      this.duckRestoreTimer = null;
    }
    this.isDucked = false;
    try {
      this.remoteVoiceSource?.disconnect();
      this.remoteVoiceGain?.disconnect();
      this.remoteVoiceAnalyser?.disconnect();
    } catch {
      // Ignore already disconnected nodes
    }
    this.remoteVoiceStream = null;
    this.remoteVoiceSource = null;
    this.remoteVoiceGain = null;
    this.remoteVoiceAnalyser = null;
    this.remoteVoiceBuffer = null;
  }

  public setOriginalVoiceMode(enabled: boolean): void {
    this.originalVoiceEnabled = enabled;
    this.applyVoiceGainRamp(0.05);
  }

  public isVoiceDucked(): boolean {
    return this.isDucked;
  }

  public getRemoteVoiceLevel(): number {
    if (!this.remoteVoiceAnalyser || !this.remoteVoiceBuffer) return 0;
    return this.computeRms(this.remoteVoiceAnalyser, this.remoteVoiceBuffer);
  }

  private triggerVoiceDucking(untilCtxTime: number): void {
    if (!this.ctx) return;
    if (!this.isDucked) {
      this.isDucked = true;
      this.applyVoiceGainRamp(0.04);
    }

    if (this.duckRestoreTimer) {
      clearTimeout(this.duckRestoreTimer);
    }

    const remainingMs = Math.max(
      220,
      Math.round((untilCtxTime - this.ctx.currentTime) * 1000) + 180
    );
    this.duckRestoreTimer = setTimeout(() => {
      this.duckRestoreTimer = null;
      if (this.activeNodes.size === 0) {
        this.isDucked = false;
        this.applyVoiceGainRamp(0.14);
      } else if (this.ctx) {
        const furthestEnd = Math.max(
          this.streamNextTime.left,
          this.streamNextTime.right,
          this.streamNextTime.both
        );
        const nextRemaining = Math.max(
          0.25,
          furthestEnd - this.ctx.currentTime
        );
        this.triggerVoiceDucking(this.ctx.currentTime + nextRemaining);
      }
    }, remainingMs);
  }

  private decodePcmToFloat32(
    int16: Int16Array,
    targetBuffer: Float32Array,
    sampleRate: number,
    fadeIn = true,
    fadeOut = true
  ): void {
    const len = int16.length;
    for (let i = 0; i < len; i++) {
      targetBuffer[i] = int16[i] / 32768;
    }
    const fadeSamples = Math.min(
      Math.max(1, Math.floor(sampleRate * 0.003)),
      Math.floor(len / 4)
    );
    if (fadeSamples <= 0) return;

    if (fadeIn) {
      for (let i = 0; i < fadeSamples; i++) {
        targetBuffer[i] *= i / fadeSamples;
      }
    }
    if (fadeOut) {
      for (let i = 0; i < fadeSamples; i++) {
        targetBuffer[len - 1 - i] *= i / fadeSamples;
      }
    }
  }

  /**
   * Synchronously decodes signed 16-bit little-endian mono PCM (e.g. 24kHz from Gemini Live API)
   * and schedules smooth, de-clicked gapless playback on the live stereo panner.
   */
  public enqueuePcm16(
    pcmData: ArrayBuffer | Int16Array,
    panOrOptions: number | AudioChannel | { channel: AudioChannel; sampleRate?: number },
    sampleRateArg = 24000
  ): void {
    const ctx = this.unlockSync();

    let branch: AudioChannel;
    let pan: number;
    let sampleRate = sampleRateArg;
    if (typeof panOrOptions === "number") {
      pan = Math.max(-1, Math.min(1, panOrOptions));
      branch = this.resolveStreamBranch(pan);
    } else if (typeof panOrOptions === "string") {
      branch = panOrOptions;
      pan = channelToPan(branch);
    } else {
      branch = panOrOptions.channel;
      pan = channelToPan(branch);
      sampleRate = panOrOptions.sampleRate ?? sampleRateArg;
    }

    let int16: Int16Array;
    if (pcmData instanceof Int16Array) {
      int16 = pcmData;
    } else {
      const evenSamples = Math.floor(pcmData.byteLength / 2);
      if (evenSamples <= 0) return;
      int16 = new Int16Array(pcmData, 0, evenSamples);
    }
    if (int16.length === 0) return;

    if (
      typeof sampleRate !== "number" ||
      !Number.isFinite(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 96000
    ) {
      sampleRate = 24000;
    }

    const overlapSec = 0.003;
    const branchNextTime = this.streamNextTime[branch];
    const branchActiveCount = this.activeNodesByChannel[branch].size;
    const isTurnStartOrGap =
      branchNextTime <= ctx.currentTime + 0.004 || branchActiveCount === 0;

    // Mono AudioBuffer guarantees exact Left/Right isolation via channel-dedicated StereoPannerNode
    const audioBuffer = ctx.createBuffer(1, int16.length, sampleRate);
    this.decodePcmToFloat32(
      int16,
      audioBuffer.getChannelData(0),
      sampleRate,
      true,
      true
    );

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    const panner = this.getOrCreateStreamPanner(ctx, branch);
    panner.pan.setValueAtTime(pan, ctx.currentTime);
    source.connect(panner);

    // 45ms initial jitter buffer on new bursts prevents first-chunk stutters with low latency;
    // 3ms linear overlap-add crossfades keep continuous chunks seamless and de-clicked.
    const startTime = isTurnStartOrGap
      ? ctx.currentTime + 0.045
      : Math.max(ctx.currentTime + 0.008, branchNextTime - overlapSec);
    this.streamNextTime[branch] = startTime + audioBuffer.duration;

    this.triggerVoiceDucking(this.streamNextTime[branch]);
    this.activeNodesByChannel[branch].add(source);
    this.trackNode(source, () => {
      this.activeNodesByChannel[branch].delete(source);
    });
    source.start(startTime);
  }

  /**
   * Replays a completed utterance buffer cleanly through its own StereoPannerNode
   * without disturbing live stream scheduling or panning.
   */
  public playReplayPcm16(
    pcmData: Int16Array,
    channel: AudioChannel,
    sampleRate = 24000
  ): void {
    if (pcmData.length === 0) return;
    const ctx = this.unlockSync();
    const audioBuffer = ctx.createBuffer(1, pcmData.length, sampleRate);
    this.decodePcmToFloat32(
      pcmData,
      audioBuffer.getChannelData(0),
      sampleRate,
      true,
      true
    );

    const panner = this.createPanner(ctx, channel);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(panner);
    this.trackNode(source, () => {
      try {
        panner.disconnect();
      } catch {
        // Ignore
      }
    });
    this.triggerVoiceDucking(ctx.currentTime + 0.01 + audioBuffer.duration);
    source.start(ctx.currentTime + 0.01);
  }

  private notifyPlaybackState(playing: boolean): void {
    if (this.lastPlaybackActive === playing) return;
    this.lastPlaybackActive = playing;
    for (const listener of this.playbackListeners) {
      listener(playing);
    }
  }

  public isPlaybackActive(): boolean {
    if (this.activeNodes.size > 0) return true;
    if (!this.ctx) return false;
    const furthestEnd = Math.max(
      this.streamNextTime.left,
      this.streamNextTime.right,
      this.streamNextTime.both
    );
    return furthestEnd > this.ctx.currentTime + 0.01;
  }

  public onPlaybackStateChange(listener: (playing: boolean) => void): () => void {
    this.playbackListeners.add(listener);
    return () => {
      this.playbackListeners.delete(listener);
    };
  }

  private trackNode(
    node: AudioScheduledSourceNode,
    onEndedExtra?: () => void
  ): void {
    this.activeNodes.add(node);
    this.notifyPlaybackState(true);
    node.onended = () => {
      this.activeNodes.delete(node);
      onEndedExtra?.();
      this.notifyPlaybackState(this.activeNodes.size > 0);
    };
  }

  public stopAll(): void {
    this.stopPingPong();
    for (const node of this.activeNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // Node may already be stopped
      }
    }
    this.activeNodes.clear();
    this.activeNodesByChannel.left.clear();
    this.activeNodesByChannel.right.clear();
    this.activeNodesByChannel.both.clear();
    this.streamNextTime = { left: 0, right: 0, both: 0 };
    if (this.duckRestoreTimer) {
      clearTimeout(this.duckRestoreTimer);
      this.duckRestoreTimer = null;
    }
    this.isDucked = false;
    this.applyVoiceGainRamp(0.08);
    this.notifyPlaybackState(false);
  }

  public async dispose(): Promise<void> {
    this.stopAll();
    this.detachRemoteVoiceStream();
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        // Ignore
      }
      this.ctx = null;
      this.masterGain = null;
      this.streamPanners = { left: null, right: null, both: null };
      this.splitter = null;
      this.leftAnalyser = null;
      this.rightAnalyser = null;
      this.levelBufferL = null;
      this.levelBufferR = null;
    }
  }
}

let sharedEngine: StereoEngine | null = null;

export function getStereoEngine(): StereoEngine {
  if (!sharedEngine) {
    sharedEngine = new StereoEngine();
  }
  return sharedEngine;
}
