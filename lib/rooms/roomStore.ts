import { findLanguage } from "@/lib/languages";

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
  data: string;
  sampleRate: number;
  timestamp: number;
}

export type WebRtcSignalKind =
  | "offer"
  | "answer"
  | "ice-candidate"
  | "call-ready"
  | "hangup";

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
  createdAt: number;
  ended: boolean;
  endedAt?: number;
  messages: RoomTranscriptItem[];
  latestAudioSeq: number;
  latestSignalSeq: number;
}

export type RoomServerEvent =
  | { type: "init"; room: PublicRoomSnapshot }
  | { type: "presence"; room: PublicRoomSnapshot }
  | { type: "lang_update"; room: PublicRoomSnapshot }
  | { type: "transcript"; item: RoomTranscriptItem }
  | {
      type: "audio";
      sender: ParticipantRole;
      data: string;
      sampleRate: number;
      seq: number;
    }
  | {
      type: "webrtc_signal";
      seq: number;
      sender: ParticipantRole;
      kind: WebRtcSignalKind;
      payload: unknown;
    }
  | { type: "interrupted"; sender: ParticipantRole }
  | { type: "room_ended"; roomId: string; endedAt: number }
  | { type: "error"; error: string };

interface Subscriber {
  id: string;
  role: ParticipantRole;
  send: (event: RoomServerEvent) => void;
}

interface InternalRoom {
  id: string;
  hostLangCode: string;
  hostLangLabel: string;
  guestLangCode: string;
  guestLangLabel: string;
  createdAt: number;
  updatedAt: number;
  ended: boolean;
  endedAt?: number;
  hostConnections: number;
  guestConnections: number;
  hostLastSeen: number;
  guestLastSeen: number;
  messages: RoomTranscriptItem[];
  audioBuffer: RelayedAudioPacket[];
  audioSeqCounter: number;
  signalBuffer: RelayedSignalPacket[];
  signalSeqCounter: number;
  subscribers: Set<Subscriber>;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const PRESENCE_TTL_MS = 20 * 1000;
const MAX_MESSAGES = 50;
const MAX_AUDIO_BUFFER = 40;
const MAX_SIGNAL_BUFFER = 80;

const globalStore = globalThis as unknown as {
  __earbudRooms?: Map<string, InternalRoom>;
};

function getRoomMap(): Map<string, InternalRoom> {
  if (!globalStore.__earbudRooms) {
    globalStore.__earbudRooms = new Map<string, InternalRoom>();
  }
  return globalStore.__earbudRooms;
}

function pruneExpiredRooms(map: Map<string, InternalRoom>): void {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [id, room] of map.entries()) {
    if (
      room.updatedAt < cutoff &&
      room.hostConnections === 0 &&
      room.guestConnections === 0
    ) {
      map.delete(id);
    }
  }
}

function generateRoomId(map: Map<string, InternalRoom>): string {
  for (let attempt = 0; attempt < 16; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
      code += CODE_ALPHABET[idx];
    }
    if (!map.has(code)) return code;
  }
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function normalizeRoomId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 12);
}

export function isValidRoomId(raw: string): boolean {
  const id = normalizeRoomId(raw);
  return id.length >= 4 && id.length <= 12;
}

export function toSnapshot(room: InternalRoom): PublicRoomSnapshot {
  const now = Date.now();
  return {
    id: room.id,
    hostLangCode: room.hostLangCode,
    hostLangLabel: room.hostLangLabel,
    guestLangCode: room.guestLangCode,
    guestLangLabel: room.guestLangLabel,
    hostConnected:
      !room.ended &&
      (room.hostConnections > 0 || now - room.hostLastSeen < PRESENCE_TTL_MS),
    guestConnected:
      !room.ended &&
      (room.guestConnections > 0 || now - room.guestLastSeen < PRESENCE_TTL_MS),
    createdAt: room.createdAt,
    ended: room.ended,
    endedAt: room.endedAt,
    messages: room.messages,
    latestAudioSeq: room.audioSeqCounter,
    latestSignalSeq: room.signalSeqCounter,
  };
}

function broadcast(room: InternalRoom, event: RoomServerEvent): void {
  for (const sub of room.subscribers) {
    if (
      (event.type === "audio" ||
        event.type === "interrupted" ||
        event.type === "webrtc_signal") &&
      event.sender === sub.role
    ) {
      continue;
    }
    try {
      sub.send(event);
    } catch {
      // Ignore closed stream errors; cleanup handles removal
    }
  }
}

