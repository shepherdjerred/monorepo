import { describe, expect, it } from "bun:test";
import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { setupCharts } from "./setup-charts.ts";

const RuleSchema = z.object({
  apiGroups: z.array(z.string()).optional(),
  resources: z.array(z.string()).optional(),
  verbs: z.array(z.string()).optional(),
});

const ResourceSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string().optional() }).optional(),
  data: z.record(z.string(), z.string()).optional(),
  rules: z.array(RuleSchema).optional(),
});

async function synthesizeApp(): Promise<string> {
  const app = new App({ outdir: ".test-synth" });
  await setupCharts(app);
  return app.synthYaml();
}

function parseResources(yaml: string): z.infer<typeof ResourceSchema>[] {
  const resources: z.infer<typeof ResourceSchema>[] = [];
  for (const document of parseAllDocuments(yaml)) {
    const parsed = ResourceSchema.safeParse(document.toJSON());
    if (parsed.success) {
      resources.push(parsed.data);
    }
  }
  return resources;
}

describe("temporal homelab audit tooling", () => {
  it("injects Buildkite, Bugsink, and audit archive configuration", async () => {
    const yaml = await synthesizeApp();

    expect(yaml).toContain("name: BUGSINK_URL");
    expect(yaml).toContain("value: https://bugsink.sjer.red");
    expect(yaml).toContain("name: BUILDKITE_API_TOKEN");
    expect(yaml).toContain("name: BUILDKITE_ORGANIZATION_SLUG");
    expect(yaml).toContain("value: sjerred");
    expect(yaml).toContain("name: BUILDKITE_PIPELINE_SLUG");
    expect(yaml).toContain("value: monorepo");
    expect(yaml).toContain("name: HOMELAB_AUDIT_ARCHIVE_BUCKET");
    expect(yaml).toContain("name: HOMELAB_AUDIT_ARCHIVE_PREFIX");
    expect(yaml).toContain("value: homelab-audits");
  });

  it("enables Temporal worker observability dynamic config with v1.29 key casing", async () => {
    const resources = parseResources(await synthesizeApp());
    const dynamicConfig = resources.find(
      (resource) =>
        resource.kind === "ConfigMap" &&
        resource.metadata?.name === "temporal-dynamic-config",
    );

    expect(dynamicConfig).toBeDefined();
    const configYaml = dynamicConfig?.data?.["dynamic-config.yaml"] ?? "";
    expect(configYaml).toContain("frontend.WorkerHeartbeatsEnabled:");
    expect(configYaml).toContain("frontend.ListWorkersEnabled:");
    expect(configYaml).toContain("  - value: true");
    expect(configYaml).not.toContain("frontend.workerHeartbeatsEnabled:");
  });

  it("keeps the audit ClusterRole read-only and includes Tailscale CRDs", async () => {
    const resources = parseResources(await synthesizeApp());
    const auditRole = resources.find(
      (resource) =>
        resource.kind === "ClusterRole" &&
        resource.metadata?.name === "temporal-worker-audit-reader",
    );

    expect(auditRole).toBeDefined();
    const rules = auditRole?.rules ?? [];
    for (const rule of rules) {
      expect(rule.verbs ?? []).toEqual(["get", "list", "watch"]);
      expect(rule.resources ?? []).not.toContain("pods/exec");
    }
    expect(rules).toContainEqual({
      apiGroups: ["tailscale.com"],
      resources: ["connectors", "proxygroups", "proxyclasses"],
      verbs: ["get", "list", "watch"],
    });
  });
});
