import { z } from "zod";

export const RenovateTargetSchema = z.object({
  manager: z.string().min(1),
  datasource: z.string().nullable(),
  packageName: z.string().min(1),
  filePath: z.string().min(1),
  currentValue: z.string().nullable(),
  targetValue: z.string().min(1),
  currentVersion: z.string().nullable(),
  targetVersion: z.string().nullable(),
  currentDigest: z.string().nullable().default(null),
  digest: z.string().nullable(),
});
export type RenovateTarget = z.infer<typeof RenovateTargetSchema>;

const urgency = ["high", "medium", "low"] as const;
const effort = ["xs", "s", "m", "l", "xl", "unknown"] as const;

export const RankedRenovateUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ecosystem: z.string().min(1),
  targets: z.array(RenovateTargetSchema).min(1),
  urgency: z.enum(urgency),
  effort: z.enum(effort),
  needed: z.boolean(),
  rationale: z.string().min(1),
  evidenceUrls: z.array(z.url({ protocol: /^https?$/u })),
  bake: z.object({
    state: z.enum(["ready", "waiting", "unknown"]),
    eligibleAt: z.iso.datetime().nullable(),
    reason: z.string().min(1),
  }),
  blockers: z.array(z.string()),
});
export type RankedRenovateUpdate = z.infer<typeof RankedRenovateUpdateSchema>;

export const RenovateRankingSnapshotSchema = z.object({
  scannedAt: z.iso.datetime(),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/u),
  coverage: z.enum(["complete", "partial"]),
  warnings: z.array(z.string()),
  candidates: z.array(RankedRenovateUpdateSchema),
});
export type RenovateRankingSnapshot = z.infer<
  typeof RenovateRankingSnapshotSchema
>;

export const RenovateDispositionSchema = z.object({
  status: z.enum([
    "queued",
    "blocked",
    "published",
    "merged",
    "closed",
    "landed",
  ]),
  reason: z.string().min(1),
  updatedAt: z.iso.datetime(),
  prUrl: z.url({ protocol: /^https$/u }).optional(),
  revisedEffort: z.literal("l").optional(),
});
export type RenovateDisposition = z.infer<typeof RenovateDispositionSchema>;

export const RenovateRankedQueueSchema = z.object({
  snapshot: RenovateRankingSnapshotSchema,
  dispositions: z.record(z.string(), RenovateDispositionSchema),
});
export type RenovateRankedQueue = z.infer<typeof RenovateRankedQueueSchema>;

export function isRenovateUpdateEligible(
  update: RankedRenovateUpdate,
  now: number,
): boolean {
  return (
    update.needed &&
    effort.indexOf(update.effort) <= effort.indexOf("m") &&
    update.blockers.length === 0 &&
    update.bake.state === "ready" &&
    (update.bake.eligibleAt === null ||
      Date.parse(update.bake.eligibleAt) <= now)
  );
}

export function compareRankedRenovateUpdates(
  left: RankedRenovateUpdate,
  right: RankedRenovateUpdate,
): number {
  const leftEligible =
    left.bake.eligibleAt === null
      ? Number.MIN_SAFE_INTEGER
      : Date.parse(left.bake.eligibleAt);
  const rightEligible =
    right.bake.eligibleAt === null
      ? Number.MIN_SAFE_INTEGER
      : Date.parse(right.bake.eligibleAt);
  return (
    urgency.indexOf(left.urgency) - urgency.indexOf(right.urgency) ||
    effort.indexOf(left.effort) - effort.indexOf(right.effort) ||
    leftEligible - rightEligible ||
    left.id.localeCompare(right.id)
  );
}
