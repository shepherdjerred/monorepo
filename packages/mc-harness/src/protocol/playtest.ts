/**
 * Playtest runs between `toolkit mc playtest` and the daemon, and the report
 * every run writes to ~/.toolkit/mc/runs/<runId>/report.json.
 */
import { z } from "zod";
import { ActorObservationSchema, BridgeEventSchema } from "./bridge.ts";
import { ProfileSchema, SandboxIdSchema, WorldKindSchema } from "./ipc.ts";

export const RunIdSchema = z.string().regex(/^pt-\d{8}-\d{6}-[0-9a-f]{4}$/u);

/** POST /playtests: run each file in order on one target. */
export const PlaytestRunRequestSchema = z.strictObject({
  /** Absolute paths of `*.playtest.ts` files. */
  files: z.array(z.string().startsWith("/")).min(1).max(50),
  /** Existing sandbox; otherwise one is created for the run and removed after. */
  target: SandboxIdSchema.optional(),
  /** Profile for a created sandbox; defaults to the first scenario's first required profile. */
  profile: ProfileSchema.optional(),
  world: WorldKindSchema.optional(),
  /** Keep a created sandbox after the run. */
  keep: z.boolean(),
  /** Only run scenarios whose name contains this text. */
  grep: z.string().min(1).optional(),
});
export type PlaytestRunRequest = z.infer<typeof PlaytestRunRequestSchema>;

/** What `child.ts describe` prints: the scenario's static metadata. */
export const ScenarioMetaSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string(),
  requires: z.strictObject({
    profiles: z.array(ProfileSchema),
    plugins: z.array(z.string()),
    capabilities: z.array(z.enum(["worldedit", "citizens"])),
  }),
  timeoutMs: z.number().int().positive(),
  /** Declared actor names, so the daemon can clean up after a killed run. */
  actors: z.array(z.string()),
});
export type ScenarioMeta = z.infer<typeof ScenarioMetaSchema>;

export const PlaytestStatusSchema = z.enum([
  "passed",
  "failed",
  "errored",
  "timedOut",
  "skipped",
]);
export type PlaytestStatus = z.infer<typeof PlaytestStatusSchema>;

export const PlaytestReportSchema = z.strictObject({
  runId: RunIdSchema,
  dir: z.string(),
  scenario: z.strictObject({
    name: z.string(),
    description: z.string(),
    file: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  }),
  target: z.strictObject({ id: z.string(), profile: ProfileSchema }),
  startedAt: z.string(),
  durationMs: z.number().int(),
  status: PlaytestStatusSchema,
  /** Why the run was skipped or errored before any step ran. */
  reason: z.string().optional(),
  steps: z.array(
    z.strictObject({
      name: z.string(),
      status: z.enum(["passed", "failed", "errored"]),
      durationMs: z.number().int(),
      error: z.string().optional(),
    }),
  ),
  assertions: z.array(
    z.strictObject({
      description: z.string(),
      passed: z.boolean(),
      detail: z.string().optional(),
    }),
  ),
  notes: z.array(z.string()),
  failure: z
    .strictObject({
      message: z.string(),
      stack: z.string().optional(),
      step: z.string().optional(),
      observations: z.record(
        z.string(),
        z.union([
          ActorObservationSchema,
          z.strictObject({ error: z.string() }),
        ]),
      ),
      eventTail: z.array(BridgeEventSchema),
      logTail: z.array(z.string()),
    })
    .optional(),
  artifacts: z.array(
    z.strictObject({
      name: z.string(),
      path: z.string(),
      bytes: z.number().int(),
    }),
  ),
});
export type PlaytestReport = z.infer<typeof PlaytestReportSchema>;

export const PlaytestRunResponseSchema = z.strictObject({
  target: z.string(),
  /** True when the daemon created the sandbox and removed it afterwards. */
  removedTarget: z.boolean(),
  reports: z.array(PlaytestReportSchema),
});
export type PlaytestRunResponse = z.infer<typeof PlaytestRunResponseSchema>;

/** GET /playtests */
export const PlaytestListResponseSchema = z.strictObject({
  runs: z.array(
    z.strictObject({
      runId: RunIdSchema,
      scenario: z.string(),
      status: PlaytestStatusSchema,
      startedAt: z.string(),
      durationMs: z.number().int(),
    }),
  ),
});

/** Exit code for a set of runs: 0 all passed/skipped, 1 any failed, 2 any errored or timed out. */
export function playtestExitCode(statuses: readonly PlaytestStatus[]): number {
  if (
    statuses.some((status) => status === "errored" || status === "timedOut")
  ) {
    return 2;
  }
  return statuses.includes("failed") ? 1 : 0;
}
