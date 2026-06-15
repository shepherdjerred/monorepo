import {
  activePlayers,
  applyTurn,
  chooseAiTurn,
  createMatch,
  elements,
  standardMatchSettings,
  validateTurn,
  type Element,
  type GameMapId,
  type MatchState,
  type Player,
  type PlayerCount,
  type PlayerId,
  type Turn,
} from "@castle-casters/core";
import type { LobbySnapshot, ServerMessage } from "@castle-casters/core/schemas";

export type RoomPhase = "lobby" | "match" | "complete";

export type RoomSession = {
  clientId: string;
  playerId: PlayerId;
  resumeToken: string;
  connected: boolean;
  lastClientSeq: number;
};

export type ReplayEvent = {
  serverSeq: number;
  type: ServerMessage["type"];
  message: ServerMessage;
  createdAt: string;
};

export type Room = {
  id: string;
  phase: RoomPhase;
  hostPlayerId?: PlayerId;
  mapId: GameMapId;
  playerCount: PlayerCount;
  players: Partial<Record<PlayerId, Player>>;
  sessions: Map<string, RoomSession>;
  match?: MatchState;
  serverSeq: number;
  replay: ReplayEvent[];
};

export type HelloResult = {
  room: Room;
  playerId: PlayerId;
  resumeToken: string;
  messages: ServerMessage[];
};

export class RoomStore {
  private readonly rooms = new Map<string, Room>();

  listRooms(): LobbySnapshot[] {
    return [...this.rooms.values()].map((room) => this.toLobbySnapshot(room));
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  createRoom(options: { mapId?: GameMapId; playerCount?: PlayerCount } = {}): Room {
    const id = crypto.randomUUID();
    const room: Room = {
      id,
      phase: "lobby",
      mapId: options.mapId ?? "grass",
      playerCount: options.playerCount ?? 2,
      players: {},
      sessions: new Map(),
      serverSeq: 0,
      replay: [],
    };
    this.rooms.set(id, room);
    return room;
  }

  hello(roomId: string, input: { clientId: string; name: string; resumeToken?: string }): HelloResult {
    const room = this.mustGetRoom(roomId);
    const resumed = input.resumeToken === undefined ? undefined : [...room.sessions.values()].find((session) => session.resumeToken === input.resumeToken);
    const session = resumed ?? this.createSession(room, input.clientId, input.name);
    session.connected = true;

    const lobby = this.toLobbySnapshot(room);
    const hello = this.record(room, {
      type: "helloAccepted",
      serverSeq: 0,
      playerId: session.playerId,
      resumeToken: session.resumeToken,
      lobby,
    });
    const snapshot = this.record(room, { type: "lobbySnapshot", serverSeq: 0, lobby });
    return { room, playerId: session.playerId, resumeToken: session.resumeToken, messages: [hello, snapshot] };
  }

  disconnect(roomId: string, clientId: string): ServerMessage | undefined {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      return undefined;
    }
    const session = room.sessions.get(clientId);
    if (session !== undefined) {
      session.connected = false;
    }
    return this.record(room, { type: "lobbySnapshot", serverSeq: 0, lobby: this.toLobbySnapshot(room) });
  }

  fillSlotsWithAi(roomId: string): ServerMessage[] {
    const room = this.mustGetRoom(roomId);
    for (const playerId of activePlayers(room.playerCount)) {
      if (room.players[playerId] === undefined) {
        room.players[playerId] = {
          id: playerId,
          kind: "ai",
          name: `AI ${playerId}`,
          element: nextElement(room),
        };
      }
    }
    return [this.record(room, { type: "lobbySnapshot", serverSeq: 0, lobby: this.toLobbySnapshot(room) })];
  }

  startMatch(roomId: string): ServerMessage[] {
    const room = this.mustGetRoom(roomId);
    if (!this.toLobbySnapshot(room).ready) {
      return [this.record(room, { type: "commandRejected", serverSeq: 0, reason: "Room is not ready.", errors: ["All player slots must be filled."] })];
    }
    room.phase = "match";
    room.match = createMatch({
      ...standardMatchSettings(room.playerCount),
      playerCount: room.playerCount,
      boardSize: boardSizeForMap(room.mapId),
    });
    const messages: ServerMessage[] = [this.record(room, { type: "matchStarted", serverSeq: 0, match: room.match })];
    messages.push(...this.runAiTurns(room));
    return messages;
  }

