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
  metadata: z
    .object({ name: z.string().optional(), namespace: z.string().optional() })
    .optional(),
  data: z.record(z.string(), z.string()).optional(),
  rules: z.array(RuleSchema).optional(),
  roleRef: z.object({ kind: z.string(), name: z.string() }).optional(),
  subjects: z
    .array(
      z.object({
        kind: z.string(),
        name: z.string(),
        namespace: z.string().optional(),
      }),
    )
    .optional(),
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

function envNames(deployment: SynthesizedDeployment): Set<string> {
  return new Set(
    deployment.spec.template.spec.containers[0]?.env.map(
      (variable) => variable.name,
    ),
  );
}

describe("temporal homelab audit tooling configuration", () => {
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
});

describe("temporal homelab audit tooling worker topology", () => {
  it("isolates core, agent, and Glitter queues behind event-loop health probes", async () => {
    const deployments = parseDeployments(await synthesizeApp());
    const core = requireDeployment(deployments, "temporal-temporal-worker");
    const agent = requireDeployment(
      deployments,
      "temporal-temporal-agent-worker",
    );
    const glitter = requireDeployment(
      deployments,
      "temporal-temporal-glitter-worker",
    );

    expect(envValue(core, "TEMPORAL_WORKER_ROLE")).toBe("core");
    expect(envValue(core, "SLEEP_WEBHOOK_PORT")).toBe("9469");
    expect(envValue(agent, "TEMPORAL_WORKER_ROLE")).toBe("agent");
    expect(envValue(glitter, "TEMPORAL_WORKER_ROLE")).toBe("glitter");

    const coreContainer = core.spec.template.spec.containers[0];
    const agentContainer = agent.spec.template.spec.containers[0];
    const glitterContainer = glitter.spec.template.spec.containers[0];
    if (
      coreContainer === undefined ||
      agentContainer === undefined ||
      glitterContainer === undefined
    ) {
      throw new Error("Temporal worker Deployments require one container");
    }

    for (const probe of [
      coreContainer.startupProbe,
      coreContainer.livenessProbe,
      coreContainer.readinessProbe,
      agentContainer.startupProbe,
      agentContainer.livenessProbe,
      agentContainer.readinessProbe,
      glitterContainer.startupProbe,
      glitterContainer.livenessProbe,
      glitterContainer.readinessProbe,
    ]) {
      expect(probe.httpGet).toEqual({ path: "/healthz", port: 9465 });
    }

    expect(coreContainer.ports.map((port) => port.containerPort)).toEqual([
      9464, 9465, 9466, 9467, 9468, 9469,
    ]);
    expect(agentContainer.ports.map((port) => port.containerPort)).toEqual([
      9464, 9465,
    ]);
    expect(glitterContainer.ports.map((port) => port.containerPort)).toEqual([
      9464, 9465,
    ]);

    const yaml = await synthesizeApp();
    expect(yaml).toContain("name: temporal-worker-sleep-webhook");
    expect(yaml).toContain("https://temporal-sleep.sjer.red/healthz");
    expect(yaml).toContain("name: SLEEP_WEBHOOK_TOKEN");
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
});

describe("temporal homelab audit tooling access boundaries", () => {
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

  it("keeps the agent worker out of every pod-exec RoleBinding", async () => {
    const resources = parseResources(await synthesizeApp());
    const execRoleNames = new Set(
      resources
        .filter(
          (resource) =>
            resource.kind === "Role" &&
            (resource.rules ?? []).some((rule) =>
              (rule.resources ?? []).includes("pods/exec"),
            ),
        )
        .flatMap((resource) =>
          resource.metadata?.name === undefined ? [] : [resource.metadata.name],
        ),
    );
    const execBindings = resources.filter(
      (resource) =>
        resource.kind === "RoleBinding" &&
        resource.roleRef?.kind === "Role" &&
        execRoleNames.has(resource.roleRef.name),
    );

    expect(execBindings.length).toBeGreaterThan(0);
    for (const binding of execBindings) {
      expect(
        binding.subjects?.map((subject) => subject.name) ?? [],
      ).not.toContain("temporal-agent-worker");
    }

    const auditBinding = resources.find(
      (resource) =>
        resource.kind === "ClusterRoleBinding" &&
        resource.metadata?.name === "temporal-worker-audit-reader",
    );
    expect(auditBinding?.subjects?.map((subject) => subject.name)).toEqual([
      "temporal-worker",
      "temporal-agent-worker",
    ]);
  });

  it("gives the agent worker only provider auth and read-only evidence configuration", async () => {
    const deployments = parseDeployments(await synthesizeApp());
    const agent = requireDeployment(
      deployments,
      "temporal-temporal-agent-worker",
    );
    const names = envNames(agent);

    for (const required of [
      "TEMPORAL_ADDRESS",
      "TEMPORAL_WORKER_ROLE",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CODEX_ACCESS_TOKEN",
      "PROMETHEUS_URL",
      "ALERT_DASHBOARD_URL",
    ]) {
      expect(names).toContain(required);
    }

    for (const prohibited of [
      "AGENT_TASK_API_TOKEN",
      "ARGOCD_AUTH_TOKEN",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "BUGSINK_TOKEN",
      "BUILDKITE_API_TOKEN",
      "CLOUDFLARE_API_TOKEN",
      "CODEX_API_KEY",
      "GITHUB_APP_ID",
      "GITHUB_APP_INSTALLATION_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
      "GRAFANA_API_KEY",
      "HA_TOKEN",
      "OPENAI_API_KEY",
      "OPENROUTER_API_KEY",
      "POSTAL_API_KEY",
      "RECIPIENT_EMAIL",
      "SENDER_EMAIL",
      "XCODE_CLOUD_WEBHOOK_TOKEN",
    ]) {
      expect(names).not.toContain(prohibited);
    }
  });

  it("gives the core worker the Grafana credentials and gcx configuration the audit needs", async () => {
    const deployments = parseDeployments(await synthesizeApp());
    const core = requireDeployment(deployments, "temporal-temporal-worker");
    const names = envNames(core);

    // ensureGcxContext() (packages/temporal/src/activities/gcx-context.ts) reads
    // these two to provision the gcx `homelab` context; GCX_CONFIG pins where
    // that config lands, independent of the base image's HOME.
    for (const required of [
      "GRAFANA_URL",
      "GRAFANA_API_KEY",
      "GCX_CONFIG",
      "GCX_NO_UPDATE_NOTIFIER",
      "GCX_TELEMETRY",
    ]) {
      expect(names).toContain(required);
    }

    // /tmp is a fresh emptyDir on every pod start and nothing creates
    // directories under it before `gcx login` runs, so the config path must
    // stay one level deep. A nested path would need an mkdir that does not
    // exist, and gcx would fail on every fresh pod.
    const gcxConfig = envValue(core, "GCX_CONFIG");
    expect(gcxConfig).toBe("/tmp/gcx-config.yaml");
    expect(gcxConfig?.split("/").filter(Boolean)).toHaveLength(2);

    // The agent worker is deliberately denied the same credentials.
    const agent = requireDeployment(
      deployments,
      "temporal-temporal-agent-worker",
    );
    const agentNames = envNames(agent);
    for (const prohibited of ["GRAFANA_API_KEY", "GCX_CONFIG"]) {
      expect(agentNames).not.toContain(prohibited);
    }
  });
});
