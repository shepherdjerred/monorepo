/**
 * Requests and responses between `toolkit mc` and the mc-harness daemon over
 * its unix socket. Target passthrough routes reuse the bridge schemas in
 * bridge.ts unchanged, so this file only adds daemon-owned shapes. Nothing
 * here may carry a secret: tokens and RCON passwords stay in sandbox records.
 */
import { z } from "zod";
import type { BlockPos } from "./bridge.ts";

export const ErrorResponseSchema = z.strictObject({ error: z.string() });

export const DaemonStateSchema = z.strictObject({
  pid: z.number().int(),
  startedAt: z.string(),
  ttlSeconds: z.number().int(),
  protocolVersion: z.number().int(),
});
export type DaemonState = z.infer<typeof DaemonStateSchema>;

export const StatusResponseSchema = z.strictObject({
  pid: z.number().int(),
  startedAt: z.string(),
  ttlSeconds: z.number().int(),
  idleSeconds: z.number().int(),
  protocolVersion: z.number().int(),
  repoRoot: z.string(),
  sandboxes: z.number().int(),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

export const ShutdownResponseSchema = z.strictObject({ ok: z.literal(true) });

export const SandboxIdSchema = z.string().regex(/^sbx-[0-9a-f]{6}$/u);
/**
 * `paper`: Paper + WorldEdit + Citizens + MCBridge. `storm-dev`: that plus the
 * locally built TheStorm.jar (gameplay modules without external services).
 * `storm-prod` / `storm-candidate`: the published the-storm-server image at its
 * production or candidate pin, as minecraft-tsmc runs it (offline mode,
 * fixture credentials).
 */
export const ProfileSchema = z.enum([
  "paper",
  "storm-dev",
  "storm-prod",
  "storm-candidate",
]);
export const WorldKindSchema = z.enum(["flat", "void"]);
/** Where a sandbox runs: local Docker, or the homelab cluster's mc-sandbox namespace. */
export const ProviderKindSchema = z.enum(["docker", "kubernetes"]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const SandboxCreateRequestSchema = z.strictObject({
  profile: ProfileSchema,
  world: WorldKindSchema,
  ttlSeconds: z
    .number()
    .int()
    .min(60)
    .max(24 * 60 * 60),
  keep: z.boolean(),
  /** Defaults to the profile's provider (Kubernetes for the storm images). */
  provider: ProviderKindSchema.optional(),
});
export type SandboxCreateRequest = z.infer<typeof SandboxCreateRequestSchema>;

const EndpointSchema = z.strictObject({
  host: z.string(),
  port: z.number().int().positive(),
});

/** A sandbox as the CLI sees it: no token, no RCON password. */
export const SandboxSummarySchema = z.strictObject({
  id: SandboxIdSchema,
  provider: ProviderKindSchema,
  profile: ProfileSchema,
  world: WorldKindSchema,
  status: z.enum(["ready", "stopped"]),
  createdAt: z.string(),
  expiresAt: z.string(),
  keep: z.boolean(),
  bootMs: z.number().int(),
  endpoints: z.strictObject({
    game: EndpointSchema,
    rcon: EndpointSchema,
    bridge: EndpointSchema,
  }),
});
export type SandboxSummary = z.infer<typeof SandboxSummarySchema>;

export const SandboxListResponseSchema = z.strictObject({
  sandboxes: z.array(SandboxSummarySchema),
});
export const SandboxDownResponseSchema = z.strictObject({
  removed: z.array(SandboxIdSchema),
});

export const LogsResponseSchema = z.strictObject({
  lines: z.array(z.string()),
});

/** GET /targets/:id/snapshots/:sid — the .schem bytes, base64. */
export const SnapshotBytesResponseSchema = z.strictObject({
  id: z.string(),
  base64: z.string(),
});

/** Parses `x,y,z` into a block position. */
export function parseBlockPos(raw: string): BlockPos {
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !/^-?\d+$/u.test(part))) {
    throw new Error(`Invalid position "${raw}" — use x,y,z integers`);
  }
  const [x = 0, y = 0, zPos = 0] = parts.map(Number);
  return { x, y, z: zPos };
}
