import type { ParticipantRole, WebRtcSignalKind } from "@/lib/rooms/roomStore";

export type CallConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface WebRtcCallCallbacks {
  onStateChange?: (state: CallConnectionState, detail?: string) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onRemoteEnded?: () => void;
  onSignal: (kind: WebRtcSignalKind, payload: unknown) => Promise<void> | void;
}

const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
  iceCandidatePoolSize: 2,
};

/**
 * Manages a peer-to-peer WebRTC voice call layered cleanly alongside
 * the room's Gemini Live translation stream using SSE/polling signaling.
 * Host acts as caller and Guest as callee to prevent SDP glare.
 */
export class WebRtcCallManager {
  private role: ParticipantRole;
  private callbacks: WebRtcCallCallbacks;
  private pc: RTCPeerConnection | null = null;
  private clonedLocalTrack: MediaStreamTrack | null = null;
  private localSender: RTCRtpSender | null = null;
  private isCallActive = false;
  private isMuted = false;

  private pendingOffer: RTCSessionDescriptionInit | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(role: ParticipantRole, callbacks: WebRtcCallCallbacks) {
    this.role = role;
    this.callbacks = callbacks;
  }

  public getIsActive(): boolean {
    return this.isCallActive;
  }

  private setState(state: CallConnectionState, detail?: string) {
    this.callbacks.onStateChange?.(state, detail);
  }

  private createPeerConnection(): RTCPeerConnection {
    this.cleanupPeerOnly();

    const pc = new RTCPeerConnection(RTC_CONFIGURATION);
    this.pc = pc;

    if (this.clonedLocalTrack) {
      const localStream = new MediaStream([this.clonedLocalTrack]);
      this.localSender = pc.addTrack(this.clonedLocalTrack, localStream);
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        void this.callbacks.onSignal("ice-candidate", ev.candidate.toJSON());
      }
    };

