import { App, Chart } from "cdk8s";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createPrometheusMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/prometheus.ts";

const BANNED_SUMMARY_LABELS = [
  "instance",
  "pod",
  "persistentvolumeclaim",
  "pvc",
  "serial_number",
  "serial",
  "device_model",
  "model",
  "deployment",
  "workflow_type",
  "workflowType",
  "workflow",
  "activityType",
  "activity_type",
  "taskqueue",
  "task_queue",
  "job",
  "container",
  "dataset",
] as const;

const BANNED_SUMMARY_LABEL_RE = new RegExp(
  String.raw`\$labels\.(?:${BANNED_SUMMARY_LABELS.join("|")})\b`,
  "u",
);

const RuleSchema = z.looseObject({
  alert: z.string().optional(),
  record: z.string().optional(),
  annotations: z.record(z.string(), z.string()).optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

const PrometheusRuleManifestSchema = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
  spec: z
    .looseObject({
      groups: z
        .array(
          z.looseObject({
            name: z.string(),
            rules: z.array(RuleSchema).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

function validateAlertRuleCopy(entry: {
  manifest: string;
  alert: string;
  annotations: Record<string, string>;
}): string[] {
  const { alert, annotations, manifest } = entry;
  const issues: string[] = [];
  if ("message" in annotations) {
    issues.push(
      `${manifest}/${alert}: uses deprecated annotations.message; use annotations.description`,
    );
  }
  const rawSummary = (annotations["summary"] ?? "").trim();
  const unescapedSummary = rawSummary
    .replaceAll('{{ "{{" }}', "{{")
    .replaceAll('{{ "}}" }}', "}}");
  const description = (annotations["description"] ?? "").trim();

  if (unescapedSummary.length === 0) {
    issues.push(`${manifest}/${alert}: missing annotations.summary`);
  }
  if (unescapedSummary.length > 85) {
    issues.push(
      `${manifest}/${alert}: summary exceeds 85 chars (${String(unescapedSummary.length)}): "${unescapedSummary}"`,
    );
  }
  if (/^\[[^\]]+\]/u.test(unescapedSummary)) {
    issues.push(
      `${manifest}/${alert}: summary starts with bracket prefix: "${unescapedSummary}"`,
    );
  }
  const bannedMatch = BANNED_SUMMARY_LABEL_RE.exec(unescapedSummary);
  if (bannedMatch !== null) {
    issues.push(
      `${manifest}/${alert}: summary interpolates banned raw machine label (${bannedMatch[0]}): "${unescapedSummary}"`,
    );
  }
  if (description.length === 0) {
    issues.push(`${manifest}/${alert}: missing annotations.description`);
  }
  for (const [field, text] of [
    ["summary", rawSummary],
    ["description", description],
  ] as const) {
    const stripped = text
      .replaceAll('{{ "{{" }}', "")
      .replaceAll('{{ "}}" }}', "");
    if (stripped.includes("{{")) {
      issues.push(
        `${manifest}/${alert}: unescaped Helm Go template in annotations.${field}`,
      );
    }
  }
  return issues;
}

describe("PrometheusRule human-copy contract", () => {
  test("every alerting rule defines plain-English summary and description without legacy message annotations or banned machine labels", () => {
    const app = new App();
    const chart = new Chart(app, "monitoring-rules-contract");
    createPrometheusMonitoring(chart);
    const manifests = z
      .array(PrometheusRuleManifestSchema)
      .parse(chart.toJson());

    const alertRules = manifests
      .filter((m) => m.kind === "PrometheusRule")
      .flatMap((m) =>
        (m.spec?.groups ?? []).flatMap((g) =>
          (g.rules ?? [])
            .filter((r) => r.alert !== undefined)
            .map((r) => ({
              manifest: m.metadata.name,
              alert: r.alert ?? "",
              annotations: r.annotations ?? {},
            })),
        ),
      );

    expect(alertRules.length).toBeGreaterThan(300);
    const violations = alertRules.flatMap((entry) =>
      validateAlertRuleCopy(entry),
    );
    expect(violations).toEqual([]);
  });
});
