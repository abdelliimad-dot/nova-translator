export type MicClassification = "builtin" | "bluetooth" | "external" | "unknown";

export interface ClassifiedMicDevice {
  deviceId: string;
  groupId: string;
  label: string;
  classification: MicClassification;
  isDefault: boolean;
  score: number;
}

export interface MicListResult {
  devices: ClassifiedMicDevice[];
  recommendedDeviceId: string | null;
  hasLabels: boolean;
}

export interface ActiveMicInfo {
  stream: MediaStream;
  deviceId: string;
  label: string;
  classification: MicClassification;
  sampleRate?: number;
  channelCount?: number;
  isBluetoothRisk: boolean;
}

const BLUETOOTH_MIC_PATTERN =
  /bluetooth|airpods|earpods|buds|earbud|headset|headphone|hands[- ]?free|hfp|sco|wireless|\bbt\b|wf-|wh-|jabra|bose|sony|beats|anker|soundcore|nothing ear|galaxy buds|pixel buds/i;

const BUILTIN_MIC_PATTERN =
  /built[- ]?in|internal|iphone microphone|ipad microphone|android|speakerphone|phone mic|bottom|top mic|rear mic|front mic|back mic|handset|camcorder|microphone array|realtek|macbook/i;

const EXTERNAL_MIC_PATTERN =
  /\busb\b|line[- ]?in|external|rode|shure|yeti|scarlett|focusrite|lavalier/i;

export function classifyMicDevice(
  device: MediaDeviceInfo
): ClassifiedMicDevice {
  const rawLabel = device.label?.trim() ?? "";
  const isDefault =
    device.deviceId === "default" ||
    device.deviceId === "communications" ||
    /^default\s*-/i.test(rawLabel);

  const normalizedLabel = rawLabel
    .replace(/^(default|communications)\s*-\s*/i, "")
    .trim();

  let classification: MicClassification = "unknown";
  let score = isDefault ? 0 : 10;

  if (BLUETOOTH_MIC_PATTERN.test(normalizedLabel)) {
    classification = "bluetooth";
    score = -100;
  } else if (device.deviceId === "communications") {
    classification = "unknown";
    score = -50;
  } else if (BUILTIN_MIC_PATTERN.test(normalizedLabel)) {
    classification = "builtin";
    score = isDefault ? 90 : 110;
  } else if (EXTERNAL_MIC_PATTERN.test(normalizedLabel)) {
    classification = "external";
    score = 25;
  }

  return {
    deviceId: device.deviceId,
    groupId: device.groupId,
    label: rawLabel || `Microphone (${device.deviceId.slice(0, 8)})`,
    classification,
    isDefault,
    score,
  };
}

/**
 * Enumerates audio input devices and prioritizes the phone's built-in mic
 * over Bluetooth HFP/SCO headset mics so earbuds stay in A2DP Stereo mode.
 */
export async function listMicDevices(): Promise<MicListResult> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    return { devices: [], recommendedDeviceId: null, hasLabels: false };
  }

  const allDevices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = allDevices.filter((d) => d.kind === "audioinput");
  const hasLabels = audioInputs.some((d) => d.label.trim().length > 0);

  const classified = audioInputs
    .map(classifyMicDevice)
    .sort((a, b) => b.score - a.score);

  const nonBluetooth = classified.find(
    (d) => d.classification !== "bluetooth"
  );

  return {
    devices: classified,
    recommendedDeviceId: nonBluetooth?.deviceId ?? classified[0]?.deviceId ?? null,
    hasLabels,
  };
}

export interface AcquireMicOptions {
  /** Enable browser AEC/NS/AGC (true for Mode B speakerphone calls; keep false for Mode A BT A2DP lock). */
  voiceCallAec?: boolean;
  /** Enable browser AEC/NS/AGC for single-phone speaker mode (Mode C). */
  speakerAec?: boolean;
  /** Invoked once if the active hardware microphone track ends unexpectedly mid-session. */
  onTrackEnded?: () => void;
}

function buildAudioConstraints(
  deviceId?: string,
  options?: AcquireMicOptions
): MediaStreamConstraints {
  // Keep AEC/NS/AGC disabled in Mode A so Android Chrome stays in MODE_NORMAL + Bluetooth A2DP Stereo
  // instead of switching to VoIP MODE_IN_COMMUNICATION (HFP Mono).
  // Mode B (voiceCallAec) and Mode C (speakerAec) enable hardware AEC/NS/AGC to prevent speaker feedback.
  const enableAec = Boolean(options?.voiceCallAec || options?.speakerAec);
  const audio: MediaTrackConstraints = {
    echoCancellation: enableAec,
    noiseSuppression: enableAec,
    autoGainControl: enableAec,
  };

  if (deviceId) {
    audio.deviceId = { exact: deviceId };
  }

  return { audio, video: false };
}

export class MicManager {
  private activeInfo: ActiveMicInfo | null = null;
  private monitorSource: MediaStreamAudioSourceNode | null = null;
  private monitorAnalyser: AnalyserNode | null = null;
  private monitorBuffer: Uint8Array<ArrayBuffer> | null = null;
  private ownedMonitorCtx: AudioContext | null = null;
  private trackEndedCleanup: (() => void) | null = null;

  public getActiveMic(): ActiveMicInfo | null {
    return this.activeInfo;
  }

  /**
   * Acquires a microphone stream, automatically preferring the built-in phone
   * microphone to prevent Bluetooth earbuds from dropping from A2DP Stereo to HFP Mono.
   */
  public async acquireMic(
    preferredDeviceId?: string,
    options?: AcquireMicOptions
  ): Promise<ActiveMicInfo> {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      throw new Error(
        "Microphone access requires HTTPS (or localhost) and a supported browser."
      );
    }

