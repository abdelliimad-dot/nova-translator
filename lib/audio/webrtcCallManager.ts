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
  onIceStateChange?: (iceState: RTCIceConnectionState) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onRemoteVideoStream?: (stream: MediaStream | null) => void;
  onRemoteVideoActiveChange?: (active: boolean) => void;
  onRemoteEnded?: () => void;
  onSignal: (kind: WebRtcSignalKind, payload: unknown) => Promise<void> | void;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export function buildRtcConfiguration(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [...DEFAULT_ICE_SERVERS];
  const turnUrlRaw = process.env.NEXT_PUBLIC_TURN_URL?.trim();
  if (turnUrlRaw) {
    const urls = turnUrlRaw
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length > 0) {
      const username = process.env.NEXT_PUBLIC_TURN_USERNAME?.trim();
      const credential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL?.trim();
      iceServers.push({
        urls: urls.length === 1 ? urls[0] : urls,
        ...(username ? { username } : {}),
        ...(credential ? { credential } : {}),
      });
    }
  }

  return {
    iceServers,
    iceCandidatePoolSize: 10,
  };
}

const CALL_READY_RETRY_MS = 2500;

/**
 * Manages a peer-to-peer WebRTC voice & optional video call layered cleanly alongside
 * the room's Gemini Live translation stream using SSE/polling signaling.
 * - Uses only a cloned audio track from MicManager (never opens a competing audio getUserMedia).
 * - Retries "call-ready" every 2.5s until connected so Host/Guest start order never stalls.
 * - Triggers clean SDP renegotiation when toggling video mid-call from either peer.
 */
export class WebRtcCallManager {
  private role: ParticipantRole;
  private callbacks: WebRtcCallCallbacks;
  private pc: RTCPeerConnection | null = null;
  private clonedLocalTrack: MediaStreamTrack | null = null;
  private localVideoTrack: MediaStreamTrack | null = null;
  private localSender: RTCRtpSender | null = null;
  private localVideoSender: RTCRtpSender | null = null;
  private isCallActive = false;
  private isMuted = false;

  private pendingOffer: RTCSessionDescriptionInit | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private callReadyTimer: ReturnType<typeof setInterval> | null = null;
  private makingOffer = false;
  private lastAnswerAt = 0;

  constructor(role: ParticipantRole, callbacks: WebRtcCallCallbacks) {
    this.role = role;
    this.callbacks = callbacks;
  }

  public setRole(role: ParticipantRole): void {
    this.role = role;
  }

  public getIsActive(): boolean {
    return this.isCallActive;
  }

  private setState(state: CallConnectionState, detail?: string) {
    this.callbacks.onStateChange?.(state, detail);
  }

  private stopCallReadyRetry() {
    if (this.callReadyTimer) {
      clearInterval(this.callReadyTimer);
      this.callReadyTimer = null;
    }
  }

  private startCallReadyRetry() {
    this.stopCallReadyRetry();
    if (!this.isCallActive) return;

    const emitReady = () => {
      if (!this.isCallActive || this.pc?.connectionState === "connected") {
        this.stopCallReadyRetry();
        return;
      }
      void this.callbacks.onSignal("call-ready", { ts: Date.now() });
    };

    emitReady();
    this.callReadyTimer = setInterval(emitReady, CALL_READY_RETRY_MS);
  }

  private async relayOffer(
    pc: RTCPeerConnection,
    options?: RTCOfferOptions
  ): Promise<void> {
    if (this.makingOffer) return;
    this.makingOffer = true;
    try {
      const offer = await pc.createOffer(options);
      if (pc.signalingState !== "stable" && !options?.iceRestart) {
        return;
      }
      await pc.setLocalDescription(offer);
      if (pc.localDescription) {
        await this.callbacks.onSignal("offer", pc.localDescription.toJSON());
      }
    } finally {
      this.makingOffer = false;
    }
  }

  private hasActiveNegotiatedVideoTransceiver(pc: RTCPeerConnection): boolean {
    if (!this.localVideoSender) return false;
    const transceiver = pc
      .getTransceivers()
      .find((t) => t.sender === this.localVideoSender);
    if (!transceiver) return false;
    const dir = transceiver.currentDirection;
    return dir === "sendrecv" || dir === "sendonly";
  }

  private createPeerConnection(): RTCPeerConnection {
    this.cleanupPeerOnly();

    const pc = new RTCPeerConnection(buildRtcConfiguration());
    this.pc = pc;
    this.callbacks.onIceStateChange?.(pc.iceConnectionState);

    if (this.clonedLocalTrack) {
      const localStream = new MediaStream([this.clonedLocalTrack]);
      this.localSender = pc.addTrack(this.clonedLocalTrack, localStream);
    }

    if (this.localVideoTrack && this.localVideoTrack.readyState === "live") {
      const vidStream = new MediaStream([this.localVideoTrack]);
      this.localVideoSender = pc.addTrack(this.localVideoTrack, vidStream);
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        void this.callbacks.onSignal("ice-candidate", ev.candidate.toJSON());
      }
    };

