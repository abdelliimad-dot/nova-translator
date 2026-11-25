"use client";

import { useState } from "react";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  HeadphonesIcon,
  MicIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@/components/nova/NovaIcons";
import type { ClassifiedMicDevice } from "@/lib/audio/micManager";
import { getDictionary, type UiLocale } from "@/lib/i18n";
import {
  NOVA_VOICE_PRESETS,
  resetNovaSettings,
  triggerHaptic,
  updateNovaSettings,
  useNovaSettings,
  type CapturePreference,
  type NovaVoiceName,
  type VadSensitivity,
} from "@/lib/settingsStore";

interface AudioSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  micDevices?: ClassifiedMicDevice[];
  selectedMicId?: string;
  activeMicLabel?: string | null;
  isBluetoothMicRisk?: boolean;
  onSelectMic?: (deviceId: string) => void;
  audioCtxState?: AudioContextState | "uninitialized";
  audioChannelCount?: number;
  chunkCount?: number;
  lastPanChannel?: "left" | "right" | null;
  audioDebugNotice?: string | null;
  wakeLockActive?: boolean;
  onBeepTest?: () => void;
  onOpenEarbudTest?: () => void;
  showDiagnostics?: boolean;
  transcriptCount?: number;
  onExportTranscript?: () => Promise<boolean | void> | boolean | void;
  onClearTranscripts?: () => void;
}

