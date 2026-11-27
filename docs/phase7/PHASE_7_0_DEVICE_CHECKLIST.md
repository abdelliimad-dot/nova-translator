# NOVA — Phase 7.0 Hardware & Device Verification Checklist

**Status:** Preparation Only — **0 physical devices tested in Phase 7.0**  
**Purpose:** Standardize hardware verification across real phones, desktop browsers, wired headsets, and Bluetooth earbuds during Phase 7.1 execution.

---

## 1. Critical Evidence Boundary: Emulation vs. Desktop vs. Physical Device

Phase 6.x browser checks used automated Chromium/Playwright viewports and synthetic browser audio stubs. **Browser emulation is NOT physical device validation.** During Phase 7.1, every test row must explicitly record which hardware tier ran it, and **emulated or desktop runs must NEVER be counted toward mobile or Bluetooth exit gates**.

| Testing Tier | What It Can Verify | What It CANNOT Verify (Blind Spots) | Allowed for Exit Gates? |
|---|---|---|---|
| **Browser Emulation** (Playwright / Chrome DevTools mobile viewport) | CSS responsive layout, 44 px touch targets, DOM/RTL rendering, UI modals, mock MediaStream hooks | Real `AudioContext` mobile unlock, OS hardware AEC/AGC/NS, Bluetooth A2DP/HFP switching, microphone pickup acoustics, mobile cellular jitter, thermal/battery throttling | **NO** (UI smoke only) |
| **Desktop Browser** (Windows/macOS Chrome, Edge, Safari) | End-to-end audio capture & playback plumbing, USB/3.5 mm stereo separation, local WebRTC signaling, desktop mic ranking | Mobile Safari iOS silent switch & background suspension, Android Chrome HFP SCO downgrade, phone speaker-to-mic acoustic echo, Algerian 4G handoff | **Desktop Baseline Only** (cannot satisfy mobile/BT gates) |
| **Actual Physical Device** (Real Android / iOS phones + real headsets/earbuds) | True `getUserMedia` hardware echo cancellation, Silero VAD false-trigger rate in ambient noise, actual Bluetooth `A2DP` stereo vs `HFP/SCO` mono fallback, real TTFA latency under Wi-Fi/4G | — (Gold standard for real-world audio readiness) | **YES** (required for Exit Gates 2–5) |

---

## 2. Device Inventory Table (Fill During Phase 7.1)

Record **one row per distinct physical device + headset/earbud + network test session**. Do not aggregate different headsets or networks into a single row.

| Device Name | Manufacturer | OS Version | Browser | Browser Version | Device Type | Microphone | Speaker | Earbuds | Network | Test Date | Mode | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| *Example: Phone A (Owner)* | *Samsung / Xiaomi / Apple* | *Android 14 / iOS 17.x* | *Chrome / Safari* | *126.x / 17.x* | *Mobile Phone* | *Phone Built-in Bottom Mic* | *N/A (Muted to Earbuds)* | *Galaxy Buds (A2DP)* | *Home Wi-Fi (Fiber/ADSL)* | *YYYY-MM-DD* | *Mode A* | *PASS / FAIL* |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |

---

## 3. Pre-Test Audio Routing & App Controls Verification

Before running spoken test cases on any device, confirm the in-app controls built into `AudioSettingsDrawer` and `EarbudTestModal`:
1. Open the **Audio Settings Drawer** and inspect:
   - **Capture Mode:** `Hands-free` (Silero VAD) vs `Hold to talk` (PTT).
   - **VAD Sensitivity:** `Low`, `Balanced` (default), or `High`.
   - **Mic Selector:** Verify `listMicDevices()` lists available inputs and highlights any Bluetooth input warning (`isBluetoothRisk`).
   - **Keep Screen Awake:** Toggle ON for Mode A / continuous Mode B tests to verify Screen Wake Lock behavior.
   - **Audio Diagnostics (`<details>`):** Verify reported `AudioContext` state (`running`) and channel count before starting spoken turns.
2. Open **Earbud Test Modal (`EarbudTestModal`)** and play both the **Left Ear** and **Right Ear** test chimes + run the **Microphone Level Check** prior to Mode A stereo tests.

