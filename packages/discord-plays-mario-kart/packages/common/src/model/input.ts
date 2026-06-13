import { z } from "zod";

// Real-time per-player controller state (hold-based, applied every frame).
export type ButtonState = z.infer<typeof ButtonStateSchema>;
export const ButtonStateSchema = z.strictObject({
  up: z.boolean(),
  down: z.boolean(),
  left: z.boolean(),
  right: z.boolean(),
  a: z.boolean(),
  b: z.boolean(),
  start: z.boolean(),
  z: z.boolean(),
  l: z.boolean(),
  r: z.boolean(),
  cUp: z.boolean(),
  cDown: z.boolean(),
  cLeft: z.boolean(),
  cRight: z.boolean(),
});

export type PlayerInputState = z.infer<typeof PlayerInputStateSchema>;
export const PlayerInputStateSchema = z.strictObject({
  buttons: ButtonStateSchema,
  analogX: z.number().min(-1).max(1), // steering
  analogY: z.number().min(-1).max(1),
});

export const EMPTY_BUTTONS: ButtonState = {
  up: false,
  down: false,
  left: false,
  right: false,
  a: false,
  b: false,
  start: false,
  z: false,
  l: false,
  r: false,
  cUp: false,
  cDown: false,
  cLeft: false,
  cRight: false,
};
export const EMPTY_INPUT: PlayerInputState = {
  buttons: EMPTY_BUTTONS,
  analogX: 0,
  analogY: 0,
};

// ---- requests (client -> server) ----
export type InputRequest = z.infer<typeof InputRequestSchema>;
export const InputRequestSchema = z.strictObject({
  kind: z.literal("input"),
  seat: z.number().int().min(0).max(3),
  state: PlayerInputStateSchema,
});

export type SeatClaimRequest = z.infer<typeof SeatClaimRequestSchema>;
export const SeatClaimRequestSchema = z.strictObject({
  kind: z.literal("seat-claim"),
  seat: z.number().int().min(0).max(3).optional(), // omit -> auto-assign
});

export type SeatReleaseRequest = z.infer<typeof SeatReleaseRequestSchema>;
export const SeatReleaseRequestSchema = z.strictObject({
  kind: z.literal("seat-release"),
});

// Client-measured socket round-trip time, reported periodically so the server
// can export it as a metric. Client-side measurement avoids clock skew — the
// browser times its own ping/ack round trip.
export type LatencyReportRequest = z.infer<typeof LatencyReportRequestSchema>;
export const LatencyReportRequestSchema = z.strictObject({
  kind: z.literal("latency-report"),
  rttMs: z.number().min(0).max(60_000),
});

// ---- responses (server -> client) ----
export type SeatResponse = z.infer<typeof SeatResponseSchema>;
export const SeatResponseSchema = z.strictObject({
  kind: z.literal("seat"),
  value: z.strictObject({ seat: z.number().int().min(0).max(3).nullable() }),
});

export type SeatsResponse = z.infer<typeof SeatsResponseSchema>;
export const SeatsResponseSchema = z.strictObject({
  kind: z.literal("seats"),
  value: z.strictObject({
    occupied: z.array(z.boolean()),
    // Display name per seat (index-aligned with `occupied`); null = unnamed.
    names: z.array(z.string().nullable()),
  }),
});
