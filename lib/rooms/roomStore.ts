import { findLanguage, SUPPORTED_LANGUAGES } from "@/lib/languages";
import {
  constantTimeEqual,
  generateRandomToken,
  generateReadableCode,
  type RoomAuthPayload,
} from "@/lib/security/authCrypto";

export type ParticipantRole = "host" | "guest";

export interface RoomTranscriptItem {
  id: string;
  sender: ParticipantRole;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  isFinal: boolean;
  timestamp: number;
}

export interface RelayedAudioPacket {
  seq: number;
  sender: ParticipantRole;
  sampleRate: number;
  data: string; // base64 Int16 PCM
  turnId?: string;
  timestamp: number;
}

export type WebRtcSignalKind =
  | "offer"
  | "answer"
  | "ice-candidate"
  | "call-ready"
  | "hangup"
  | "video-state";

export interface RelayedSignalPacket {
  seq: number;
  sender: ParticipantRole;
  kind: WebRtcSignalKind;
  payload: unknown;
  timestamp: number;
}

export interface PublicRoomSnapshot {
  id: string;
  hostLangCode: string;
  hostLangLabel: string;
  guestLangCode: string;
  guestLangLabel: string;
  hostConnected: boolean;
  guestConnected: boolean;
  ended: boolean;
  createdAt: number;
  lastActivityAt: number;
  latestAudioSeq: number;
  latestSignalSeq: number;
  messages: RoomTranscriptItem[];
}

export type RoomServerEvent =
  | { type: "init"; room: PublicRoomSnapshot }
  | { type: "presence"; room: PublicRoomSnapshot }
  | { type: "lang_update"; room: PublicRoomSnapshot }
  | { type: "transcript"; item: RoomTranscriptItem }
  | ({ type: "audio" } & RelayedAudioPacket)
  | { type: "interrupted"; sender: ParticipantRole }
  | ({ type: "webrtc_signal" } & RelayedSignalPacket)
  | { type: "room_ended"; room: PublicRoomSnapshot };

export type RoomAuthCheckResult =
  | { ok: true; room: InternalRoom; role: ParticipantRole }
  | { ok: false; status: 403 | 404 | 410; error: string };

interface Subscriber {
  id: string;
  role: ParticipantRole;
  credId: string;
  send: (event: RoomServerEvent) => void;
  close?: () => void;
}

export interface InternalRoom {
  id: string;
  hostLangCode: string;
  guestLangCode: string;
  hostCredId: string;
  guestCredId: string | null;
  inviteToken: string;
  inviteTokenConsumed: boolean;
  passcode: string;
  failedJoinTimestamps: number[];
  revokedCredIds: Set<string>;
  hostSubscribers: Map<string, Subscriber>;
  guestSubscribers: Map<string, Subscriber>;
  hostLastSeenAt: number;
  guestLastSeenAt: number;
  ended: boolean;
  endedAt: number | null;
  createdAt: number;
  lastActivityAt: number;
  messages: RoomTranscriptItem[];
  audioSeq: number;
  audioBuffer: RelayedAudioPacket[];
  signalSeq: number;
  signalBuffer: RelayedSignalPacket[];
}

const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const ENDED_RETENTION_MS = 5 * 60 * 1000; // 5 minutes before ended record is purged
const PRESENCE_TIMEOUT_MS = 25 * 1000;
const FAILED_JOIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_ROOM_FAILED_JOINS = 15;
const MAX_MESSAGES = 80;
const MAX_AUDIO_PACKETS = 60;
const MAX_SIGNAL_PACKETS = 40;
const MAX_ROOMS = 2000;
const MAX_TRANSCRIPT_CHARS = 2000;
const MAX_AUDIO_BASE64_CHARS = 96_000;
const MAX_SIGNAL_JSON_CHARS = 16_384;

const SUPPORTED_CODE_SET = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));
const ALLOWED_SIGNAL_KINDS = new Set<WebRtcSignalKind>([
  "offer",
  "answer",
  "ice-candidate",
  "call-ready",
  "hangup",
  "video-state",
]);