---

## 4. Platform-Specific Hardware Checklists

### 4.1 Android Chrome (Physical Phone)

- [ ] **Secure Context Verified:** App is loaded over `https://` (LAN HTTPS proxy/tunnel or localhost ADB port-forward). Plain `http://192.168.x.x` blocks `getUserMedia()`.
- [ ] **Microphone Permission Prompt:** Chrome grants microphone permission cleanly on first tap; permission persists on reload without loop.
- [ ] **Synchronous AudioContext Unlock:** Tapping Start/Join calls `StereoEngine.unlockSync()` synchronously; `<details>` diagnostics reports `AudioContext: running`.
- [ ] **Media Volume vs Call Volume:** Confirm Android adjusts **Media** stream (not stuck in **In-Call / Voice Communication** `HFP` volume) when using Mode A speaker or A2DP earbuds.
- [ ] **Microphone Selection (`listMicDevices`):** Confirm built-in phone mic is auto-selected over any Bluetooth headset mic (`builtin` rank `90/110` vs `bluetooth` `-100`) when Bluetooth earbuds are paired.
- [ ] **Mode A Echo / Feedback:** Hold phone 20–35 cm from speaker; speak aloud; verify AI audio output does not re-trigger Silero VAD into translating NOVA's own voice.
- [ ] **Mode B Voice-Call AEC:** With `voiceCallAec = true` in Mode B, test handset speaker/earpiece at normal volume; confirm remote phone does not hear loud acoustic echo.
- [ ] **Screen Lock & Tab Switch Recovery:** Lock Android screen for 30 s, then unlock (`visibilitychange` triggers `attachLifecycleRecovery`); confirm playback and mic resume or surface an explicit recovery prompt instead of silent death.
- [ ] **Battery / Thermal Check (15 min):** After 15 min continuous session, note device warmth and whether Chrome throttles AudioWorklet/VAD frames.

### 4.2 iPhone / iOS Safari (Physical Phone)

- [ ] **Secure Context & Browser Engine:** Loaded in physical iOS Safari (not desktop Safari responsive mode) over `https://`. Also check Home Screen PWA launch if tested as standalone.
- [ ] **Hardware Mute / Ringer Switch Test:** Flip physical side mute switch ON/OFF; confirm Web Audio playback behavior matches expectations and does not fail silently without warning.
- [ ] **Mandatory User-Gesture AudioContext Unlock:** Verify tapping **Start Session** unlocks `AudioContext` on the first tap (`running` state), including after leaving Safari briefly and returning.
- [ ] **iOS Audio Input Selection Quirk:** Check what microphones Safari exposes in `AudioSettingsDrawer` (iOS frequently exposes only a single active route rather than independent built-in vs AirPods mic endpoints). Document exact `deviceId`/label behavior in Failure/Device Notes!
- [ ] **Playback Route Stability:** With AirPods or wired Lightning/USB-C earbuds connected, confirm TTS audio plays cleanly through earbuds rather than unexpectedly snapping to the iPhone earpiece speaker.
- [ ] **Interruption Recovery (Incoming Call / Siri / Control Center):** Trigger Control Center audio pause or lock screen for 20 s, return to Safari, and verify `StereoEngine` + VAD recover cleanly (`attachLifecycleRecovery`).
- [ ] **16 kHz Capture Resampling:** Speak quick consonant-heavy Darija/French utterances and verify no robotic pitch/sample-rate distortion from iOS hardware 48 kHz -> 16 kHz capture resampling.

### 4.3 Desktop Browser (Windows / macOS — Chrome, Edge, Safari)

- [ ] **Baseline Sanity Only:** Verify USB headset / laptop built-in mic enumeration, L/R channel panning (`channelToPan(-1.0)` vs `channelToPan(1.0)`), and Mode B two-tab or desktop-to-phone signaling.
- [ ] **Echo Isolation Check:** With laptop speakers ON (no headset), test whether desktop OS AEC prevents self-loop in Mode A vs Mode B.
- [ ] **Explicit Limitation Note:** Record desktop results in a clearly marked row (`Desktop`) so desktop pass results never mask missing mobile tests.

