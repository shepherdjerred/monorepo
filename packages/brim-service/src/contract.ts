import { z } from "zod";

const label = z.string().trim().min(1).max(500);
const cocoaDate = z.number().min(0).max(4_000_000_000);
const nullableDate = cocoaDate.nullish();
const percentage = z.number().min(0).max(100);
const provider = z.enum([
  "claude-code",
  "codex",
  "antigravity",
  "cursor",
  "grok",
  "kimi",
  "muse",
]);
const platform = z.enum(["openai", "anthropic"]);
const empty = z.strictObject({});

// Match QuotaBarCore's Codable enum shape and reference-date timestamps.
const windowKind = z.union([
  z.strictObject({
    rolling: z.strictObject({
      durationSeconds: z.number().int().positive().nullish(),
    }),
  }),
  z.strictObject({ weekly: empty }),
  z.strictObject({ monthly: empty }),
  z.strictObject({ modelScoped: z.strictObject({ model: label }) }),
  z.strictObject({ credits: empty }),
  z.strictObject({ providerDefined: empty }),
  z.strictObject({ entitlement: empty }),
]);
const freshness = z.union([
  z.strictObject({ current: empty }),
  z.strictObject({ stale: z.strictObject({ reason: label }) }),
]);
const usageWindow = z.strictObject({
  id: label,
  label,
  kind: windowKind,
  usedPercent: percentage.nullish(),
  resetAt: nullableDate,
  sourceTimestamp: cocoaDate,
});
export const QuotaSnapshotSchema = z.strictObject({
  provider,
  accountLabel: label.nullish(),
  plan: z
    .strictObject({
      name: label,
      monthlyCostUSD: z.number().int().nonnegative().nullish(),
    })
    .nullish(),
  windows: z.array(usageWindow).max(100),
  resets: z
    .array(z.strictObject({ exp: cocoaDate }))
    .max(100)
    .optional(),
  resetErrorMessage: label.nullish(),
  notes: z.array(label).max(100).optional(),
  sourceTimestamp: cocoaDate,
  freshness: freshness.optional(),
});
export const BillingSnapshotSchema = z.strictObject({
  platform,
  workspaceNames: z.array(label).max(1000),
  monthlySpend: z.number().nonnegative(),
  projectedSpend: z.number().nonnegative(),
  sourceTimestamp: cocoaDate,
  creditsRemaining: z.number().nonnegative().nullish(),
  creditGrants: z
    .array(
      z.strictObject({
        kind: z.enum(["purchased", "granted", "unspecified"]),
        remainingUSD: z.number().nonnegative(),
        expiresAt: nullableDate,
      }),
    )
    .max(1000),
  creditGrantsUnavailableReason: label.nullish(),
});
export const QuotaHistorySampleSchema = z.strictObject({
  provider,
  windowID: label,
  label,
  kind: windowKind,
  usedPercent: percentage,
  recordedAt: cocoaDate,
  resetAt: nullableDate,
});

const status = z.enum([
  "current",
  "sign_in_required",
  "unavailable",
  "disabled",
]);
const reportedStatus = z.union([status, z.literal("not_reporting")]);

export const QuotaReadingSchema = z.strictObject({
  provider,
  status: reportedStatus,
  snapshot: QuotaSnapshotSchema.optional(),
});
export const BillingReadingSchema = z.strictObject({
  platform,
  status: reportedStatus,
  snapshot: BillingSnapshotSchema.optional(),
});

const quotaPublication = QuotaReadingSchema.extend({ status }).refine(
  (reading) =>
    reading.status === "current"
      ? reading.snapshot?.provider === reading.provider &&
        (reading.snapshot.freshness === undefined ||
          "current" in reading.snapshot.freshness)
      : reading.snapshot === undefined,
  "Only a current quota reading may include a snapshot for its provider",
);
const billingPublication = BillingReadingSchema.extend({ status }).refine(
  (reading) =>
    reading.status === "current"
      ? reading.snapshot?.platform === reading.platform
      : reading.snapshot === undefined,
  "Only a current billing reading may include a snapshot for its platform",
);

export const MacBookPublicationSchema = z
  .strictObject({
    version: z.literal(1),
    collectedAt: cocoaDate,
    quotas: z.array(quotaPublication).max(provider.options.length),
    billing: z.array(billingPublication).max(platform.options.length),
    quotaHistory: z.array(QuotaHistorySampleSchema).max(150_000),
  })
  .refine(
    ({ quotas, billing }) =>
      new Set(quotas.map((reading) => reading.provider)).size ===
        quotas.length &&
      new Set(billing.map((reading) => reading.platform)).size ===
        billing.length,
    "Each provider and platform may appear once per publication",
  );

export const Priority = z.enum(["p0", "p1", "p2", "p3", "p4", "later"]);
export const CoreId = z.string().regex(/^[\w-]{1,128}$/u);
export const TerminalId = z.string().regex(/^t\d{1,20}$/u);
const priorityMetadata = {
  title: label.optional(),
  machineName: label.optional(),
};
export const PriorityPutSchema = z.strictObject({
  priority: Priority,
  ...priorityMetadata,
  expectedRevision: z.number().int().nonnegative().optional(),
});
export const PriorityDeleteSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative().optional(),
  ended: z.boolean().optional(),
});
export const PriorityImportSchema = z.strictObject({
  source: z.enum(["macbook", "other"]),
  priorities: z
    .array(
      z.strictObject({
        coreId: CoreId,
        terminalId: TerminalId,
        priority: Priority,
        ...priorityMetadata,
      }),
    )
    .max(1000),
});
export const PriorityStateSchema = z.strictObject({
  coreId: CoreId,
  terminalId: TerminalId,
  priority: Priority.nullable(),
  ended: z.boolean(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime().nullable(),
  ...priorityMetadata,
});

export const ArchiveStatusSchema = z.strictObject({
  lastSuccessfulSyncAt: z.iso.datetime().nullable(),
  devices: z.array(
    z.strictObject({
      machineId: label,
      displayName: label,
      lastArchivedAt: z.iso.datetime().nullable(),
      lastIndexedAt: z.iso.datetime().nullable(),
    }),
  ),
});

export type QuotaSnapshot = z.infer<typeof QuotaSnapshotSchema>;
export type BillingReading = z.infer<typeof BillingReadingSchema>;
export type QuotaReading = z.infer<typeof QuotaReadingSchema>;
export type QuotaHistorySample = z.infer<typeof QuotaHistorySampleSchema>;
export type MacBookPublication = z.infer<typeof MacBookPublicationSchema>;
export type PriorityLevel = z.infer<typeof Priority>;
export type PriorityState = z.infer<typeof PriorityStateSchema>;
export type PriorityImport = z.infer<typeof PriorityImportSchema>;
export type PriorityPut = z.infer<typeof PriorityPutSchema>;
export type PriorityDelete = z.infer<typeof PriorityDeleteSchema>;
export type ArchiveStatus = Readonly<{
  lastSuccessfulSyncAt: string | null;
  devices: readonly Readonly<
    z.infer<typeof ArchiveStatusSchema>["devices"][number]
  >[];
}>;
