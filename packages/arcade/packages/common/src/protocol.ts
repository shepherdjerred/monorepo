import { z } from "zod";
import {
  DiscordIdSchema,
  GameIdSchema,
  PlayerSchema,
  SessionViewSchema,
  games,
} from "./catalog.ts";
import { GameEventSchema, GameStateSchema } from "./telemetry.ts";

export const ControllerSchema = z.strictObject({
  buttons: z
    .array(
      z.enum([
        "a",
        "b",
        "x",
        "y",
        "z",
        "l",
        "r",
        "start",
        "up",
        "down",
        "left",
        "right",
        "c-up",
        "c-down",
        "c-left",
        "c-right",
      ]),
    )
    .max(20),
  stickX: z.number().min(-1).max(1),
  stickY: z.number().min(-1).max(1),
  cStickX: z.number().min(-1).max(1),
  cStickY: z.number().min(-1).max(1),
  triggerL: z.number().min(0).max(1),
  triggerR: z.number().min(0).max(1),
});
export type ControllerState = z.infer<typeof ControllerSchema>;
export const neutralController: ControllerState = {
  buttons: [],
  stickX: 0,
  stickY: 0,
  cStickX: 0,
  cStickY: 0,
  triggerL: 0,
  triggerR: 0,
};

export const RoomRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("subscribe"),
    guildId: DiscordIdSchema,
    gameId: GameIdSchema,
  }),
  z.strictObject({
    kind: z.literal("claim"),
    sessionId: z.uuid(),
    seat: z.number().int().min(0).max(3),
  }),
  z.strictObject({ kind: z.literal("release"), sessionId: z.uuid() }),
  z.strictObject({
    kind: z.literal("input"),
    sessionId: z.uuid(),
    state: ControllerSchema,
  }),
  z.strictObject({
    kind: z.literal("command"),
    sessionId: z.uuid(),
    command: z.string().min(1).max(1000),
  }),
]);
export type RoomRequest = z.infer<typeof RoomRequestSchema>;

export const RoomSnapshotSchema = z
  .strictObject({
    guildId: DiscordIdSchema,
    gameId: GameIdSchema,
    session: SessionViewSchema.nullable(),
    state: GameStateSchema.nullable(),
    seats: z.array(PlayerSchema.nullable()).max(4),
    events: z.array(GameEventSchema).max(30),
    participants: z.array(PlayerSchema),
    error: z.string().nullable(),
  })
  .superRefine((room, context) => {
    if (room.state !== null && room.state.family !== games[room.gameId].family)
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Game telemetry family does not match its room",
      });
    if (room.seats.length !== games[room.gameId].seats)
      context.addIssue({
        code: "custom",
        path: ["seats"],
        message: "Controller count does not match its game",
      });
    if (
      room.session !== null &&
      (room.session.gameId !== room.gameId ||
        room.session.guildId !== room.guildId)
    )
      context.addIssue({
        code: "custom",
        path: ["session"],
        message: "Session does not belong to this room",
      });
  });
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;

export const AccessSchema = z.strictObject({
  sessionId: z.uuid().nullable(),
  seat: z.number().int().min(0).max(3).nullable(),
  canPlay: z.boolean(),
  canWatch: z.boolean(),
  canStop: z.boolean(),
  reason: z.string().nullable(),
});
export type Access = z.infer<typeof AccessSchema>;

export const ServersSchema = z.array(
  z.strictObject({
    id: DiscordIdSchema,
    name: z.string(),
    voiceChannelName: z.string().nullable(),
  }),
);