    pc.ontrack = (ev) => {
      if (ev.track.kind === "audio") {
        const audioStream =
          ev.streams && ev.streams[0]
            ? ev.streams[0]
            : new MediaStream([ev.track]);
        this.callbacks.onRemoteStream?.(audioStream);
        return;
      }

      if (ev.track.kind === "video") {
        const videoStream =
          ev.streams && ev.streams[0]
            ? ev.streams[0]
            : new MediaStream([ev.track]);
        this.callbacks.onRemoteVideoStream?.(videoStream);
        this.callbacks.onRemoteVideoActiveChange?.(true);

        ev.track.onunmute = () => {
          const updatedStream =
            ev.streams && ev.streams[0]
              ? ev.streams[0]
              : new MediaStream([ev.track]);
          this.callbacks.onRemoteVideoStream?.(updatedStream);
          this.callbacks.onRemoteVideoActiveChange?.(true);
        };
        ev.track.onended = () => {
          this.callbacks.onRemoteVideoActiveChange?.(false);
          this.callbacks.onRemoteVideoStream?.(null);
        };
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      console.info(`[WebRTC:${this.role}] connectionState=${st}`);
      if (st === "connected") {
        this.stopCallReadyRetry();
        if (this.iceRestartTimer) {
          clearTimeout(this.iceRestartTimer);
          this.iceRestartTimer = null;
        }
        this.setState("connected");
      } else if (st === "connecting") {
        this.setState("connecting");
      } else if (st === "disconnected") {
        this.setState("reconnecting", "Call connection interrupted; retrying...");
        this.scheduleIceRestart();
      } else if (st === "failed") {
        this.setState("reconnecting", "ICE connection failed; re-negotiating peer route...");
        void this.triggerIceRestart();
      } else if (st === "closed") {
        this.stopCallReadyRetry();
        this.setState("disconnected");
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.info(`[WebRTC:${this.role}] iceConnectionState=${iceState}`);
      this.callbacks.onIceStateChange?.(iceState);
      if (iceState === "checking" && pc.connectionState !== "connected") {
        this.setState("connecting", "Checking peer connection route...");
      } else if (iceState === "failed" && this.isCallActive) {
        this.setState(
          "reconnecting",
          "ICE traversal failed; attempting ICE restart..."
        );
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
      await this.relayOffer(this.pc, { iceRestart: true });
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
    muted = false,
    localVideoTrack: MediaStreamTrack | null = null
  ): Promise<void> {
    if (typeof RTCPeerConnection === "undefined") {
      this.setState("error", "WebRTC is not supported in this browser.");
      return;
    }

    const baseTrack =
      sourceMicStream.getAudioTracks().find((t) => t.readyState === "live") ??
      sourceMicStream.getAudioTracks()[0];
    if (!baseTrack || baseTrack.readyState !== "live") {
      this.setState("error", "No live microphone track available for call.");
      return;
    }

    this.isMuted = muted;
    this.stopClonedTrack();
    this.clonedLocalTrack = baseTrack.clone();
    this.clonedLocalTrack.enabled = !muted;
    this.localVideoTrack =
      localVideoTrack && localVideoTrack.readyState === "live"
        ? localVideoTrack
        : null;
    this.isCallActive = true;
    this.setState("connecting");

    const pc = this.createPeerConnection();

    if (this.localVideoTrack) {
      void this.callbacks.onSignal("video-state", { active: true });
    }

    this.startCallReadyRetry();

    if (this.role === "host") {
      try {
        await this.relayOffer(pc);
      } catch (err) {
        this.setState(
          "error",
          err instanceof Error ? err.message : "Could not start WebRTC offer."
        );
      }
      return;
    }

    if (this.pendingOffer) {
      const offer = this.pendingOffer;
      this.pendingOffer = null;
      await this.acceptOffer(offer);
    }
  }

  public async setLocalVideoTrack(
    nextTrack: MediaStreamTrack | null
  ): Promise<void> {
    this.localVideoTrack =
      nextTrack && nextTrack.readyState === "live" ? nextTrack : null;

    if (!this.pc || !this.isCallActive) {
      return;
    }

    if (!this.localVideoTrack) {
      if (this.localVideoSender) {
        try {
          await this.localVideoSender.replaceTrack(null);
        } catch {
          // Non-fatal if sender transitioned
        }
      }
      void this.callbacks.onSignal("video-state", { active: false });
      return;
    }

    const alreadyNegotiated = this.hasActiveNegotiatedVideoTransceiver(this.pc);

    if (this.localVideoSender) {
      try {
        await this.localVideoSender.replaceTrack(this.localVideoTrack);
      } catch {
        // Non-fatal if sender transitioned
      }
      const transceiver = this.pc
        .getTransceivers()
        .find((t) => t.sender === this.localVideoSender);
      if (transceiver && transceiver.direction !== "sendrecv") {
        transceiver.direction = "sendrecv";
      }
    } else {
      const vidStream = new MediaStream([this.localVideoTrack]);
      this.localVideoSender = this.pc.addTrack(this.localVideoTrack, vidStream);
    }

    void this.callbacks.onSignal("video-state", { active: true });

    if (!alreadyNegotiated && this.pc.signalingState === "stable") {
      try {
        await this.relayOffer(this.pc);
      } catch {
        // Retry cleanly on next ICE/call-ready if peer is still connecting
      }
    }
  }

  private async acceptOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.isCallActive) return;
    try {
      const pc = this.pc ?? this.createPeerConnection();
      const polite = this.role === "guest";
      const offerCollision =
        this.makingOffer || pc.signalingState !== "stable";

      if (offerCollision) {
        if (!polite) {
          // Host drops colliding offer while an offer is already in flight
          return;
        }
        await pc.setLocalDescription({ type: "rollback" });
      }

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
        err instanceof Error ? err.message : "Failed to accept partner call."
      );
    }
  }