const globalForRooms = globalThis as unknown as {
  __novaRoomsStore?: Map<string, InternalRoom>;
};

function getStore(): Map<string, InternalRoom> {
  if (!globalForRooms.__novaRoomsStore) {
    globalForRooms.__novaRoomsStore = new Map();
  }
  return globalForRooms.__novaRoomsStore;
}

export function isStrictSupportedLanguageCode(code: unknown): code is string {
  return (
    typeof code === "string" &&
    SUPPORTED_CODE_SET.has(code.trim().toLowerCase())
  );
}

function cleanupExpiredRooms(): void {
  const store = getStore();
  const now = Date.now();
  for (const [id, room] of store.entries()) {
    const expiredActive = !room.ended && now - room.lastActivityAt > ROOM_TTL_MS;
    const expiredEnded =
      room.ended &&
      room.endedAt !== null &&
      now - room.endedAt > ENDED_RETENTION_MS;
    if (expiredActive || expiredEnded) {
      for (const sub of room.hostSubscribers.values()) sub.close?.();
      for (const sub of room.guestSubscribers.values()) sub.close?.();
      store.delete(id);
    }
  }
}

export function normalizeRoomId(raw: string): string {
  return raw.trim().replace(/[\s-]+/g, "").toUpperCase();
}

export function isValidRoomId(raw: string): boolean {
  const clean = normalizeRoomId(raw);
  return /^[A-Z0-9]{10,20}$/.test(clean);
}

function isParticipantConnected(
  subscribers: Map<string, Subscriber>,
  lastSeenAt: number
): boolean {
  if (subscribers.size > 0) return true;
  if (lastSeenAt > 0 && Date.now() - lastSeenAt < PRESENCE_TIMEOUT_MS) {
    return true;
  }
  return false;
}

export function toSnapshot(room: InternalRoom): PublicRoomSnapshot {
  return {
    id: room.id,
    hostLangCode: room.hostLangCode,
    hostLangLabel: findLanguage(room.hostLangCode).label,
    guestLangCode: room.guestLangCode,
    guestLangLabel: findLanguage(room.guestLangCode).label,
    hostConnected: isParticipantConnected(
      room.hostSubscribers,
      room.hostLastSeenAt
    ),
    guestConnected: isParticipantConnected(
      room.guestSubscribers,
      room.guestLastSeenAt
    ),
    ended: room.ended,
    createdAt: room.createdAt,
    lastActivityAt: room.lastActivityAt,
    latestAudioSeq: room.audioSeq,
    latestSignalSeq: room.signalSeq,
    messages: room.messages,
  };
}

function touchParticipantPresence(
  room: InternalRoom,
  role: ParticipantRole
): void {
  const now = Date.now();
  room.lastActivityAt = now;
  if (role === "host") {
    room.hostLastSeenAt = now;
  } else {
    room.guestLastSeenAt = now;
  }
}

function broadcast(
  room: InternalRoom,
  event: RoomServerEvent,
  targetRole?: ParticipantRole
): void {
  if (!targetRole || targetRole === "host") {
    for (const sub of room.hostSubscribers.values()) {
      try {
        sub.send(event);
      } catch {
        // Ignore stale subscriber write
      }
    }
  }
  if (!targetRole || targetRole === "guest") {
    for (const sub of room.guestSubscribers.values()) {
      try {
        sub.send(event);
      } catch {
        // Ignore stale subscriber write
      }
    }
  }
}

