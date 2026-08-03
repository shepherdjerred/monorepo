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

const HttpProbeSchema = z.object({
  failureThreshold: z.number(),
  httpGet: z.object({
    path: z.string(),
    port: z.union([z.string(), z.number()]),
  }),
  periodSeconds: z.number(),
});

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z.object({
            env: z.array(
              z.object({ name: z.string(), value: z.string().optional() }),
            ),
            livenessProbe: HttpProbeSchema,
            name: z.string(),
            ports: z.array(z.object({ containerPort: z.number() })),
            readinessProbe: HttpProbeSchema,
            startupProbe: HttpProbeSchema,
          }),
        ),
      }),
    }),
  }),
});

type SynthesizedDeployment = z.infer<typeof DeploymentSchema>;

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

function parseDeployments(yaml: string): SynthesizedDeployment[] {
  const deployments: SynthesizedDeployment[] = [];
  for (const document of parseAllDocuments(yaml)) {
    const parsed = DeploymentSchema.safeParse(document.toJSON());
    if (parsed.success) {
      deployments.push(parsed.data);
    }
  }
  return deployments;
}

function requireDeployment(
  deployments: SynthesizedDeployment[],
  name: string,
): SynthesizedDeployment {
  const deployment = deployments.find(
    (candidate) => candidate.metadata.name === name,
  );
  if (deployment === undefined) {
    throw new Error(`Missing synthesized Deployment ${name}`);
  }
  return deployment;
}

function envValue(
  deployment: SynthesizedDeployment,
  name: string,
): string | undefined {
  return deployment.spec.template.spec.containers[0]?.env.find(
    (variable) => variable.name === name,
  )?.value;
}

describe("temporal homelab audit tooling", () => {
  it("injects Buildkite and Bugsink configuration", async () => {
    const yaml = await synthesizeApp();

    expect(yaml).toContain("name: BUGSINK_URL");
    expect(yaml).toContain("value: https://bugsink.sjer.red");
    expect(yaml).toContain("name: BUILDKITE_API_TOKEN");
    expect(yaml).toContain("name: BUILDKITE_ORGANIZATION_SLUG");
    expect(yaml).toContain("value: sjerred");
    expect(yaml).toContain("name: BUILDKITE_PIPELINE_SLUG");
    expect(yaml).toContain("value: monorepo");
    // Homelab-audit S3 archiving is unused; HOMELAB_AUDIT_ARCHIVE_* env vars are
    // intentionally not wired (no dead optional secret).
    expect(yaml).not.toContain("name: HOMELAB_AUDIT_ARCHIVE_BUCKET");
  });

  it("wires Starlight and SeaweedFS for the Glitter corpus", async () => {
    const yaml = await synthesizeApp();

    expect(yaml).toContain(
      "itemPath: vaults/v64ocnykdqju4ui6j6pua56xw4/items/cmp6si6n5syhr4smxew3qfcmfi",
    );
    expect(yaml).toContain("name: GLITTER_DISCORD_TOKEN");
    expect(yaml).toContain("name: GLITTER_DISCORD_GUILD_ID");
    expect(yaml).toContain('value: "208425771172102144"');
    expect(yaml).toContain("name: GLITTER_CORPUS_S3_ENDPOINT");
    expect(yaml).toContain("name: GLITTER_CORPUS_S3_BUCKET");
    expect(yaml).toContain("value: glitter-discord-corpus");
    expect(yaml).not.toContain("name: GLITTER_CORPUS_R2_");
  });

  it("isolates core and Glitter queues behind event-loop health probes", async () => {
    const deployments = parseDeployments(await synthesizeApp());
    const core = requireDeployment(deployments, "temporal-temporal-worker");
    const glitter = requireDeployment(
      deployments,
      "temporal-temporal-glitter-worker",
    );

    expect(envValue(core, "TEMPORAL_WORKER_ROLE")).toBe("core");
    expect(envValue(glitter, "TEMPORAL_WORKER_ROLE")).toBe("glitter");

    const coreContainer = core.spec.template.spec.containers[0];
    const glitterContainer = glitter.spec.template.spec.containers[0];
    if (coreContainer === undefined || glitterContainer === undefined) {
      throw new Error("Temporal worker Deployments require one container");
    }

    for (const probe of [
      coreContainer.startupProbe,
      coreContainer.livenessProbe,
      coreContainer.readinessProbe,
      glitterContainer.startupProbe,
      glitterContainer.livenessProbe,
      glitterContainer.readinessProbe,
    ]) {
      expect(probe.httpGet).toEqual({ path: "/healthz", port: 9465 });
    }

    expect(coreContainer.ports.map((port) => port.containerPort)).toEqual([
      9464, 9465, 9466, 9467, 9468,
    ]);
    expect(glitterContainer.ports.map((port) => port.containerPort)).toEqual([
      9464, 9465,
    ]);
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