function createInternalRoom(
  id: string,
  hostLangInput?: string,
  guestLangInput?: string
): InternalRoom {
  const map = getRoomMap();
  pruneExpiredRooms(map);

  const hostLang = findLanguage(hostLangInput || "ar");
  const guestLang = findLanguage(guestLangInput || "en");
  const now = Date.now();

  const room: InternalRoom = {
    id,
    hostLangCode: hostLang.code,
    hostLangLabel: hostLang.label,
    guestLangCode: guestLang.code,
    guestLangLabel: guestLang.label,
    createdAt: now,
    updatedAt: now,
    ended: false,
    hostConnections: 0,
    guestConnections: 0,
    hostLastSeen: 0,
    guestLastSeen: 0,
    messages: [],
    audioBuffer: [],
    audioSeqCounter: 0,
    signalBuffer: [],
    signalSeqCounter: 0,
    subscribers: new Set(),
  };

  map.set(id, room);
  return room;
}

export function createRoom(
  hostLangInput?: string,
  guestLangInput?: string
): PublicRoomSnapshot {
  const map = getRoomMap();
  const id = generateRoomId(map);
  return toSnapshot(createInternalRoom(id, hostLangInput, guestLangInput));
}

export function getOrCreateRoom(
  roomId: string,
  opts?: { role?: ParticipantRole; hostLang?: string; guestLang?: string }
): PublicRoomSnapshot | null {
  const id = normalizeRoomId(roomId);
  if (!isValidRoomId(id)) return null;

  const map = getRoomMap();
  let room = map.get(id);
  if (!room) {
    room = createInternalRoom(id, opts?.hostLang, opts?.guestLang);
  }

  const now = Date.now();
  if (opts?.role === "host") {
    room.hostLastSeen = now;
  } else if (opts?.role === "guest") {
    room.guestLastSeen = now;
  }

  return toSnapshot(room);
}

export function getPartnerAudioSince(
  roomId: string,
  viewerRole: ParticipantRole,
  afterSeq: number
): RelayedAudioPacket[] {
  const map = getRoomMap();
  const room = map.get(normalizeRoomId(roomId));
  if (!room) return [];

  return room.audioBuffer.filter(
    (pkt) => pkt.seq > afterSeq && pkt.sender !== viewerRole
  );
}

export function getPartnerSignalsSince(
  roomId: string,
  viewerRole: ParticipantRole,
  afterSeq: number
): RelayedSignalPacket[] {
  const map = getRoomMap();
  const room = map.get(normalizeRoomId(roomId));
  if (!room || room.ended) return [];

  return room.signalBuffer.filter(
    (pkt) => pkt.seq > afterSeq && pkt.sender !== viewerRole
  );
}

export function updateRoomLanguages(
  roomId: string,
  updates: { hostLang?: string; guestLang?: string }
): PublicRoomSnapshot | null {
  const id = normalizeRoomId(roomId);
  if (!isValidRoomId(id)) return null;

  const map = getRoomMap();
  const room = map.get(id) ?? createInternalRoom(id);

  if (updates.hostLang) {
    const lang = findLanguage(updates.hostLang);
    room.hostLangCode = lang.code;
    room.hostLangLabel = lang.label;
  }
  if (updates.guestLang) {
    const lang = findLanguage(updates.guestLang);
    room.guestLangCode = lang.code;
    room.guestLangLabel = lang.label;
  }
  room.updatedAt = Date.now();

  const snap = toSnapshot(room);
  broadcast(room, { type: "lang_update", room: snap });
  return snap;
}

export function subscribeToRoom(
  roomId: string,
  role: ParticipantRole,
  send: (event: RoomServerEvent) => void
): (() => void) | null {
  const id = normalizeRoomId(roomId);
  if (!isValidRoomId(id)) return null;

  const map = getRoomMap();
  const room = map.get(id) ?? createInternalRoom(id);

  const sub: Subscriber = {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    send,
  };

  const now = Date.now();
  room.subscribers.add(sub);
  if (role === "host") {
    room.hostConnections += 1;
    room.hostLastSeen = now;
  } else {
    room.guestConnections += 1;
    room.guestLastSeen = now;
  }
  room.updatedAt = now;

  // Send immediate snapshot to the new subscriber and notify the partner
  send({ type: "init", room: toSnapshot(room) });
  if (room.ended) {
    send({
      type: "room_ended",
      roomId: room.id,
      endedAt: room.endedAt ?? room.updatedAt,
    });
  } else {
    broadcast(room, { type: "presence", room: toSnapshot(room) });
  }

  return () => {
    if (!room.subscribers.delete(sub)) return;
    if (role === "host") {
      room.hostConnections = Math.max(0, room.hostConnections - 1);
      room.hostLastSeen = Date.now();
    } else {
      room.guestConnections = Math.max(0, room.guestConnections - 1);
      room.guestLastSeen = Date.now();
    }
    room.updatedAt = Date.now();
    if (!room.ended) {
      broadcast(room, { type: "presence", room: toSnapshot(room) });
    }
  };
}