export function createRoom(hostLang: string, guestLang: string): InternalRoom {
  cleanupExpiredRooms();
  const store = getStore();

  // Bound total rooms stored in memory under heavy traffic
  if (store.size >= MAX_ROOMS) {
    const oldestKey = store.keys().next().value;
    if (oldestKey) {
      store.delete(oldestKey);
    }
  }

  let roomId = generateReadableCode(14);
  while (store.has(roomId)) {
    roomId = generateReadableCode(14);
  }

  const now = Date.now();
  const cleanHostLang = hostLang.trim().toLowerCase();
  const cleanGuestLang = guestLang.trim().toLowerCase();

  const room: InternalRoom = {
    id: roomId,
    hostLangCode: SUPPORTED_CODE_SET.has(cleanHostLang) ? cleanHostLang : "ar",
    guestLangCode: SUPPORTED_CODE_SET.has(cleanGuestLang)
      ? cleanGuestLang
      : "en",
    hostCredId: generateRandomToken(12),
    guestCredId: null,
    inviteToken: generateRandomToken(16),
    inviteTokenConsumed: false,
    passcode: generateReadableCode(6),
    failedJoinTimestamps: [],
    revokedCredIds: new Set(),
    hostSubscribers: new Map(),
    guestSubscribers: new Map(),
    hostLastSeenAt: now,
    guestLastSeenAt: 0,
    ended: false,
    endedAt: null,
    createdAt: now,
    lastActivityAt: now,
    messages: [],
    audioSeq: 0,
    audioBuffer: [],
    signalSeq: 0,
    signalBuffer: [],
  };

  store.set(room.id, room);
  return room;
}

/**
 * Look up an existing room without implicit creation.
 */
export function getExistingRoom(roomIdRaw: string): InternalRoom | null {
  cleanupExpiredRooms();
  const roomId = normalizeRoomId(roomIdRaw);
  if (!isValidRoomId(roomId)) return null;
  return getStore().get(roomId) ?? null;
}

/**
 * Verify a caller's signed room token against an active room's current credentials.
 */
export function authorizeRoomAccess(
  roomIdRaw: string,
  auth: RoomAuthPayload | null
): RoomAuthCheckResult {
  const room = getExistingRoom(roomIdRaw);
  if (!room) {
    return { ok: false, status: 404, error: "Room not found or expired." };
  }
  if (room.ended) {
    return { ok: false, status: 410, error: "This room has ended." };
  }
  if (!auth || auth.roomId !== room.id) {
    return {
      ok: false,
      status: 403,
      error: "Not authorized for this room.",
    };
  }
  if (room.revokedCredIds.has(auth.credId)) {
    return {
      ok: false,
      status: 403,
      error: "Room access credential has been revoked.",
    };
  }

  if (auth.role === "host") {
    if (!constantTimeEqual(auth.credId, room.hostCredId)) {
      return {
        ok: false,
        status: 403,
        error: "Invalid host credential for this room.",
      };
    }
    return { ok: true, room, role: "host" };
  }

  if (
    !room.guestCredId ||
    !constantTimeEqual(auth.credId, room.guestCredId)
  ) {
    return {
      ok: false,
      status: 403,
      error: "Invalid guest credential for this room.",
    };
  }
  return { ok: true, room, role: "guest" };
}

export type JoinRoomResult =
  | { ok: true; room: InternalRoom; role: ParticipantRole; credId: string }
  | {
      ok: false;
      status: 403 | 404 | 409 | 410 | 429;
      error: string;
      retryAfterSeconds?: number;
    };

/**
 * Authenticate a guest joining via one-time QR invite token or manual passcode,
 * or re-confirm an already-authenticated room participant.
 */
