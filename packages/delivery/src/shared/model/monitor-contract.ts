import { z } from "zod";
import { ImageComponentNameSchema } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { IdentifierSchema } from "#shared/artifact-contract.ts";

/**
 * Monitor (model 4.19): the alarms and evidence threshold an environment must
 * pass after acceptance before its selection counts as settled. A monitor
 * instance belongs to the accepted deployment; its observations and alarms
 * are that deployment's evidence (V3).
 */

/** The only tokens an evidence query may carry; the executor renders them from the accepted artifact. */
export const MONITOR_PLACEHOLDERS = ["window", "version", "gitSha"] as const;
const placeholderPattern = /\$([A-Za-z_]\w*)/gu;

/** Placeholder names in a query that are not in `MONITOR_PLACEHOLDERS`. */
export function unknownMonitorPlaceholders(query: string): string[] {
  const known = new Set<string>(MONITOR_PLACEHOLDERS);
  return [...query.matchAll(placeholderPattern)]
    .map((match) => match[1] ?? "")
    .filter((name) => !known.has(name));
}

export const MonitorQuerySchema = z
  .string()
  .min(1)
  .max(4000)
  .superRefine((query, context) => {
    const unknown = unknownMonitorPlaceholders(query);
    if (unknown.length > 0) {
      context.addIssue({
        code: "custom",
        message: `Monitor queries may only use $window, $version and $gitSha; found $${unknown.join(", $")}`,
      });
    }
  });

const LabelNameSchema = z.string().regex(/^[a-zA-Z_]\w*$/u);
export const AlarmSeveritySchema = z.enum(["info", "warning", "critical"]);
export const MonitorPolicySchema = z.enum(["automatic", "hold"]);
export const MonitorSchema = z.strictObject({
  /** The image component whose accepted artifact renders `$version` and `$gitSha`. */
  component: ImageComponentNameSchema,
  alarms: z.strictObject({
    /** Label matchers over the firing `ALERTS` series; `environment` scopes them to this environment (W5). */
    matchers: z
      .record(LabelNameSchema, z.string().min(1))
      .refine(
        (matchers) => matchers["environment"] !== undefined,
        "Alarm matchers must scope alerts to the environment with an environment label",
      ),
    severities: z
      .array(AlarmSeveritySchema)
      .min(1)
      .default(["warning", "critical"]),
  }),
  /** Evidence counts, each at or above its threshold before the selection settles (W4). */
  evidence: z
    .array(
      z.strictObject({
        key: IdentifierSchema,
        query: MonitorQuerySchema,
        threshold: z.number().int().positive(),
      }),
    )
    .min(1)
    .refine(
      (evidence) =>
        new Set(evidence.map((entry) => entry.key)).size === evidence.length,
      "Evidence keys must be unique",
    ),
  policy: MonitorPolicySchema,
});
export type Monitor = z.infer<typeof MonitorSchema>;

export const MonitorStateSchema = z.enum([
  "unmonitored",
  "watching",
  "settled",
  "alarmed",
]);
export type MonitorState = z.infer<typeof MonitorStateSchema>;

const WindowSchema = z.string().regex(/^[1-9]\d*[smhd]$/u);
export const FiringAlarmSchema = z.strictObject({
  alertname: z.string().min(1),
  severity: AlarmSeveritySchema,
  labels: z.record(LabelNameSchema, z.string()).default({}),
  activeAt: z.iso.datetime().optional(),
});
/** One executor observation of a watching deployment. */
export const MonitorObservationInputSchema = z.strictObject({
  observedAt: z.iso.datetime(),
  /** The `$window` the queries were rendered with, `max(2m, now - acceptedAt)`. */
  window: WindowSchema,
  alarms: z.array(FiringAlarmSchema).default([]),
  evidence: z.record(IdentifierSchema, z.number().nonnegative()),
});
export type MonitorObservationInput = z.infer<
  typeof MonitorObservationInputSchema
>;
export const MonitorOutcomeSchema = z.enum(["watching", "settled", "alarmed"]);
export const MonitorObservationSchema = MonitorObservationInputSchema.extend({
  id: IdentifierSchema,
  deploymentId: IdentifierSchema,
  sequence: z.number().int().positive(),
  outcome: MonitorOutcomeSchema,
  createdAt: z.iso.datetime(),
});
export type MonitorObservation = z.infer<typeof MonitorObservationSchema>;

/** What the executor needs to observe one watching deployment. */
export const WatchingMonitorSchema = z
  .strictObject({
    deploymentId: IdentifierSchema,
    environmentId: IdentifierSchema,
    serviceId: IdentifierSchema,
    acceptedAt: z.iso.datetime(),
    monitor: MonitorSchema,
    artifact: z.strictObject({
      component: ImageComponentNameSchema,
      version: z.string().min(1).max(160),
      gitSha: z.string().regex(/^[a-f0-9]{40}$/u),
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    }),
  })
  .refine(
    (watching) => watching.artifact.component === watching.monitor.component,
    "The rendered artifact must fill the monitored component",
  );
export type WatchingMonitor = z.infer<typeof WatchingMonitorSchema>;

export const MonitorStatusSchema = z
  .strictObject({
    deploymentId: IdentifierSchema.nullable(),
    state: MonitorStateSchema,
    policy: MonitorPolicySchema.nullable(),
    settledAt: z.iso.datetime().nullable(),
    alarmedAt: z.iso.datetime().nullable(),
    observations: z.number().int().nonnegative(),
  })
  .superRefine((status, context) => {
    if (status.state === "settled" && status.settledAt === null) {
      context.addIssue({
        code: "custom",
        message: "A settled monitor records when it settled",
      });
    }
    if (status.state === "alarmed" && status.alarmedAt === null) {
      context.addIssue({
        code: "custom",
        message: "An alarmed monitor records when the alarm fired",
      });
    }
    if ((status.state === "unmonitored") !== (status.policy === null)) {
      context.addIssue({
        code: "custom",
        message: "Only an unmonitored environment has no rollback policy",
      });
    }
  });
export type MonitorStatus = z.infer<typeof MonitorStatusSchema>;

export function renderMonitorQuery(
  query: string,
  values: Record<(typeof MONITOR_PLACEHOLDERS)[number], string>,
): string {
  return query.replaceAll(placeholderPattern, (token, name: string) => {
    switch (name) {
      case "window":
        return values.window;
      case "version":
        return values.version;
      case "gitSha":
        return values.gitSha;
      default:
        throw new Error(`Unknown monitor placeholder ${token}`);
    }
  });
}

/** Pure classification of one observation against its monitor (W1, W2). */
export function monitorOutcome(
  monitor: Monitor,
  observation: MonitorObservationInput,
): z.infer<typeof MonitorOutcomeSchema> {
  const severities = new Set<string>(monitor.alarms.severities);
  if (observation.alarms.some((alarm) => severities.has(alarm.severity))) {
    return "alarmed";
  }
  const settled = monitor.evidence.every(
    (entry) => (observation.evidence[entry.key] ?? 0) >= entry.threshold,
  );
  return settled ? "settled" : "watching";
}
