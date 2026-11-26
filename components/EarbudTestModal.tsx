"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloseIcon } from "@/components/nova/NovaIcons";
import {
  getStereoEngine,
  type AudioChannel,
  type ChannelLevels,
  type StereoEngineDiagnostics,
} from "@/lib/audio/stereoEngine";
import {
  getMicManager,
  listMicDevices,
  type ActiveMicInfo,
  type ClassifiedMicDevice,
} from "@/lib/audio/micManager";

interface EarbudTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  langALabel?: string;
  langBLabel?: string;
}

function classificationTag(classification: ClassifiedMicDevice["classification"]) {
  switch (classification) {
    case "builtin":
      return "[Phone Mic]";
    case "bluetooth":
      return "[Bluetooth]";
    case "external":
      return "[External]";
    default:
      return "[Mic]";
  }
}

export default function EarbudTestModal({
  isOpen,
  onClose,
  langALabel = "Arabic",
  langBLabel = "English",
}: EarbudTestModalProps) {
  const [activeChannel, setActiveChannel] = useState<AudioChannel | null>(null);
  const [isPingPong, setIsPingPong] = useState(false);
  const [levels, setLevels] = useState<ChannelLevels>({ left: 0, right: 0 });
  const [diagnostics, setDiagnostics] = useState<StereoEngineDiagnostics>({
    contextState: "uninitialized",
    sampleRate: 0,
    channelCount: 0,
    maxChannelCount: 0,
    activeSources: 0,
  });
  const [audioError, setAudioError] = useState<string | null>(null);

  // Mic / A2DP Lock state
  const [micActive, setMicActive] = useState(false);
  const [micLoading, setMicLoading] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micDevices, setMicDevices] = useState<ClassifiedMicDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [activeMicInfo, setActiveMicInfo] = useState<ActiveMicInfo | null>(null);
  const [micLevel, setMicLevel] = useState(0);

  const rafRef = useRef<number | null>(null);

  const refreshDiagnostics = useCallback(() => {
    const engine = getStereoEngine();
    setDiagnostics(engine.getDiagnostics());
  }, []);

  const refreshMicList = useCallback(async () => {
    try {
      const res = await listMicDevices();
      setMicDevices(res.devices);
      return res;
    } catch {
      return null;
    }
  }, []);

  const stopAllAudio = useCallback(() => {
    const engine = getStereoEngine();
    engine.stopAll();
    setIsPingPong(false);
    setActiveChannel(null);
    refreshDiagnostics();
  }, [refreshDiagnostics]);

  const stopMicCheck = useCallback(() => {
    const mic = getMicManager();
    mic.releaseMic();
    setMicActive(false);
    setActiveMicInfo(null);
    setMicLevel(0);
  }, []);

  const handleClose = useCallback(() => {
    stopAllAudio();
    stopMicCheck();
    onClose();
  }, [onClose, stopAllAudio, stopMicCheck]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, handleClose]);

  // Real-time level meter animation loop while modal is open
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const engine = getStereoEngine();
      const mic = getMicManager();
      setLevels(engine.getChannelLevels());
      if (mic.getActiveMic()) {
        setMicLevel(mic.getInputLevel());
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isOpen]);

  // Listen for Bluetooth / audio device changes while modal is open
  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    const syncDevicesAndDiag = async () => {
      try {
        const res = await listMicDevices();
        if (active) {
          setMicDevices(res.devices);
        }
      } catch {
        // Ignore enumeration errors before permission
      }
      if (active) {
        setDiagnostics(getStereoEngine().getDiagnostics());
      }
    };

    void syncDevicesAndDiag();

    const mediaDevices =
      typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!mediaDevices?.addEventListener) {
      return () => {
        active = false;
      };
    }

    const handleDeviceChange = () => {
      void syncDevicesAndDiag();
    };
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      active = false;
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [isOpen]);

  // Ensure cleanup if modal closes via prop change or unmount
  useEffect(() => {
    if (!isOpen) {
      getStereoEngine().stopAll();
      getMicManager().releaseMic();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      getStereoEngine().stopAll();
      getMicManager().releaseMic();
    };
  }, []);

  if (!isOpen) return null;

  const handlePlayChannel = async (channel: AudioChannel) => {
    setAudioError(null);
    const engine = getStereoEngine();
    engine.stopPingPong();
    setIsPingPong(false);
    setActiveChannel(channel);
    try {
      await engine.playTestTone(channel, { durationMs: 750 });
      refreshDiagnostics();
    } catch (err) {
      setAudioError(
        err instanceof Error ? err.message : "Failed to play stereo audio."
      );
    } finally {
      setActiveChannel((prev) => (prev === channel ? null : prev));
      refreshDiagnostics();
    }
  };

  const handleTogglePingPong = async () => {
    setAudioError(null);
    const engine = getStereoEngine();
    if (isPingPong) {
      stopAllAudio();
      return;
    }

    try {
      setIsPingPong(true);
      await engine.startPingPong((ch) => {
        setActiveChannel(ch);
        refreshDiagnostics();
      }, 1250);
      refreshDiagnostics();
    } catch (err) {
      setIsPingPong(false);
      setActiveChannel(null);
      setAudioError(
        err instanceof Error ? err.message : "Failed to start alternating test."
      );
    }
  };

  const handleEnableMic = async (explicitDeviceId?: string) => {
    setMicError(null);
    setMicLoading(true);
    try {
      const engine = getStereoEngine();
      const ctx = await engine.unlock();
      refreshDiagnostics();

      const mic = getMicManager();
      const info = await mic.acquireMic(explicitDeviceId);
      mic.startLevelMeter(ctx);

      setActiveMicInfo(info);
      setSelectedDeviceId(info.deviceId);
      setMicActive(true);
      await refreshMicList();
    } catch (err) {
      setMicActive(false);
      setActiveMicInfo(null);
      setMicError(
        err instanceof Error
          ? err.message
          : "Microphone permission denied or unavailable."
      );
    } finally {
      setMicLoading(false);
    }
  };

  const handleSelectDevice = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (micActive) {
      await handleEnableMic(deviceId);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#242A26]/45 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="earbud-test-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="w-full max-w-lg rounded-t-[28px] sm:rounded-[28px] border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.24)] max-h-[92dvh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#E2DFD6] bg-white px-5 py-4">
          <div>
            <h2
              id="earbud-test-title"
              className="text-base font-bold tracking-tight text-[#242A26]"
            >
              Earbud Left &amp; Right Check
            </h2>
            <p className="text-xs text-[#565E58]">
              Make sure each person hears only their own language
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E2DFD6] bg-[#F5F3ED] text-[#242A26] transition hover:bg-[#DCE8DD]"
            aria-label="Close earbud check"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {audioError && (
            <div className="rounded-2xl border border-[#B54F4C]/40 bg-[#C76A67]/10 px-3.5 py-2.5 text-xs text-[#9B3B38]">
              {audioError}
            </div>
          )}

          {/* Left / Right Channel Cards (always LTR so physical L/R ears never flip) */}
          <div dir="ltr" className="grid grid-cols-2 gap-3">
            {/* LEFT EARBUD */}
            <button
              type="button"
              onClick={() => void handlePlayChannel("left")}
              className={`group relative flex flex-col items-start justify-between rounded-2xl border p-4 text-left transition active:scale-[0.98] nova-soft-shadow ${
                activeChannel === "left"
                  ? "border-[#315F4A] bg-[#DCE8DD]/65"
                  : "border-[#E2DFD6] bg-white hover:border-[#315F4A]/50"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#315F4A] text-base font-bold text-white">
                  L
                </span>
                <span className="text-[11px] font-semibold text-[#315F4A]">
                  Left Ear
                </span>
              </div>

              <div className="mt-4">
                <div className="text-sm font-semibold text-[#242A26]">
                  Test Left Earbud
                </div>
                <div className="mt-0.5 text-[11px] text-[#565E58]">
                  Person A ({langALabel})
                </div>
              </div>

              {/* Real-time post-pan meter */}
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#E2DFD6]">
                <div
                  className="h-full rounded-full bg-[#315F4A] transition-[width] duration-75"
                  style={{ width: `${Math.round(levels.left * 100)}%` }}
                />
              </div>
            </button>

            {/* RIGHT EARBUD */}
            <button
              type="button"
              onClick={() => void handlePlayChannel("right")}
              className={`group relative flex flex-col items-start justify-between rounded-2xl border p-4 text-left transition active:scale-[0.98] nova-soft-shadow ${
                activeChannel === "right"
                  ? "border-[#A86D43] bg-[#E8D8BF]/70"
                  : "border-[#E2DFD6] bg-white hover:border-[#A86D43]/60"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#A86D43] text-base font-bold text-white">
                  R
                </span>
                <span className="text-[11px] font-semibold text-[#A86D43]">
                  Right Ear
                </span>
              </div>

              <div className="mt-4">
                <div className="text-sm font-semibold text-[#242A26]">
                  Test Right Earbud
                </div>
                <div className="mt-0.5 text-[11px] text-[#565E58]">
                  Person B ({langBLabel})
                </div>
              </div>

              {/* Real-time post-pan meter */}
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#E2DFD6]">
                <div
                  className="h-full rounded-full bg-[#A86D43] transition-[width] duration-75"
                  style={{ width: `${Math.round(levels.right * 100)}%` }}
                />
              </div>
            </button>
          </div>

          {/* Alternating & Center Controls */}
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => void handleTogglePingPong()}
              className={`flex-1 min-h-[44px] min-w-[170px] rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[0.98] ${
                isPingPong
                  ? "bg-[#A87131] text-white hover:bg-[#915E24]"
                  : "bg-[#214536] text-white hover:bg-[#315F4A]"
              }`}
            >
              {isPingPong ? "Stop Alternating" : "Alternate Left ↔ Right"}
            </button>

            <button
              type="button"
              onClick={() => void handlePlayChannel("both")}
              className={`min-h-[44px] rounded-xl border px-4 py-3 text-sm font-medium transition active:scale-[0.98] ${
                activeChannel === "both"
                  ? "border-[#315F4A] bg-[#DCE8DD] text-[#214536]"
                  : "border-[#E2DFD6] bg-white text-[#242A26] hover:bg-[#F5F3ED]"
              }`}
            >
              Both Ears
            </button>
          </div>

          {/* Built-in Mic Check */}
          <div className="rounded-2xl border border-[#E2DFD6] bg-white p-4 space-y-3 nova-soft-shadow">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#242A26]">
                  Check Phone Microphone Separation
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-[#565E58]">
                  Test speaking into your phone mic while playing Left/Right tones to ensure your earbuds keep separate stereo channels.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={micLoading}
                onClick={() =>
                  micActive
                    ? stopMicCheck()
                    : void handleEnableMic(selectedDeviceId || undefined)
                }
                className={`min-h-[44px] rounded-xl px-4 py-2 text-xs font-semibold transition ${
                  micActive
                    ? "border border-[#B54F4C]/40 bg-[#C76A67]/10 text-[#9B3B38] hover:bg-[#C76A67]/20"
                    : "bg-[#315F4A] text-white hover:bg-[#214536]"
                } disabled:opacity-60`}
              >
                {micLoading
                  ? "Checking mic..."
                  : micActive
                    ? "Stop Mic Check"
                    : "Test Phone Microphone"}
              </button>

              {activeMicInfo && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    activeMicInfo.isBluetoothRisk
                      ? "bg-[#E8D8BF]/70 text-[#242A26] border border-[#A87131]/40"
                      : "bg-[#DCE8DD] text-[#214536] border border-[#A8BDA9]"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                  {activeMicInfo.isBluetoothRisk
                    ? "Bluetooth Mic (may merge ears)"
                    : "Phone Mic Locked"}
                </span>
              )}
            </div>

            {micError && (
              <div className="rounded-xl border border-[#B54F4C]/40 bg-[#C76A67]/10 px-3 py-2 text-xs text-[#9B3B38]">
                {micError}
              </div>
            )}

            {/* Mic Selector Fallback Dropdown */}
            <div className="space-y-1.5">
              <label
                htmlFor="mic-device-select"
                className="block text-[11px] font-semibold uppercase tracking-wider text-[#565E58]"
              >
                Microphone ({micDevices.length} detected)
              </label>
              <select
                id="mic-device-select"
                value={selectedDeviceId}
                onChange={(e) => void handleSelectDevice(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-[#E2DFD6] bg-[#F5F3ED] px-3 py-2.5 text-xs text-[#242A26] outline-none focus:border-[#315F4A]"
              >
                {micDevices.length === 0 ? (
                  <option value="">
                    Tap &quot;Test Phone Microphone&quot; to detect mics
                  </option>
                ) : (
                  micDevices.map((dev) => (
                    <option key={dev.deviceId} value={dev.deviceId}>
                      {classificationTag(dev.classification)} {dev.label}
                    </option>
                  ))
                )}
              </select>
            </div>

            {activeMicInfo?.isBluetoothRisk && (
              <div className="rounded-xl border border-[#A87131]/40 bg-[#E8D8BF]/50 px-3 py-2 text-xs text-[#242A26]">
                A Bluetooth headset microphone is active, which may merge left and right earbud channels. Switch above to your phone&apos;s built-in microphone.
              </div>
            )}

            {micActive && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-[#565E58]">
                  <span className="truncate max-w-[70%]">
                    Active: {activeMicInfo?.label}
                  </span>
                  <span className="font-mono text-[#242A26]">
                    {Math.round(micLevel * 100)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2DFD6]">
                  <div
                    className="h-full rounded-full bg-[#315F4A] transition-[width] duration-75"
                    style={{ width: `${Math.round(micLevel * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <details className="rounded-2xl border border-[#E2DFD6] bg-white px-3.5 py-2.5 text-xs text-[#565E58]">
            <summary className="cursor-pointer select-none font-semibold">
              Channel status details
            </summary>
            <div
              dir="ltr"
              className="mt-2 pt-2 border-t border-[#E2DFD6] font-mono text-[11px] flex flex-wrap items-center justify-between gap-2"
            >
              <span>Engine: {diagnostics.contextState}</span>
              <span>
                Channels:{" "}
                {diagnostics.channelCount > 0
                  ? `${diagnostics.channelCount}ch (max ${diagnostics.maxChannelCount})`
                  : "tap Left or Right"}
              </span>
              <span>
                {diagnostics.sampleRate > 0 ? `${diagnostics.sampleRate} Hz` : "—"}
              </span>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