export default function AudioSettingsDrawer({
  isOpen,
  onClose,
  micDevices = [],
  selectedMicId = "",
  activeMicLabel = null,
  isBluetoothMicRisk = false,
  onSelectMic,
  audioCtxState = "uninitialized",
  audioChannelCount = 0,
  chunkCount,
  lastPanChannel,
  audioDebugNotice,
  wakeLockActive = false,
  onBeepTest,
  onOpenEarbudTest,
  showDiagnostics = true,
  transcriptCount = 0,
  onExportTranscript,
  onClearTranscripts,
}: AudioSettingsDrawerProps) {
  const settings = useNovaSettings();
  const [exportedFeedback, setExportedFeedback] = useState(false);

  if (!isOpen) return null;

  const dict = getDictionary(settings.uiLocale);
  const isRtl = settings.uiLocale === "ar";

  const handleToggle = (
    key: "autoDetect" | "wakeLockEnabled" | "saveTranscripts" | "hapticsEnabled",
    value: boolean
  ) => {
    triggerHaptic(settings.hapticsEnabled, 10);
    updateNovaSettings({ [key]: value });
  };

  const handleLocaleChange = (locale: UiLocale) => {
    triggerHaptic(settings.hapticsEnabled, 10);
    updateNovaSettings({ uiLocale: locale });
  };

  const handleCaptureMode = (mode: CapturePreference) => {
    triggerHaptic(settings.hapticsEnabled, 10);
    updateNovaSettings({ captureMode: mode });
  };

  const handleSensitivity = (vadSensitivity: VadSensitivity) => {
    triggerHaptic(settings.hapticsEnabled, 10);
    updateNovaSettings({ vadSensitivity });
  };

  const handleExportClick = async () => {
    if (!onExportTranscript) return;
    triggerHaptic(settings.hapticsEnabled, 10);
    await onExportTranscript();
    setExportedFeedback(true);
    setTimeout(() => setExportedFeedback(false), 1800);
  };

  const hasLiveAudioControls = Boolean(onSelectMic) || micDevices.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#242A26]/45 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audio-settings-title"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="w-full max-w-md rounded-t-[28px] sm:rounded-[28px] border border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] shadow-[0_24px_60px_-15px_rgba(33,69,54,0.24)] max-h-[90dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E6E5DE] bg-white px-5 py-4 shrink-0">
          <div>
            <h2
              id="audio-settings-title"
              className="text-base font-bold text-[#242A26]"
            >
              {dict.settingsTitle}
            </h2>
            <p className="text-xs text-[#777F79]">{dict.settingsSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={dict.closeLabel}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E6E5DE] bg-[#F5F3ED] text-[#242A26] transition hover:bg-[#DCE8DD]"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto space-y-3.5 p-5">
          {/* 1. Audio Section */}
          <section className="rounded-2xl border border-[#E6E5DE] bg-white p-4 space-y-3.5 nova-soft-shadow">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#315F4A]">
              {dict.settingsGroups.audio}
            </h3>

            {onOpenEarbudTest && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E6E5DE] bg-[#F5F3ED] p-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#DCE8DD] text-[#214536]">
                    <HeadphonesIcon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#242A26] truncate">
                      {dict.settingsFields.earbudTestTitle}
                    </div>
                    <div className="text-[11px] text-[#777F79] leading-snug">
                      {dict.settingsFields.earbudTestDesc}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenEarbudTest();
                  }}
                  className="shrink-0 min-h-[44px] rounded-xl bg-[#315F4A] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#214536] active:scale-[0.98]"
                >
                  {dict.settingsFields.earbudTestAction}
                </button>
              </div>
            )}

            {hasLiveAudioControls && (
              <div className="space-y-1.5">
                <label
                  htmlFor="settings-mic-select"
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#242A26]"
                >
                  <MicIcon className="w-3.5 h-3.5 text-[#315F4A]" />
                  <span>{dict.settingsFields.micLabel}</span>
                </label>
                <select
                  id="settings-mic-select"
                  value={selectedMicId}
                  onChange={(e) => onSelectMic?.(e.target.value)}
                  className={`w-full min-h-[44px] rounded-xl border bg-[#F5F3ED] px-3 py-2.5 text-xs outline-none transition ${
                    isBluetoothMicRisk
                      ? "border-[#C28B47] text-[#242A26]"
                      : "border-[#E6E5DE] text-[#242A26] focus:border-[#315F4A]"
                  }`}
                >
                  {micDevices.length === 0 ? (
                    <option value="">
                      {activeMicLabel
                        ? activeMicLabel
                        : dict.settingsFields.autoBuiltInMic}
                    </option>
                  ) : (
                    micDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.classification === "builtin"
                          ? "[Built-in] "
                          : d.classification === "bluetooth"
                            ? "[BT HFP!] "
                            : ""}
                        {d.label}
                      </option>
                    ))
                  )}
                </select>
                {isBluetoothMicRisk && (
                  <p className="rounded-xl border border-[#C28B47]/40 bg-[#E8D8BF]/45 px-3 py-2 text-[11px] text-[#242A26]">
                    {dict.settingsFields.bluetoothRiskWarning}
                  </p>
                )}
              </div>
            )}

            {onBeepTest && (
              <div className="rounded-xl border border-[#E6E5DE] bg-[#F5F3ED] p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-[#242A26]">
                    {dict.settingsFields.stereoOutputLabel}
                  </div>
                  <div className="text-[11px] text-[#777F79]">
                    440Hz Left (-1.0) → 880Hz Right (+1.0)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onBeepTest}
                  className="shrink-0 min-h-[44px] rounded-xl bg-[#315F4A] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#214536] active:scale-[0.98]"
                >
                  Beep (L → R)
                </button>
              </div>
            )}

            {showDiagnostics && (
              <div
                dir="ltr"
                className="rounded-xl border border-[#E6E5DE] bg-[#F5F3ED] p-3 space-y-1.5 font-mono text-[11px]"
              >
                <div className="flex items-center justify-between text-[#777F79]">
                  <span>AudioContext</span>
                  <strong
                    className={
                      audioCtxState === "running"
                        ? "text-[#4C8062]"
                        : "text-[#C28B47]"
                    }
                  >
                    {audioCtxState}
                  </strong>
                </div>
                <div className="flex items-center justify-between text-[#777F79]">
                  <span>Output Channels</span>
                  <strong
                    className={
                      audioChannelCount >= 2 ? "text-[#315F4A]" : "text-[#C28B47]"
                    }
                  >
                    {audioChannelCount}ch
                  </strong>
                </div>
                {typeof chunkCount === "number" && (
                  <div className="flex items-center justify-between text-[#777F79]">
                    <span>Audio Chunks</span>
                    <strong className="text-[#242A26]">{chunkCount}</strong>
                  </div>
                )}
                {lastPanChannel !== undefined && (
                  <div className="flex items-center justify-between text-[#777F79]">
                    <span>Active Pan</span>
                    <strong className="text-[#315F4A]">
                      {lastPanChannel === "left"
                        ? "L (-1.0)"
                        : lastPanChannel === "right"
                          ? "R (+1.0)"
                          : "Center (0.0)"}
                    </strong>
                  </div>
                )}
                <div className="flex items-center justify-between text-[#777F79]">
                  <span>Screen Wake Lock</span>
                  <strong
                    className={
                      wakeLockActive ? "text-[#4C8062]" : "text-[#777F79]"
                    }
                  >
                    {wakeLockActive ? "Active" : "Standby"}
                  </strong>
                </div>
              </div>
            )}

            {audioDebugNotice && (
              <div
                dir="ltr"
                className="rounded-xl border border-[#C28B47]/40 bg-[#E8D8BF]/45 px-3 py-2 font-mono text-[11px] text-[#242A26] break-words"
              >
                {audioDebugNotice}
              </div>
            )}
          </section>

          {/* 2. Translation Section */}
          <section className="rounded-2xl border border-[#E6E5DE] bg-white p-4 space-y-3 nova-soft-shadow">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#315F4A]">
              {dict.settingsGroups.translation}
            </h3>

            <ToggleRow
              label={dict.settingsFields.autoDetectLabel}
              description={dict.settingsFields.autoDetectDesc}
              checked={settings.autoDetect}
              onChange={(next) => handleToggle("autoDetect", next)}
            />

            {/* Natural AI Voice Persona */}
            <div className="space-y-1.5 pt-1">
              <label
                htmlFor="settings-voice-persona"
                className="block text-xs font-semibold text-[#242A26]"
              >
                {dict.settingsFields.voicePersonaLabel}
              </label>
              <select
                id="settings-voice-persona"
                value={settings.voiceName}
                onChange={(e) => {
                  triggerHaptic(settings.hapticsEnabled, 8);
                  updateNovaSettings({
                    voiceName: e.target.value as NovaVoiceName,
                  });
                }}
                className="w-full min-h-[44px] rounded-xl border border-[#E6E5DE] bg-[#F5F3ED] px-3 py-2 text-xs font-medium text-[#242A26] outline-none focus:border-[#315F4A]"
              >
                {NOVA_VOICE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {isRtl ? preset.arLabel : preset.enLabel}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[#777F79]">
                {dict.settingsFields.voicePersonaHint}
              </p>
            </div>

            <ToggleRow
              label={dict.settingsFields.saveTranscriptsLabel}
              description={dict.settingsFields.saveTranscriptsDesc}
              checked={settings.saveTranscripts}
              onChange={(next) => handleToggle("saveTranscripts", next)}
            />

            {(onExportTranscript || onClearTranscripts) && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                {onExportTranscript && (
                  <button
                    type="button"
                    disabled={transcriptCount === 0}
                    onClick={() => void handleExportClick()}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#E6E5DE] bg-[#F5F3ED] px-3 py-2 text-xs font-semibold text-[#315F4A] transition hover:bg-[#DCE8DD]/60 disabled:opacity-45"
                  >
                    {exportedFeedback ? (
                      <CheckIcon className="w-3.5 h-3.5 text-[#4C8062]" />
                    ) : (
                      <CopyIcon className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {exportedFeedback
                        ? isRtl
                          ? "تم النسخ!"
                          : "Copied!"
                        : dict.settingsFields.exportTranscript}
                    </span>
                  </button>
                )}

                {onClearTranscripts && (
                  <button
                    type="button"
                    disabled={transcriptCount === 0}
                    onClick={() => {
                      triggerHaptic(settings.hapticsEnabled, 10);
                      onClearTranscripts();
                    }}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#E6E5DE] bg-[#F5F3ED] px-3 py-2 text-xs font-semibold text-[#C76A67] transition hover:bg-[#C76A67]/12 disabled:opacity-45"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                    <span>{dict.settingsFields.clearTranscripts}</span>
                  </button>
                )}
              </div>
            )}
          </section>

          {/* 3. Listening Section */}
          <section className="rounded-2xl border border-[#E6E5DE] bg-white p-4 space-y-3.5 nova-soft-shadow">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#315F4A]">
              {dict.settingsGroups.listening}
            </h3>

            {/* Capture Mode */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-[#242A26]">
                {dict.settingsFields.vadModeLabel}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleCaptureMode("vad")}
                  className={`min-h-[44px] rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    settings.captureMode === "vad"
                      ? "border-[#315F4A] bg-[#DCE8DD] text-[#214536]"
                      : "border-[#E6E5DE] bg-[#F5F3ED] text-[#777F79] hover:text-[#242A26]"
                  }`}
                >
                  {dict.settingsFields.autoVad}
                </button>
                <button
                  type="button"
                  onClick={() => handleCaptureMode("ptt")}
                  className={`min-h-[44px] rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    settings.captureMode === "ptt"
                      ? "border-[#315F4A] bg-[#DCE8DD] text-[#214536]"
                      : "border-[#E6E5DE] bg-[#F5F3ED] text-[#777F79] hover:text-[#242A26]"
                  }`}
                >
                  {dict.settingsFields.pushToTalk}
                </button>
              </div>
            </div>

            {/* VAD Sensitivity */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-[#242A26]">
                {dict.settingsFields.vadSensitivity}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ["low", dict.settingsFields.sensitivityLow],
                    ["balanced", dict.settingsFields.sensitivityBalanced],
                    ["high", dict.settingsFields.sensitivityHigh],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleSensitivity(value)}
                    className={`min-h-[44px] rounded-xl border px-2 py-1.5 text-[11px] font-medium leading-tight transition ${
                      settings.vadSensitivity === value
                        ? "border-[#315F4A] bg-[#214536] text-white"
                        : "border-[#E6E5DE] bg-[#F5F3ED] text-[#777F79] hover:text-[#242A26]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <ToggleRow
              label={dict.settingsFields.wakeLockLabel}
              description={dict.settingsFields.wakeLockDesc}
              checked={settings.wakeLockEnabled}
              onChange={(next) => handleToggle("wakeLockEnabled", next)}
            />
          </section>

          {/* 4. App Section */}
          <section className="rounded-2xl border border-[#E6E5DE] bg-white p-4 space-y-3.5 nova-soft-shadow">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#315F4A]">
              {dict.settingsGroups.app}
            </h3>

            {/* UI Language */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[#242A26]">
                {dict.uiLanguageLabel}
              </span>
              <div className="inline-flex min-h-[44px] items-center rounded-full border border-[#E6E5DE] bg-[#F5F3ED] p-0.5">
                <button
                  type="button"
                  onClick={() => handleLocaleChange("en")}
                  className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-xs font-semibold transition ${
                    settings.uiLocale === "en"
                      ? "bg-[#214536] text-white"
                      : "text-[#777F79] hover:text-[#242A26]"
                  }`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => handleLocaleChange("ar")}
                  className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-xs font-semibold transition ${
                    settings.uiLocale === "ar"
                      ? "bg-[#214536] text-white"
                      : "text-[#777F79] hover:text-[#242A26]"
                  }`}
                >
                  العربية
                </button>
              </div>
            </div>

            <ToggleRow
              label={dict.settingsFields.hapticsLabel}
              description={dict.settingsFields.hapticsDesc}
              checked={settings.hapticsEnabled}
              onChange={(next) => handleToggle("hapticsEnabled", next)}
            />
          </section>

          {/* 5. Privacy Section */}
          <section className="rounded-2xl border border-[#E6E5DE] bg-white p-4 space-y-3 nova-soft-shadow">
            <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#315F4A]">
              <ShieldCheckIcon className="w-3.5 h-3.5" />
              <span>{dict.settingsGroups.privacy}</span>
            </h3>
            <p className="text-xs leading-relaxed text-[#777F79]">
              {dict.settingsFields.privacySummary}
            </p>
            <p className="text-[11px] leading-relaxed text-[#777F79]">
              {dict.settingsFields.micPermissionInfo}
            </p>
            <button
              type="button"
              onClick={() => {
                triggerHaptic(settings.hapticsEnabled, 14);
                resetNovaSettings();
              }}
              className="w-full min-h-[44px] rounded-xl border border-[#E6E5DE] bg-[#F5F3ED] px-3 py-2 text-xs font-semibold text-[#242A26] transition hover:bg-[#DCE8DD]/55"
            >
              {dict.settingsFields.clearSessionData}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full min-h-[44px] items-center justify-between gap-3 rounded-xl py-1 text-start"
    >
      <div className="min-w-0">
        <div className="text-xs font-semibold text-[#242A26]">{label}</div>
        <div className="text-[11px] text-[#777F79] leading-snug">
          {description}
        </div>
      </div>
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-[#315F4A]" : "bg-[#E6E5DE]"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked
              ? "ltr:translate-x-6 rtl:-translate-x-6"
              : "ltr:translate-x-1 rtl:-translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}