    this.releaseMic();

    let list = await listMicDevices();
    const targetDeviceId =
      preferredDeviceId ??
      (list.hasLabels ? list.recommendedDeviceId ?? undefined : undefined);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        buildAudioConstraints(targetDeviceId, options)
      );
    } catch {
      // Fallback if exact deviceId is unavailable (e.g. device unplugged)
      stream = await navigator.mediaDevices.getUserMedia(
        buildAudioConstraints(undefined, options)
      );
    }

    // Re-enumerate now that permission is granted and device labels are visible
    list = await listMicDevices();

    const activeTrack = stream.getAudioTracks()[0];
    const activeSettings = activeTrack?.getSettings();
    const currentDeviceId = activeSettings?.deviceId ?? targetDeviceId ?? "";

    const matchedDevice =
      list.devices.find((d) => d.deviceId === currentDeviceId) ??
      list.devices.find((d) => d.label === activeTrack?.label) ??
      classifyMicDevice({
        deviceId: currentDeviceId,
        groupId: activeSettings?.groupId ?? "",
        kind: "audioinput",
        label: activeTrack?.label ?? "",
        toJSON: () => ({}),
      });

    // If no explicit override was chosen and OS defaulted to a Bluetooth HFP mic
    // (or a generic "default" alias when a dedicated non-BT mic is available),
    // immediately switch to the best non-Bluetooth (built-in) mic.
    if (
      !preferredDeviceId &&
      (matchedDevice.classification === "bluetooth" || matchedDevice.isDefault) &&
      list.recommendedDeviceId &&
      list.recommendedDeviceId !== currentDeviceId
    ) {
      const better = list.devices.find(
        (d) => d.deviceId === list.recommendedDeviceId
      );
      if (better && better.classification !== "bluetooth") {
        stream.getTracks().forEach((t) => t.stop());
        try {
          stream = await navigator.mediaDevices.getUserMedia(
            buildAudioConstraints(better.deviceId, options)
          );
        } catch {
          stream = await navigator.mediaDevices.getUserMedia(
            buildAudioConstraints(undefined, options)
          );
        }
      }
    }

    const finalTrack = stream.getAudioTracks()[0];
    const finalSettings = finalTrack?.getSettings();
    const finalDeviceId = finalSettings?.deviceId ?? currentDeviceId;
    const finalMatched =
      list.devices.find((d) => d.deviceId === finalDeviceId) ??
      classifyMicDevice({
        deviceId: finalDeviceId,
        groupId: finalSettings?.groupId ?? "",
        kind: "audioinput",
        label: finalTrack?.label ?? "",
        toJSON: () => ({}),
      });

    this.activeInfo = {
      stream,
      deviceId: finalDeviceId,
      label: finalTrack?.label || finalMatched.label,
      classification: finalMatched.classification,
      sampleRate: finalSettings?.sampleRate,
      channelCount: finalSettings?.channelCount,
      isBluetoothRisk: finalMatched.classification === "bluetooth",
    };

    if (finalTrack && options?.onTrackEnded) {
      const handleEnded = () => {
        options.onTrackEnded?.();
      };
      finalTrack.addEventListener("ended", handleEnded, { once: true });
      this.trackEndedCleanup = () => {
        finalTrack.removeEventListener("ended", handleEnded);
      };
    }

    return this.activeInfo;
  }

  /**
   * Attaches a passive AnalyserNode (never routed to speakers) to monitor mic input level.
   */
  public startLevelMeter(sharedContext?: AudioContext | null): void {
    this.stopLevelMeter();
    if (!this.activeInfo) return;

    let ctx = sharedContext ?? null;
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      this.ownedMonitorCtx = ctx;
    }

    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    this.monitorSource = ctx.createMediaStreamSource(this.activeInfo.stream);
    this.monitorAnalyser = ctx.createAnalyser();
    this.monitorAnalyser.fftSize = 256;
    this.monitorBuffer = new Uint8Array(
      new ArrayBuffer(this.monitorAnalyser.fftSize)
    );
    // Connect only to analyser (never to destination) to avoid feedback
    this.monitorSource.connect(this.monitorAnalyser);
  }

  public getInputLevel(): number {
    if (!this.monitorAnalyser || !this.monitorBuffer) return 0;
    this.monitorAnalyser.getByteTimeDomainData(this.monitorBuffer);
    let sumSq = 0;
    for (let i = 0; i < this.monitorBuffer.length; i++) {
      const v = (this.monitorBuffer[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this.monitorBuffer.length);
    return Math.min(1, rms * 4);
  }

  public stopLevelMeter(): void {
    if (this.monitorSource) {
      try {
        this.monitorSource.disconnect();
      } catch {
        // Ignore
      }
      this.monitorSource = null;
    }
    this.monitorAnalyser = null;
    this.monitorBuffer = null;

    if (this.ownedMonitorCtx) {
      void this.ownedMonitorCtx.close().catch(() => {});
      this.ownedMonitorCtx = null;
    }
  }

  public releaseMic(): void {
    this.stopLevelMeter();
    if (this.trackEndedCleanup) {
      this.trackEndedCleanup();
      this.trackEndedCleanup = null;
    }
    if (this.activeInfo) {
      this.activeInfo.stream.getTracks().forEach((track) => track.stop());
      this.activeInfo = null;
    }
  }
}

let sharedMicManager: MicManager | null = null;

export function getMicManager(): MicManager {
  if (!sharedMicManager) {
    sharedMicManager = new MicManager();
  }
  return sharedMicManager;
}
