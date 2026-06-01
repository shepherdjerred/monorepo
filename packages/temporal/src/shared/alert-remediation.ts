import { z } from "zod/v4";

export const AlertRemediationSourceSchema = z.enum(["pagerduty", "bugsink"]);

export const NormalizedAlertSchema = z.object({
  source: AlertRemediationSourceSchema,
  fingerprint: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  severity: z.string().min(1).optional(),
  url: z.url().optional(),
  details: z.record(z.string(), z.unknown()),
});

export const AlertRemediationRepoSchema = z.object({
  fullName: z
    .string()
    .min(1)
    .regex(/^[^/\s]+\/[^/\s]+$/, "repo must be owner/name"),
  ref: z.string().min(1).default("main"),
});

export const AlertRemediationSweepInputSchema = z.object({
  repo: AlertRemediationRepoSchema.default({
    fullName: "shepherdjerred/monorepo",
    ref: "main",
  }),
  provider: z.enum(["claude", "codex"]).default("claude"),
  model: z.string().min(1).optional(),
  maxTurns: z.number().int().positive().default(80),
  concurrency: z.number().int().positive().default(3),
  pagerDutyLimit: z.number().int().positive().default(100),
  bugsinkIssueLimit: z.number().int().positive().default(300),
});

export const AlertRemediationChildInputSchema = z.object({
  alert: NormalizedAlertSchema,
  repo: AlertRemediationRepoSchema,
  provider: z.enum(["claude", "codex"]),
  model: z.string().min(1).optional(),
  maxTurns: z.number().int().positive(),
});

export const AlertRemediationOutcomeSchema = z.enum([
  "pr-created",
  "already-covered",
  "report-only",
  "not-straightforward",
  "verification-failed",
  "failed",
]);

export const AlertRemediationAgentPayloadSchema = z.object({
  outcome: AlertRemediationOutcomeSchema.exclude(["already-covered", "failed"]),
  decision: z.string().min(1),
  reason: z.string().min(1),
  markdown: z.string().min(1),
  prUrl: z.url().optional(),
  branchName: z.string().min(1).optional(),
  verificationCommands: z.array(z.string().min(1)).default([]),
});

export const AlertRemediationChildResultSchema = z.object({
  source: AlertRemediationSourceSchema,
  fingerprint: z.string().min(1),
  title: z.string().min(1),
  outcome: AlertRemediationOutcomeSchema,
  decision: z.string().min(1),
  reason: z.string().min(1),
  markdown: z.string().min(1),
  prUrl: z.url().optional(),
  branchName: z.string().min(1).optional(),
  verificationCommands: z.array(z.string().min(1)).default([]),
});

export const AlertRemediationCollectionFailureSchema = z.object({
  source: AlertRemediationSourceSchema,
  reason: z.string().min(1),
});

export const AlertRemediationCollectionResultSchema = z.object({
  alerts: z.array(NormalizedAlertSchema),
  failures: z.array(AlertRemediationCollectionFailureSchema),
});

export const AlertRemediationSweepResultSchema = z.object({
  inspectedAlerts: z.number().int().nonnegative(),
  startedChildren: z.number().int().nonnegative(),
  skippedDuplicateAlerts: z.number().int().nonnegative(),
  collectionFailures: z.array(AlertRemediationCollectionFailureSchema),
  outcomes: z.array(AlertRemediationChildResultSchema),
  emailSent: z.boolean(),
});

export type AlertRemediationSource = z.infer<
  typeof AlertRemediationSourceSchema
>;
export type NormalizedAlert = z.infer<typeof NormalizedAlertSchema>;
export type AlertRemediationSweepInput = z.infer<
  typeof AlertRemediationSweepInputSchema
>;
export type AlertRemediationSweepRawInput = z.input<
  typeof AlertRemediationSweepInputSchema
>;
export type AlertRemediationChildInput = z.infer<
  typeof AlertRemediationChildInputSchema
>;
export type AlertRemediationOutcome = z.infer<
  typeof AlertRemediationOutcomeSchema
>;
export type AlertRemediationAgentPayload = z.infer<
  typeof AlertRemediationAgentPayloadSchema
>;
export type AlertRemediationChildResult = z.infer<
  typeof AlertRemediationChildResultSchema
>;
export type AlertRemediationCollectionFailure = z.infer<
  typeof AlertRemediationCollectionFailureSchema
>;
export type AlertRemediationCollectionResult = z.infer<
  typeof AlertRemediationCollectionResultSchema
>;
export type AlertRemediationSweepResult = z.infer<
  typeof AlertRemediationSweepResultSchema
>;

export const ALERT_REMEDIATION_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "decision", "reason", "markdown"],
  properties: {
    outcome: {
      type: "string",
      enum: [
        "pr-created",
        "report-only",
        "not-straightforward",
        "verification-failed",
      ],
    },
    decision: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 },
    markdown: { type: "string", minLength: 1 },
    prUrl: { type: "string" },
    branchName: { type: "string", minLength: 1 },
    verificationCommands: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
  },
};

export function sanitizeAlertIdPart(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9_-]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 48) || "alert"
  );
}

export function alertRemediationWorkflowId(alert: NormalizedAlert): string {
  return `alert-remediation/${alert.source}/${sanitizeAlertIdPart(alert.fingerprint)}`;
}