    pc.ontrack = (ev) => {
      const stream =
        ev.streams && ev.streams[0]
          ? ev.streams[0]
          : new MediaStream([ev.track]);
      this.callbacks.onRemoteStream?.(stream);
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        if (this.iceRestartTimer) {
          clearTimeout(this.iceRestartTimer);
          this.iceRestartTimer = null;
        }
        this.setState("connected");
      } else if (st === "connecting") {
        this.setState("connecting");
      } else if (st === "disconnected") {
        this.setState("reconnecting", "Voice connection interrupted; retrying...");
        this.scheduleIceRestart();
      } else if (st === "failed") {
        this.setState("reconnecting", "Re-negotiating peer route...");
        void this.triggerIceRestart();
      } else if (st === "closed") {
        this.setState("disconnected");
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" && this.isCallActive) {
        void this.triggerIceRestart();
      }
    };

    return pc;
  }

  private scheduleIceRestart() {
    if (this.iceRestartTimer || this.role !== "host" || !this.isCallActive) {
      return;
    }
    this.iceRestartTimer = setTimeout(() => {
      this.iceRestartTimer = null;
      if (
        this.isCallActive &&
        this.pc &&
        (this.pc.connectionState === "disconnected" ||
          this.pc.connectionState === "failed")
      ) {
        void this.triggerIceRestart();
      }
    }, 2200);
  }

  private async triggerIceRestart() {
    if (!this.isCallActive || this.role !== "host" || !this.pc) return;
    try {
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);
      if (this.pc.localDescription) {
        await this.callbacks.onSignal("offer", this.pc.localDescription.toJSON());
      }
    } catch {
      // Ignore transient negotiation race
    }
  }

  private async flushPendingCandidates() {
    if (!this.pc || !this.pc.remoteDescription) return;
    const queued = this.pendingCandidates.splice(0, this.pendingCandidates.length);
    for (const cand of queued) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        // Ignore stale ICE candidates
      }
    }
  }

  public async startCall(
    sourceMicStream: MediaStream,
    muted = false
  ): Promise<void> {
    if (typeof RTCPeerConnection === "undefined") {
      this.setState("error", "WebRTC is not supported in this browser.");
      return;
    }

    const baseTrack = sourceMicStream.getAudioTracks()[0];
    if (!baseTrack) {
      this.setState("error", "No microphone track available for voice call.");
      return;
    }

    this.isMuted = muted;
    this.stopClonedTrack();
    this.clonedLocalTrack = baseTrack.clone();
    this.clonedLocalTrack.enabled = !muted;
    this.isCallActive = true;
    this.setState("connecting");

    const pc = this.createPeerConnection();

    if (this.role === "host") {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (pc.localDescription) {
          await this.callbacks.onSignal("offer", pc.localDescription.toJSON());
        }
      } catch (err) {
        this.setState(
          "error",
          err instanceof Error ? err.message : "Could not start WebRTC offer."
        );
      }
      return;
    }

    // Guest: if Host already sent an offer before we joined, answer it immediately;
    // also notify Host we're ready in case an offer is needed.
    if (this.pendingOffer) {
      const offer = this.pendingOffer;
      this.pendingOffer = null;
      await this.acceptOffer(offer);
    } else {
      await this.callbacks.onSignal("call-ready", { ts: Date.now() });
    }
  }

  private async acceptOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.isCallActive) return;
    try {
      const pc = this.pc ?? this.createPeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await this.flushPendingCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (pc.localDescription) {
        await this.callbacks.onSignal("answer", pc.localDescription.toJSON());
      }
    } catch (err) {
      this.setState(
        "error",
        err instanceof Error ? err.message : "Failed to accept partner voice call."
      );
    }
  }

  public async handleIncomingSignal(
    kind: WebRtcSignalKind,
    payload: unknown
  ): Promise<void> {
    if (kind === "hangup") {
      this.pendingOffer = null;
      this.pendingCandidates = [];
      this.cleanupPeerOnly();
      if (this.isCallActive) {
        this.setState("connecting");
      }
      this.callbacks.onRemoteEnded?.();
      return;
    }

    if (kind === "call-ready") {
      if (this.role === "host" && this.isCallActive && this.clonedLocalTrack) {
        const pc = this.createPeerConnection();
        try {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          if (pc.localDescription) {
            await this.callbacks.onSignal("offer", pc.localDescription.toJSON());
          }
        } catch {
          // Non-fatal
        }
      }
      return;
    }

    if (kind === "offer" && payload && typeof payload === "object") {
      const offer = payload as RTCSessionDescriptionInit;
      if (!this.isCallActive) {
        // Buffer latest offer until partner taps Start Live Call
        this.pendingOffer = offer;
        this.pendingCandidates = [];
        return;
      }
      await this.acceptOffer(offer);
      return;
    }

    if (kind === "answer" && payload && typeof payload === "object") {
      if (
        this.role === "host" &&
        this.pc &&
        this.pc.signalingState === "have-local-offer"
      ) {
        try {
          await this.pc.setRemoteDescription(
            new RTCSessionDescription(payload as RTCSessionDescriptionInit)
          );
          await this.flushPendingCandidates();
        } catch {
          // Ignore invalid/late answer
        }
      }
      return;
    }

    if (kind === "ice-candidate" && payload && typeof payload === "object") {
      const candidate = payload as RTCIceCandidateInit;
      if (this.pc && this.pc.remoteDescription && this.isCallActive) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // Ignore incompatible candidate
        }
      } else {
        this.pendingCandidates.push(candidate);
        if (this.pendingCandidates.length > 50) {
          this.pendingCandidates.shift();
        }
      }
    }
  }

  public setLocalMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.clonedLocalTrack) {
      this.clonedLocalTrack.enabled = !muted;
    }
  }

  public async replaceLocalStream(sourceMicStream: MediaStream): Promise<void> {
    if (!this.isCallActive) return;
    const baseTrack = sourceMicStream.getAudioTracks()[0];
    if (!baseTrack) return;
    this.stopClonedTrack();
    this.clonedLocalTrack = baseTrack.clone();
    this.clonedLocalTrack.enabled = !this.isMuted;
    if (this.localSender) {
      try {
        await this.localSender.replaceTrack(this.clonedLocalTrack);
      } catch {
        // Non-fatal fallback
      }
    }
  }

  public hangup(sendSignal = true): void {
    const wasActive = this.isCallActive;
    this.isCallActive = false;
    this.pendingOffer = null;
    this.pendingCandidates = [];
    this.cleanupPeerOnly();
    this.stopClonedTrack();
    if (sendSignal && wasActive) {
      void this.callbacks.onSignal("hangup", { ts: Date.now() });
    }
    this.setState("idle");
  }

  private stopClonedTrack() {
    if (this.clonedLocalTrack) {
      try {
        this.clonedLocalTrack.stop();
      } catch {
        // Ignore
      }
      this.clonedLocalTrack = null;
    }
  }

  private cleanupPeerOnly() {
    if (this.iceRestartTimer) {
      clearTimeout(this.iceRestartTimer);
      this.iceRestartTimer = null;
    }
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      this.pc.oniceconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {
        // Ignore
      }
      this.pc = null;
    }
    this.localSender = null;
  }
}
