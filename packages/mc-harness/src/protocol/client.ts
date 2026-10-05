import { z } from "zod";
import { ConnectedClientStateShape } from "./client-socket.ts";
import { GameModeSchema } from "./bridge.ts";
import { SandboxIdSchema } from "./ipc.ts";

/**
 * The real rendered Minecraft client (the-storm's Fabric preview mod), owned
 * by the daemon. Unlike Citizens actors it is a genuine client session: it
 * renders, takes keyboard-style input and runs client-side game logic, so it
 * can capture what a player actually sees.
 *
 * Daemon routes: GET/POST /clients, GET/DELETE /clients/:name and
 * POST /clients/:name/:action.
 */

/** Offline-mode player names: 3–16 letters, digits or underscores. */
export const ClientNameSchema = z
  .string()
  .regex(/^\w{3,16}$/u, "client names are 3-16 letters, digits or underscores");

export const DEFAULT_CLIENT_NAME = "HarnessClient";

/** Keys a `move` request holds; `attack` and `use` hold the mouse buttons. */
export const CLIENT_BUTTONS = [
  "forward",
  "back",
  "left",
  "right",
  "jump",
  "sneak",
  "sprint",
  "attack",
  "use",
] as const;
export const ClientButtonSchema = z.enum(CLIENT_BUTTONS);

// The real client joins over offline-mode loopback, so live tsmc (online mode)
// is never a target: only sandbox ids are accepted.
export const ClientStartRequestSchema = z.strictObject({
  target: SandboxIdSchema,
  name: ClientNameSchema,
  /** Ops the player through the bridge once it joins. */
  op: z.boolean().default(false),
  gameMode: GameModeSchema.optional(),
});
export type ClientStartRequest = z.infer<typeof ClientStartRequestSchema>;

export const ClientSummarySchema = z.strictObject({
  name: ClientNameSchema,
  target: SandboxIdSchema,
  /** Loopback game endpoint the client joined. */
  server: z.string(),
  /** Launcher (Gradle runClient) process; `state.pid` is the game JVM. */
  pid: z.number().int(),
  startedAt: z.string(),
  /** Captures, client.log and commands.jsonl. */
  artifacts: z.string(),
});
export type ClientSummary = z.infer<typeof ClientSummarySchema>;

const ItemSchema = z.object({
  slot: z.number().int(),
  type: z.string(),
  count: z.number().int(),
  name: z.string(),
});

/** The client's own `status` view; extra fields pass through. */
export const ClientStateSchema = z.discriminatedUnion("connected", [
  z.looseObject({ connected: z.literal(false), screen: z.string() }),
  z.looseObject({
    ...ConnectedClientStateShape,
    connected: z.literal(true),
    inventory: z.array(ItemSchema),
  }),
]);
export type ClientState = z.infer<typeof ClientStateSchema>;

export const ClientStatusResponseSchema = z.strictObject({
  client: ClientSummarySchema,
  state: ClientStateSchema,
});
export type ClientStatusResponse = z.infer<typeof ClientStatusResponseSchema>;

export const ClientListResponseSchema = z.strictObject({
  clients: z.array(ClientSummarySchema),
});

export const ClientLookRequestSchema = z.strictObject({
  yaw: z.number().min(-360).max(360),
  pitch: z.number().min(-90).max(90),
});
export const ClientMoveRequestSchema = z.strictObject({
  buttons: z.array(ClientButtonSchema).min(1),
  /** Client ticks (20 per second) to hold the buttons. */
  ticks: z.number().int().min(1).max(100),
});
export const ClientHotbarRequestSchema = z.strictObject({
  slot: z.number().int().min(0).max(8),
});
export const ClientCommandRequestSchema = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^/\r\n][^\r\n]*$/u, "commands omit the slash and newlines"),
});
export const ClientCaptureRequestSchema = z.strictObject({
  /** Absolute .png path to copy the capture to. */
  out: z
    .string()
    .regex(/^\/.*\.png$/u, "out must be an absolute .png path")
    .optional(),
});

export const ClientActionSchema = z.enum([
  "look",
  "move",
  "hotbar",
  "command",
  "use",
  "attack",
  "release",
]);
export type ClientAction = z.infer<typeof ClientActionSchema>;

export const CLIENT_ACTION_REQUEST_SCHEMAS = {
  look: ClientLookRequestSchema,
  move: ClientMoveRequestSchema,
  hotbar: ClientHotbarRequestSchema,
  command: ClientCommandRequestSchema,
  use: z.strictObject({}),
  attack: z.strictObject({}),
  release: z.strictObject({}),
} as const satisfies Record<ClientAction, z.ZodType>;

export const ClientActionResponseSchema = z.strictObject({
  detail: z.string(),
});
export const ClientCaptureResponseSchema = z.strictObject({
  /** The PNG: `out` when given, otherwise the session's artifacts dir. */
  path: z.string(),
});
export const ClientStopResponseSchema = z.strictObject({
  stopped: z.array(ClientNameSchema),
});