### 4.4 Bluetooth Earbuds (`A2DP` Stereo vs. `HFP/SCO` Bidirectional Warning)

> **Architectural Rule (Critical):** Standard Classic Bluetooth cannot carry high-quality stereo playback and microphone capture simultaneously. Activating a Bluetooth earbud microphone forces the OS/headset into **Hands-Free Profile (`HFP/SCO`)**, which collapses audio to **mono `8–16 kHz` narrowband** and **destroys Mode A Left/Right stereo separation**.

- [ ] **A2DP Stereo Verification (Mode A Recommended Setup):**
  - Pair Bluetooth earbuds (`Left` bud in Person A ear, `Right` bud in Person B ear).
  - Verify `AudioSettingsDrawer` keeps **Mic = Built-in Phone Mic** (not Bluetooth HFP mic — scenario `AUD-M02`).
  - Run `EarbudTestModal`: Left chime is strictly audible **only** in Left bud; Right chime **only** in Right bud (zero center mono collapse).
  - Run `AUD-M06`: Confirm translated Person A speech pans cleanly Left (`-1.0`) or Right (`+1.0`) according to assigned channel, with full-bandwidth audio (not telephone-quality HFP).
- [ ] **Forced HFP Warning Check (`AUD-M02`):** Intentionally select the Bluetooth earbud mic in `AudioSettingsDrawer` (if exposed by OS); verify the app displays the Bluetooth HFP risk warning (`isBluetoothRisk`) and measure audio degradation vs built-in phone mic.
- [ ] **Mid-Session Connect / Hot-Plug:** Start session on phone speaker, then open earbud case / connect Bluetooth mid-session; check whether playback transitions cleanly or stalls `AudioContext`.
- [ ] **Mid-Session Disconnect / Battery Removal (`AUD-M04`):** Put one or both earbuds back in the charging case mid-session (`onTrackEnded` / output fallback); verify app handles disconnect cleanly without throwing an unhandled audio error or freezing UI state.

### 4.5 Wired Headsets (`USB-C` / `Lightning` / `3.5 mm` TRRS)

- [ ] **Channel Isolation Test (`AUD-M06`):** Run `EarbudTestModal` Left and Right chimes; verify 100% channel isolation (no mono adapter crosstalk — watch out for defective cheap mono-bridged 3.5 mm splitters).
- [ ] **Acoustic Mic-to-Bud Isolation:** Speak at normal conversation volume (`DAR-01`..`DAR-04`); verify inline headset mic captures voice cleanly without clipping and without picking up earbud bleed.
- [ ] **Mode A Two-Person Shared Wired Test:** Share Left/Right wired buds at 30–50 cm spacing (`AUD-M09` distance check); confirm inline mic still captures Speaker 2 cleanly or note distance drop-off if inline mic sits too close to Speaker 1's collar.
- [ ] **Mid-Session Unplug & Re-Plug (`AUD-M03`):** Unplug headset mid-session and after AI turn starts; confirm playback pauses or switches cleanly without leaving Mic/Gemini state wedged.

---

## 5. Audio Hardware Quick Sign-Off Matrix (Fill After Phase 7.1)

| Hardware Category | Tested Units (Count) | Mode A Tested? | Mode B Tested? | Stereo Pan Verified? | Recovery Verified? | Category Gate Result |
|---|---:|---|---|---|---|---|
| Android Phone (Built-in + Speaker) | 0 (Pending) | Pending | Pending | N/A | Pending | **NOT EXECUTED** |
| iOS Phone (Built-in + Speaker) | 0 (Pending) | Pending | Pending | N/A | Pending | **NOT EXECUTED** |
| Desktop Browser (Baseline) | 0 (Pending) | Pending | Pending | Pending | Pending | **NOT EXECUTED** |
| Bluetooth Earbuds (A2DP + Phone Mic) | 0 (Pending) | Pending | Pending | Pending | Pending | **NOT EXECUTED** |
| Wired Headset (`USB-C` / `3.5 mm` / `Lightning`) | 0 (Pending) | Pending | Pending | Pending | Pending | **NOT EXECUTED** |