export function joinRoomAsGuest(
  roomIdRaw: string,
  options: {
    inviteToken?: string;
    passcode?: string;
    existingAuth?: RoomAuthPayload | null;
  }
): JoinRoomResult {
  const room = getExistingRoom(roomIdRaw);
  if (!room) {
    return { ok: false, status: 404, error: "Room not found or expired." };
  }
  if (room.ended) {
    return { ok: false, status: 410, error: "This room has ended." };
  }

  // Allow existing authorized participant to re-confirm seamlessly
  if (options.existingAuth && options.existingAuth.roomId === room.id) {
    const authCheck = authorizeRoomAccess(room.id, options.existingAuth);
    if (authCheck.ok) {
      touchParticipantPresence(room, authCheck.role);
      return {
        ok: true,
        room,
        role: authCheck.role,
        credId: options.existingAuth.credId,
      };
    }
  }

  const now = Date.now();
  room.failedJoinTimestamps = room.failedJoinTimestamps.filter(
    (t) => now - t < FAILED_JOIN_WINDOW_MS
  );
  if (room.failedJoinTimestamps.length >= MAX_ROOM_FAILED_JOINS) {
    const oldest = room.failedJoinTimestamps[0] ?? now;
    return {
      ok: false,
      status: 429,
      error: "Too many failed join attempts for this room. Please try again later.",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((FAILED_JOIN_WINDOW_MS - (now - oldest)) / 1000)
      ),
    };
  }

  const providedInvite =
    typeof options.inviteToken === "string"
      ? options.inviteToken.trim()
      : "";
  const providedPasscode =
    typeof options.passcode === "string"
      ? options.passcode.trim().replace(/[\s-]+/g, "").toUpperCase()
      : "";

  const rawInviteMatched =
    providedInvite.length > 0 &&
    constantTimeEqual(providedInvite, room.inviteToken);
  if (rawInviteMatched && room.inviteTokenConsumed) {
    return {
      ok: false,
      status: 403,
      error:
        "This QR invite link has already been used. Ask the host for the room PIN or a new room.",
    };
  }

  const inviteMatched = rawInviteMatched && !room.inviteTokenConsumed;
  const passcodeMatched =
    providedPasscode.length > 0 &&
    constantTimeEqual(providedPasscode, room.passcode);

  if (!inviteMatched && !passcodeMatched) {
    room.failedJoinTimestamps.push(now);
    return {
      ok: false,
      status: 403,
      error: "Invalid invite link or room passcode.",
    };
  }

  const guestCurrentlyActive = isParticipantConnected(
    room.guestSubscribers,
    room.guestLastSeenAt
  );
  if (room.guestCredId && guestCurrentlyActive) {
    return {
      ok: false,
      status: 409,
      error: "A partner is already connected to this room.",
    };
  }

  // Rotate previous inactive guest credential if any and consume one-time invite
  if (room.guestCredId) {
    room.revokedCredIds.add(room.guestCredId);
  }
  if (inviteMatched) {
    room.inviteTokenConsumed = true;
  }
  room.failedJoinTimestamps = [];

  const credId = generateRandomToken(12);
  room.guestCredId = credId;
  touchParticipantPresence(room, "guest");
  broadcast(room, { type: "presence", room: toSnapshot(room) });

  return { ok: true, room, role: "guest", credId };
}

export function touchRoomParticipantPoll(
  room: InternalRoom,
  role: ParticipantRole
): PublicRoomSnapshot {
  const wasHostConnected = isParticipantConnected(
    room.hostSubscribers,
    room.hostLastSeenAt
  );
  const wasGuestConnected = isParticipantConnected(
    room.guestSubscribers,
    room.guestLastSeenAt
  );

  touchParticipantPresence(room, role);
  const snap = toSnapshot(room);

  if (
    snap.hostConnected !== wasHostConnected ||
    snap.guestConnected !== wasGuestConnected
  ) {
    broadcast(room, { type: "presence", room: snap });
  }
  return snap;
}

export function getPartnerAudioSince(
  room: InternalRoom,
  role: ParticipantRole,
  afterSeq: number
): RelayedAudioPacket[] {
  return room.audioBuffer.filter(
    (pkt) => pkt.sender !== role && pkt.seq > afterSeq
  );
}

export function getPartnerSignalsSince(
  room: InternalRoom,
  role: ParticipantRole,
  afterSeq: number
): RelayedSignalPacket[] {
  return room.signalBuffer.filter(
    (pkt) => pkt.sender !== role && pkt.seq > afterSeq
  );
}

export function updateRoomLanguages(
  room: InternalRoom,
  updates: { hostLang?: string; guestLang?: string }
): PublicRoomSnapshot {
  if (updates.hostLang && isStrictSupportedLanguageCode(updates.hostLang)) {
    room.hostLangCode = updates.hostLang.trim().toLowerCase();
  }
  if (updates.guestLang && isStrictSupportedLanguageCode(updates.guestLang)) {
    room.guestLangCode = updates.guestLang.trim().toLowerCase();
  }
  room.lastActivityAt = Date.now();
  const snap = toSnapshot(room);
  broadcast(room, { type: "lang_update", room: snap });
  return snap;
}