  public async handleIncomingSignal(
    kind: WebRtcSignalKind,
    payload: unknown
  ): Promise<void> {
    if (kind === "video-state" && payload && typeof payload === "object") {
      const active = Boolean((payload as { active?: unknown }).active);
      this.callbacks.onRemoteVideoActiveChange?.(active);
      if (!active) {
        this.callbacks.onRemoteVideoStream?.(null);
      }
      return;
    }

    if (kind === "hangup") {
      this.pendingOffer = null;
      this.pendingCandidates = [];
      this.cleanupPeerOnly();
      if (this.isCallActive) {
        this.setState("connecting");
        this.startCallReadyRetry();
      }
      this.callbacks.onRemoteVideoActiveChange?.(false);
      this.callbacks.onRemoteVideoStream?.(null);
      this.callbacks.onRemoteEnded?.();
      return;
    }

    if (kind === "call-ready") {
      if (this.role === "host" && this.isCallActive && this.clonedLocalTrack) {
        if (this.pc?.connectionState === "connected") {
          return;
        }
        // Avoid disrupting a brand-new ICE check that just received an answer
        if (
          this.pc &&
          this.pc.remoteDescription &&
          this.pc.signalingState === "stable" &&
          this.pc.iceConnectionState === "checking" &&
          Date.now() - this.lastAnswerAt < 4500
        ) {
          return;
        }

        const pc = this.createPeerConnection();
        try {
          await this.relayOffer(pc);
          if (this.localVideoTrack) {
            void this.callbacks.onSignal("video-state", { active: true });
          }
        } catch {
          // Retry on next 2.5s call-ready pulse
        }
      }
      return;
    }

    if (kind === "offer" && payload && typeof payload === "object") {
      const offer = payload as RTCSessionDescriptionInit;
      if (!this.isCallActive) {
        this.pendingOffer = offer;
        this.pendingCandidates = [];
        return;
      }
      await this.acceptOffer(offer);
      return;
    }

    if (kind === "answer" && payload && typeof payload === "object") {
      if (this.pc && this.pc.signalingState === "have-local-offer") {
        try {
          await this.pc.setRemoteDescription(
            new RTCSessionDescription(payload as RTCSessionDescriptionInit)
          );
          this.lastAnswerAt = Date.now();
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
    const baseTrack =
      sourceMicStream.getAudioTracks().find((t) => t.readyState === "live") ??
      sourceMicStream.getAudioTracks()[0];
    if (!baseTrack || baseTrack.readyState !== "live") return;
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
    this.stopCallReadyRetry();
    this.pendingOffer = null;
    this.pendingCandidates = [];
    this.localVideoTrack = null;
    this.cleanupPeerOnly();
    this.stopClonedTrack();
    if (sendSignal && wasActive) {
      void this.callbacks.onSignal("hangup", { ts: Date.now() });
    }
    this.callbacks.onRemoteVideoActiveChange?.(false);
    this.callbacks.onRemoteVideoStream?.(null);
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
    this.makingOffer = false;
    this.lastAnswerAt = 0;
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
    this.callbacks.onIceStateChange?.("closed");
    this.localSender = null;
    this.localVideoSender = null;
  }
}