  submitTurn(roomId: string, sessionClientId: string, clientSeq: number, turn: Turn): ServerMessage[] {
    const room = this.mustGetRoom(roomId);
    const match = room.match;
    const session = room.sessions.get(sessionClientId);
    if (match === undefined || session === undefined) {
      return [this.record(room, { type: "turnRejected", serverSeq: 0, clientSeq, errors: ["No active match or session."] })];
    }
    const ownedTurn = { ...turn, playerId: session.playerId } as Turn;
    const validation = validateTurn(match, ownedTurn);
    if (!validation.ok) {
      return [this.record(room, { type: "turnRejected", serverSeq: 0, clientSeq, errors: validation.errors })];
    }
    room.match = applyTurn(match, ownedTurn);
    session.lastClientSeq = clientSeq;
    const messages: ServerMessage[] = [
      this.record(room, { type: "turnAccepted", serverSeq: 0, clientSeq, turn: ownedTurn, match: room.match }),
    ];
    if (room.match.status.type === "victory") {
      room.phase = "complete";
      messages.push(this.record(room, { type: "gameOver", serverSeq: 0, match: room.match }));
      return messages;
    }
    messages.push(...this.runAiTurns(room));
    return messages;
  }

  snapshot(roomId: string): ServerMessage {
    const room = this.mustGetRoom(roomId);
    if (room.match !== undefined) {
      return this.record(room, { type: "matchSnapshot", serverSeq: 0, match: room.match });
    }
    return this.record(room, { type: "lobbySnapshot", serverSeq: 0, lobby: this.toLobbySnapshot(room) });
  }

  toLobbySnapshot(room: Room): LobbySnapshot {
    const sessions = [...room.sessions.values()];
    const players = activePlayers(room.playerCount)
      .map((playerId) => room.players[playerId])
      .filter((player): player is Player => player !== undefined)
      .map((player) => ({
        ...player,
        connected: sessions.some((session) => session.playerId === player.id && session.connected),
      }));
    return {
      roomId: room.id,
      hostPlayerId: room.hostPlayerId,
      mapId: room.mapId,
      playerCount: room.playerCount,
      players,
      ready: players.length === room.playerCount,
    };
  }

  private createSession(room: Room, clientId: string, name: string): RoomSession {
    const slot = activePlayers(room.playerCount).find((playerId) => room.players[playerId] === undefined);
    if (slot === undefined) {
      throw new Error("Room is full.");
    }
    room.hostPlayerId ??= slot;
    room.players[slot] = {
      id: slot,
      kind: "human",
      name,
      element: nextElement(room),
    };
    const session = {
      clientId,
      playerId: slot,
      resumeToken: crypto.randomUUID(),
      connected: true,
      lastClientSeq: 0,
    };
    room.sessions.set(clientId, session);
    return session;
  }

  private runAiTurns(room: Room): ServerMessage[] {
    const messages: ServerMessage[] = [];
    while (room.match?.status.type === "inProgress") {
      const activePlayer = room.players[room.match.activePlayer];
      if (activePlayer?.kind !== "ai") {
        break;
      }
      const result = chooseAiTurn(room.match, room.match.activePlayer, 2);
      room.match = applyTurn(room.match, result.turn);
      messages.push(this.record(room, { type: "turnAccepted", serverSeq: 0, turn: result.turn, match: room.match }));
      if (room.match.status.type === "victory") {
        room.phase = "complete";
        messages.push(this.record(room, { type: "gameOver", serverSeq: 0, match: room.match }));
        break;
      }
    }
    return messages;
  }

  private record<T extends ServerMessage>(room: Room, message: T): T {
    room.serverSeq += 1;
    const stamped = { ...message, serverSeq: room.serverSeq } as T;
    room.replay.push({
      serverSeq: room.serverSeq,
      type: stamped.type,
      message: stamped,
      createdAt: new Date().toISOString(),
    });
    return stamped;
  }

  private mustGetRoom(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      throw new Error(`Unknown room: ${roomId}`);
    }
    return room;
  }
}

function nextElement(room: Room): Element {
  const used = new Set(Object.values(room.players).map((player) => player?.element).filter((element): element is Element => element !== undefined));
  return elements.find((element) => !used.has(element)) ?? "fire";
}

function boardSizeForMap(mapId: GameMapId): number {
  if (mapId === "grassBig" || mapId === "winterSmall" || mapId === "desertSmall") {
    return 11;
  }
  if (mapId === "grassSmall" || mapId === "winterBig" || mapId === "desertBig") {
    return 7;
  }
  return 9;
}
