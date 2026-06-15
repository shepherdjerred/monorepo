import { z } from "zod";

export const playerIdSchema = z.enum(["one", "two", "three", "four"]);
export const elementSchema = z.enum(["fire", "ice", "earth", "wind"]);
export const gameMapIdSchema = z.enum([
  "grass",
  "grassBig",
  "grassSmall",
  "winter",
  "winterBig",
  "winterSmall",
  "desert",
  "desertBig",
  "desertSmall",
  "test",
]);

export const coordinateSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

export const wallLocationSchema = z.object({
  start: coordinateSchema,
  vertex: coordinateSchema,
  end: coordinateSchema,
});

export const turnSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("normalMovePawn"),
    playerId: playerIdSchema,
    source: coordinateSchema,
    destination: coordinateSchema,
  }),
  z.object({
    type: z.literal("jumpPawnStraight"),
    playerId: playerIdSchema,
    source: coordinateSchema,
    pivot: coordinateSchema,
    destination: coordinateSchema,
  }),
  z.object({
    type: z.literal("jumpPawnDiagonal"),
    playerId: playerIdSchema,
    source: coordinateSchema,
    pivot: coordinateSchema,
    destination: coordinateSchema,
  }),
  z.object({
    type: z.literal("placeWall"),
    playerId: playerIdSchema,
    wall: wallLocationSchema,
  }),
]);

export const matchSettingsSchema = z.object({
  wallsPerPlayer: z.number().int().nonnegative(),
  startingPlayer: playerIdSchema,
  playerCount: z.union([z.literal(2), z.literal(4)]),
  boardSize: z.number().int().min(2),
});

export const matchStatusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("inProgress") }),
  z.object({ type: z.literal("victory"), winner: playerIdSchema }),
]);

export const matchSnapshotSchema = z.object({
  settings: matchSettingsSchema,
  activePlayer: playerIdSchema,
  status: matchStatusSchema,
  pawns: z.record(playerIdSchema, coordinateSchema.optional()),
  walls: z.array(wallLocationSchema),
  wallsRemaining: z.record(playerIdSchema, z.number().int().nonnegative()),
  history: z.array(turnSchema),
  version: z.number().int().nonnegative(),
});

export const lobbySnapshotSchema = z.object({
  roomId: z.string(),
  hostPlayerId: playerIdSchema.optional(),
  mapId: gameMapIdSchema,
  playerCount: z.union([z.literal(2), z.literal(4)]),
  players: z.array(
    z.object({
      id: playerIdSchema,
      kind: z.enum(["human", "ai"]),
      name: z.string(),
      element: elementSchema,
      connected: z.boolean(),
    }),
  ),
  ready: z.boolean(),
});

const seqSchema = z.number().int().nonnegative();

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    v: z.literal(1),
    clientId: z.string(),
    name: z.string().min(1),
    resumeToken: z.string().optional(),
    lastServerSeq: seqSchema.optional(),
  }),
  z.object({ type: z.literal("startMatchRequested"), clientSeq: seqSchema }),
  z.object({ type: z.literal("fillSlotsWithAiRequested"), clientSeq: seqSchema }),
  z.object({ type: z.literal("turnSubmitted"), clientSeq: seqSchema, turn: turnSchema }),
  z.object({ type: z.literal("requestSnapshot"), clientSeq: seqSchema }),
  z.object({ type: z.literal("ping"), clientSeq: seqSchema }),
]);

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("helloAccepted"),
    serverSeq: seqSchema,
    playerId: playerIdSchema,
    resumeToken: z.string(),
    lobby: lobbySnapshotSchema,
  }),
  z.object({
    type: z.literal("commandRejected"),
    serverSeq: seqSchema,
    clientSeq: seqSchema.optional(),
    reason: z.string(),
    errors: z.array(z.string()),
  }),
  z.object({ type: z.literal("lobbySnapshot"), serverSeq: seqSchema, lobby: lobbySnapshotSchema }),
  z.object({ type: z.literal("matchStarted"), serverSeq: seqSchema, match: matchSnapshotSchema }),
  z.object({ type: z.literal("turnAccepted"), serverSeq: seqSchema, clientSeq: seqSchema.optional(), turn: turnSchema, match: matchSnapshotSchema }),
  z.object({ type: z.literal("turnRejected"), serverSeq: seqSchema, clientSeq: seqSchema.optional(), errors: z.array(z.string()) }),
  z.object({ type: z.literal("matchSnapshot"), serverSeq: seqSchema, match: matchSnapshotSchema }),
  z.object({ type: z.literal("gameOver"), serverSeq: seqSchema, match: matchSnapshotSchema }),
  z.object({ type: z.literal("pong"), serverSeq: seqSchema, clientSeq: seqSchema.optional() }),
]);

export const gameSaveSchema = z.object({
  version: z.literal(1),
  savedAt: z.string(),
  match: matchSnapshotSchema,
});

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type LobbySnapshot = z.infer<typeof lobbySnapshotSchema>;
export type MatchSnapshot = z.infer<typeof matchSnapshotSchema>;