export function subscribeToRoom(
  room: InternalRoom,
  role: ParticipantRole,
  credId: string,
  send: (event: RoomServerEvent) => void,
  close?: () => void
): () => void {
  const id = generateRandomToken(9);
  const sub: Subscriber = { id, role, credId, send, close };

  if (role === "host") {
    room.hostSubscribers.set(id, sub);
  } else {
    room.guestSubscribers.set(id, sub);
  }
  touchParticipantPresence(room, role);

  send({ type: "init", room: toSnapshot(room) });
  broadcast(room, { type: "presence", room: toSnapshot(room) });

  return () => {
    if (role === "host") {
      room.hostSubscribers.delete(id);
    } else {
      room.guestSubscribers.delete(id);
    }
    if (!room.ended) {
      broadcast(room, { type: "presence", room: toSnapshot(room) });
    }
  };
}

export function endRoom(room: InternalRoom): PublicRoomSnapshot {
  room.ended = true;
  room.endedAt = Date.now();
  room.lastActivityAt = room.endedAt;
  room.revokedCredIds.add(room.hostCredId);
  if (room.guestCredId) {
    room.revokedCredIds.add(room.guestCredId);
  }
  room.audioBuffer = [];
  room.signalBuffer = [];
  const snap = toSnapshot(room);
  broadcast(room, { type: "room_ended", room: snap });
  for (const sub of room.hostSubscribers.values()) sub.close?.();
  for (const sub of room.guestSubscribers.values()) sub.close?.();
  room.hostSubscribers.clear();
  room.guestSubscribers.clear();
  return snap;
}

export function relayTranscript(
  room: InternalRoom,
  verifiedRole: ParticipantRole,
  rawItem: Record<string, unknown>
):
  | { ok: true; item: RoomTranscriptItem }
  | { ok: false; status?: 400 | 403; error: string } {
  const id = typeof rawItem.id === "string" ? rawItem.id.trim() : "";
  const sourceText =
    typeof rawItem.sourceText === "string" ? rawItem.sourceText : "";
  const translatedText =
    typeof rawItem.translatedText === "string" ? rawItem.translatedText : "";
  const sourceLang =
    typeof rawItem.sourceLang === "string"
      ? rawItem.sourceLang.trim().toLowerCase()
      : "";
  const targetLang =
    typeof rawItem.targetLang === "string"
      ? rawItem.targetLang.trim().toLowerCase()
      : "";
  const isFinal = Boolean(rawItem.isFinal);
  const timestamp =
    typeof rawItem.timestamp === "number" && Number.isFinite(rawItem.timestamp)
      ? rawItem.timestamp
      : Date.now();

  if (!id || id.length > 96) {
    return { ok: false, error: "Invalid transcript item id." };
  }
  if (
    sourceText.length > MAX_TRANSCRIPT_CHARS ||
    translatedText.length > MAX_TRANSCRIPT_CHARS
  ) {
    return { ok: false, error: "Transcript message exceeds maximum length." };
  }
  if (
    !isStrictSupportedLanguageCode(sourceLang) ||
    !isStrictSupportedLanguageCode(targetLang)
  ) {
    return { ok: false, error: "Unsupported transcript language code." };
  }

  const item: RoomTranscriptItem = {
    id,
    sender: verifiedRole,
    sourceText,
    translatedText,
    sourceLang,
    targetLang,
    isFinal,
    timestamp,
  };

  touchParticipantPresence(room, verifiedRole);

  const existingIdx = room.messages.findIndex((m) => m.id === item.id);
  if (existingIdx >= 0) {
    if (room.messages[existingIdx].sender !== verifiedRole) {
      return {
        ok: false,
        status: 403,
        error: "Cannot overwrite partner transcript entry.",
      };
    }
    room.messages[existingIdx] = item;
  } else {
    room.messages.push(item);
    if (room.messages.length > MAX_MESSAGES) {
      room.messages = room.messages.slice(-MAX_MESSAGES);
    }
  }

  broadcast(room, { type: "transcript", item });
  return { ok: true, item };
}

