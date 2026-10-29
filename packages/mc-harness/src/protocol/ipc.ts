/**
 * Requests and responses between `toolkit mc` and the mc-harness daemon over
 * its unix socket. Target passthrough routes reuse the bridge schemas in
 * bridge.ts unchanged, so this file only adds daemon-owned shapes. Nothing
 * here may carry a secret: tokens and RCON passwords stay in sandbox records.
 */
import { z } from "zod";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
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
export const WorldKindSchema = z.enum(["flat", "void", "real-map"]);
export const MapSourceSchema = z.strictObject({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  files: z.number().int().positive(),
  bytes: z.number().int().positive(),
  dimensions: z
    .array(z.string().regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/u))
    .min(1)
    .optional(),
});
/** Where a sandbox runs: local Docker, or the homelab cluster's mc-sandbox namespace. */
export const ProviderKindSchema = z.enum(["docker", "kubernetes"]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;
export const CaptureFeatureSchema = z.enum([
  "stargates",
  "quests",
  "shards",
  "arena",
  "rwf",
  "advancements",
]);

const RolloutBootstrapSchema = z.strictObject({
  url: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  }, "Rollout bootstrap requires an uncredentialed HTTPS endpoint"),
  environment: z.enum(["prod", "beta"]),
});

const SandboxCreateInputSchema = z.strictObject({
  profile: ProfileSchema,
  world: WorldKindSchema,
  mapDirectory: z.string().min(1).optional(),
  rollout: RolloutBootstrapSchema.optional(),
  captureFeatures: z.array(CaptureFeatureSchema).min(1).max(6).optional(),
  mapSpawn: z
    .tuple([z.number(), z.number().min(-63).max(318), z.number()])
    .optional(),
  ttlSeconds: z
    .number()
    .int()
    .min(60)
    .max(24 * 60 * 60),
  keep: z.boolean(),
  /** Defaults to the profile's provider (Kubernetes for the storm images). */
  provider: ProviderKindSchema.optional(),
  publishedArtifact: ArtifactVersionSchema.optional(),
  publishedConfig: z
    .strictObject({
      sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      yaml: z
        .string()
        .min(1)
        .max(64 * 1024),
    })
    .optional(),
});

function invalidMapRequest(
  input: z.infer<typeof SandboxCreateInputSchema>,
): boolean {
  return (
    (input.world === "real-map") !== (input.mapDirectory !== undefined) ||
    (input.world === "real-map") !== (input.mapSpawn !== undefined) ||
    (input.world === "real-map" &&
      (input.provider === "kubernetes" || input.profile !== "storm-dev"))
  );
}

export const SandboxCreateRequestSchema = SandboxCreateInputSchema.superRefine(
  (input, context) => {
    if (
      (input.rollout !== undefined || input.captureFeatures !== undefined) &&
      input.world !== "real-map"
    )
      context.addIssue({
        code: "custom",
        message:
          "Capture features and rollout bootstrap require a real-map session",
      });
    if (invalidMapRequest(input))
      context.addIssue({
        code: "custom",
        message:
          "Real-map capture requires a map directory, safe map spawn, and the local Docker storm-dev profile",
      });
    const published =
      input.profile === "storm-prod" || input.profile === "storm-candidate";
    const selected = input.publishedArtifact;
    if (
      published &&
      (selected === undefined ||
        input.publishedConfig === undefined ||
        selected.serviceId !== "minecraft" ||
        selected.component !== "image:the-storm-server" ||
        selected.kind !== "image" ||
        selected.uri !== "docker.io/shepherdjerred/the-storm-server" ||
        selected.origin.kind !== "first-party" ||
        selected.sourceRevision !== input.publishedConfig.sourceRevision ||
        new Bun.CryptoHasher("sha256")
          .update(input.publishedConfig.yaml)
          .digest("hex") !== input.publishedConfig.sha256)
    )
      context.addIssue({
        code: "custom",
        message:
          "Published sandbox requires its exact original Minecraft artifact and matching frozen source configuration",
      });
    if (
      !published &&
      (selected !== undefined || input.publishedConfig !== undefined)
    )
      context.addIssue({
        code: "custom",
        message: "Only published Storm profiles accept a frozen artifact",
      });
  },
);
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
  mapSource: MapSourceSchema.optional(),
  rollout: RolloutBootstrapSchema.optional(),
  captureFeatures: z.array(CaptureFeatureSchema).min(1).max(6).optional(),
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