export function endRoom(roomId: string): PublicRoomSnapshot | null {
  const id = normalizeRoomId(roomId);
  if (!isValidRoomId(id)) return null;

  const map = getRoomMap();
  const room = map.get(id);
  if (!room) return null;

  if (!room.ended) {
    const now = Date.now();
    room.ended = true;
    room.endedAt = now;
    room.updatedAt = now;
    room.audioBuffer = [];
    broadcast(room, { type: "room_ended", roomId: room.id, endedAt: now });
  }

  return toSnapshot(room);
}

export function relayTranscript(
  roomId: string,
  item: RoomTranscriptItem
): boolean {
  const id = normalizeRoomId(roomId);
  if (!isValidRoomId(id)) return false;

  const map = getRoomMap();
  const room = map.get(id) ?? createInternalRoom(id);
  if (room.ended) return false;

  const now = Date.now();
  room.updatedAt = now;
  if (item.sender === "host") room.hostLastSeen = now;
  else room.guestLastSeen = now;

  const existingIdx = room.messages.findIndex((m) => m.id === item.id);
  if (existingIdx >= 0) {
    room.messages[existingIdx] = item;
  } else {
    room.messages.push(item);
    if (room.messages.length > MAX_MESSAGES) {
      room.messages = room.messages.slice(-MAX_MESSAGES);
    }
  }

  broadcast(room, { type: "transcript", item });
  return true;
}

export function relayAudioChunk(
  roomId: string,
  sender: ParticipantRole,
  data: string,
  sampleRate: number
): number | null {
  const id = normalizeRoomId(roomId);
  if (!isValidRoomId(id)) return null;

  const map = getRoomMap();
  const room = map.get(id) ?? createInternalRoom(id);
  if (room.ended) return null;

  const now = Date.now();
  room.updatedAt = now;
  if (sender === "host") room.hostLastSeen = now;
  else room.guestLastSeen = now;

  const seq = ++room.audioSeqCounter;
  room.audioBuffer.push({ seq, sender, data, sampleRate, timestamp: now });
  if (room.audioBuffer.length > MAX_AUDIO_BUFFER) {
    room.audioBuffer = room.audioBuffer.slice(-MAX_AUDIO_BUFFER);
  }

  broadcast(room, { type: "audio", sender, data, sampleRate, seq });
  return seq;
}

export function relayInterrupted(
  roomId: string,
  sender: ParticipantRole
): boolean {
  const id = normalizeRoomId(roomId);
  if (!isValidRoomId(id)) return false;

  const map = getRoomMap();
  const room = map.get(id) ?? createInternalRoom(id);
  if (room.ended) return false;

  room.updatedAt = Date.now();
  broadcast(room, { type: "interrupted", sender });
  return true;
}

export function relaySignal(
  roomId: string,
  sender: ParticipantRole,
  kind: WebRtcSignalKind,
  payload: unknown
): number | null {
  const id = normalizeRoomId(roomId);
  if (!isValidRoomId(id)) return null;

  const map = getRoomMap();
  const room = map.get(id) ?? createInternalRoom(id);
  if (room.ended) return null;

  const now = Date.now();
  room.updatedAt = now;
  if (sender === "host") room.hostLastSeen = now;
  else room.guestLastSeen = now;

  const seq = ++room.signalSeqCounter;
  room.signalBuffer.push({ seq, sender, kind, payload, timestamp: now });
  if (room.signalBuffer.length > MAX_SIGNAL_BUFFER) {
    room.signalBuffer = room.signalBuffer.slice(-MAX_SIGNAL_BUFFER);
  }

  broadcast(room, { type: "webrtc_signal", seq, sender, kind, payload });
  return seq;
}