export function relayAudioChunk(
  room: InternalRoom,
  verifiedRole: ParticipantRole,
  sampleRateRaw: unknown,
  dataRaw: unknown,
  turnIdRaw?: unknown
): { ok: true; packet: RelayedAudioPacket } | { ok: false; error: string } {
  if (typeof dataRaw !== "string" || !dataRaw || dataRaw.length > MAX_AUDIO_BASE64_CHARS) {
    return { ok: false, error: "Invalid or oversized audio chunk." };
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(dataRaw)) {
    return { ok: false, error: "Audio chunk must be valid base64." };
  }

  const turnId =
    typeof turnIdRaw === "string" && turnIdRaw.trim().length > 0 && turnIdRaw.trim().length <= 96
      ? turnIdRaw.trim()
      : undefined;

  const sampleRate =
    typeof sampleRateRaw === "number" &&
    Number.isFinite(sampleRateRaw) &&
    sampleRateRaw >= 8000 &&
    sampleRateRaw <= 48000
      ? Math.round(sampleRateRaw)
      : 24000;

  touchParticipantPresence(room, verifiedRole);
  room.audioSeq += 1;
  const packet: RelayedAudioPacket = {
    seq: room.audioSeq,
    sender: verifiedRole,
    sampleRate,
    data: dataRaw,
    ...(turnId ? { turnId } : {}),
    timestamp: Date.now(),
  };

  room.audioBuffer.push(packet);
  if (room.audioBuffer.length > MAX_AUDIO_PACKETS) {
    room.audioBuffer = room.audioBuffer.slice(-MAX_AUDIO_PACKETS);
  }

  const recipient: ParticipantRole = verifiedRole === "host" ? "guest" : "host";
  broadcast(room, { type: "audio", ...packet }, recipient);
  return { ok: true, packet };
}

export function relayInterrupted(
  room: InternalRoom,
  verifiedRole: ParticipantRole
): void {
  touchParticipantPresence(room, verifiedRole);
  const recipient: ParticipantRole = verifiedRole === "host" ? "guest" : "host";
  broadcast(room, { type: "interrupted", sender: verifiedRole }, recipient);
}

export function relaySignal(
  room: InternalRoom,
  verifiedRole: ParticipantRole,
  kindRaw: unknown,
  payload: unknown
): { ok: true; packet: RelayedSignalPacket } | { ok: false; error: string } {
  if (
    typeof kindRaw !== "string" ||
    !ALLOWED_SIGNAL_KINDS.has(kindRaw as WebRtcSignalKind)
  ) {
    return { ok: false, error: "Invalid WebRTC signal kind." };
  }

  let serializedLen = 0;
  try {
    serializedLen = JSON.stringify(payload ?? null).length;
  } catch {
    return { ok: false, error: "Unserializable WebRTC signal payload." };
  }
  if (serializedLen > MAX_SIGNAL_JSON_CHARS) {
    return { ok: false, error: "WebRTC signal payload exceeds size limit." };
  }

  touchParticipantPresence(room, verifiedRole);
  room.signalSeq += 1;
  const packet: RelayedSignalPacket = {
    seq: room.signalSeq,
    sender: verifiedRole,
    kind: kindRaw as WebRtcSignalKind,
    payload: payload ?? null,
    timestamp: Date.now(),
  };

  room.signalBuffer.push(packet);
  if (room.signalBuffer.length > MAX_SIGNAL_PACKETS) {
    room.signalBuffer = room.signalBuffer.slice(-MAX_SIGNAL_PACKETS);
  }

  const recipient: ParticipantRole = verifiedRole === "host" ? "guest" : "host";
  broadcast(room, { type: "webrtc_signal", ...packet }, recipient);
  return { ok: true, packet };
}
