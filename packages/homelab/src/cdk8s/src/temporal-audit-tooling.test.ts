import { describe, expect, it } from "vitest";
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
    replicas: z.number(),
    strategy: z.object({ type: z.string() }),
    template: z.object({
      metadata: z.object({ labels: z.record(z.string(), z.string()) }),
      spec: z.object({
        automountServiceAccountToken: z.boolean(),
        containers: z.array(
          z.object({
            env: z.array(
              z.object({ name: z.string(), value: z.string().optional() }),
            ),
            livenessProbe: HttpProbeSchema,
            name: z.string(),
            ports: z.array(z.object({ containerPort: z.number() })),
            readinessProbe: HttpProbeSchema,
            resources: z.object({
              limits: z
                .object({
                  cpu: z.string().optional(),
                  memory: z.string().optional(),
                })
                .optional(),
              requests: z.object({ cpu: z.string(), memory: z.string() }),
            }),
            startupProbe: HttpProbeSchema,
          }),
        ),
        serviceAccountName: z.string(),
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
  it("isolates core, agent, and both Glitter queues behind event-loop health probes", async () => {
    const deployments = parseDeployments(await synthesizeApp());
    const core = requireDeployment(deployments, "temporal-temporal-worker");
    const gateway = requireDeployment(deployments, "temporal-temporal-gateway");
    const home = requireDeployment(
      deployments,
      "temporal-temporal-home-worker",
    );
    const reports = requireDeployment(
      deployments,
      "temporal-temporal-reports-worker",
    );
    const agent = requireDeployment(
      deployments,
      "temporal-temporal-agent-worker",
    );
    const glitterCorpus = requireDeployment(
      deployments,
      "temporal-temporal-glitter-corpus-worker",
    );
    const glitterContext = requireDeployment(
      deployments,
      "temporal-temporal-glitter-context-worker",
    );

    expect(envValue(core, "TEMPORAL_WORKER_ROLE")).toBe("legacy");
    expect(envValue(gateway, "TEMPORAL_WORKER_ROLE")).toBe("control");
    expect(envValue(gateway, "SLEEP_WEBHOOK_PORT")).toBe("9469");
    expect(envValue(home, "TEMPORAL_WORKER_ROLE")).toBe("home");
    expect(envValue(reports, "TEMPORAL_WORKER_ROLE")).toBe("reports");
    expect(envValue(agent, "TEMPORAL_WORKER_ROLE")).toBe("agent");
    expect(envValue(glitterCorpus, "TEMPORAL_WORKER_ROLE")).toBe(
      "glitter-corpus",
    );
    expect(envValue(glitterContext, "TEMPORAL_WORKER_ROLE")).toBe(
      "glitter-context",
    );

    const coreContainer = core.spec.template.spec.containers[0];
    const gatewayContainer = gateway.spec.template.spec.containers[0];
    const homeContainer = home.spec.template.spec.containers[0];
    const reportsContainer = reports.spec.template.spec.containers[0];
    const agentContainer = agent.spec.template.spec.containers[0];
    const glitterCorpusContainer =
      glitterCorpus.spec.template.spec.containers[0];
    const glitterContextContainer =
      glitterContext.spec.template.spec.containers[0];
    if (
      coreContainer === undefined ||
      gatewayContainer === undefined ||
      homeContainer === undefined ||
      reportsContainer === undefined ||
      agentContainer === undefined ||
      glitterCorpusContainer === undefined ||
      glitterContextContainer === undefined
    ) {
      throw new Error("Temporal worker Deployments require one container");
    }

    for (const probe of [
      coreContainer.startupProbe,
      coreContainer.livenessProbe,
      coreContainer.readinessProbe,
      gatewayContainer.startupProbe,
      gatewayContainer.livenessProbe,
      gatewayContainer.readinessProbe,
      homeContainer.startupProbe,
      homeContainer.livenessProbe,
      homeContainer.readinessProbe,
      reportsContainer.startupProbe,
      reportsContainer.livenessProbe,
      reportsContainer.readinessProbe,
      agentContainer.startupProbe,
      agentContainer.livenessProbe,
      agentContainer.readinessProbe,
      glitterCorpusContainer.startupProbe,
      glitterCorpusContainer.livenessProbe,
      glitterCorpusContainer.readinessProbe,
      glitterContextContainer.startupProbe,
      glitterContextContainer.livenessProbe,
      glitterContextContainer.readinessProbe,
    ]) {
      expect(probe.httpGet).toEqual({ path: "/healthz", port: 9465 });
    }

    expect(coreContainer.ports.map((port) => port.containerPort)).toEqual([
      9464, 9465,
    ]);
    expect(gatewayContainer.ports.map((port) => port.containerPort)).toEqual([
      9464, 9465, 9466, 9467, 9468, 9469,
    ]);
    expect(homeContainer.ports.map((port) => port.containerPort)).toEqual([
      9464, 9465,
    ]);
    expect(reportsContainer.ports.map((port) => port.containerPort)).toEqual([
      9464, 9465,
    ]);
    expect(agentContainer.ports.map((port) => port.containerPort)).toEqual([
      9464, 9465,
    ]);
    for (const glitterContainer of [
      glitterCorpusContainer,
      glitterContextContainer,
    ]) {
      expect(glitterContainer.ports.map((port) => port.containerPort)).toEqual([
        9464, 9465,
      ]);
    }

    const yaml = await synthesizeApp();
    expect(yaml).toContain("name: temporal-worker-sleep-webhook");
    expect(yaml).toContain("https://temporal-sleep.sjer.red/healthz");
    expect(yaml).toContain("name: SLEEP_WEBHOOK_TOKEN");
  });
});

describe("Temporal domain worker isolation", () => {
  it("gives each Glitter worker exact resources, credentials, and token isolation", async () => {
    const deployments = parseDeployments(await synthesizeApp());
    const corpus = requireDeployment(
      deployments,
      "temporal-temporal-glitter-corpus-worker",
    );
    const context = requireDeployment(
      deployments,
      "temporal-temporal-glitter-context-worker",
    );

    expect(corpus.spec).toMatchObject({
      replicas: 1,
      strategy: { type: "Recreate" },
    });
    expect(context.spec).toMatchObject({
      replicas: 1,
      strategy: { type: "Recreate" },
    });
    expect(corpus.spec.template.spec).toMatchObject({
      automountServiceAccountToken: false,
      serviceAccountName: "temporal-glitter-corpus-worker",
    });
    expect(context.spec.template.spec).toMatchObject({
      automountServiceAccountToken: false,
      serviceAccountName: "temporal-glitter-context-worker",
    });
    expect(corpus.spec.template.metadata.labels["component"]).toBe(
      "glitter-corpus-worker",
    );
    expect(context.spec.template.metadata.labels["component"]).toBe(
      "glitter-context-worker",
    );
    expect(corpus.spec.template.spec.containers[0]?.resources).toEqual({
      limits: { cpu: "1", memory: "3072Mi" },
      requests: { cpu: "250m", memory: "512Mi" },
    });
    expect(context.spec.template.spec.containers[0]?.resources).toEqual({
      limits: { cpu: "2", memory: "6144Mi" },
      requests: { cpu: "750m", memory: "2560Mi" },
    });

    const corpusEnv = envNames(corpus);
    const contextEnv = envNames(context);
    for (const required of [
      "GLITTER_DISCORD_TOKEN",
      "GLITTER_DISCORD_GUILD_SLUG",
      "GLITTER_DISCORD_DENYLIST_CHANNEL_IDS",
    ]) {
      expect(corpusEnv).toContain(required);
      expect(contextEnv).not.toContain(required);
    }
    for (const required of [
      "OPENROUTER_API_KEY",
      "GITHUB_APP_ID",
      "GITHUB_APP_INSTALLATION_ID",
      "GITHUB_APP_PRIVATE_KEY",
    ]) {
      expect(contextEnv).toContain(required);
      expect(corpusEnv).not.toContain(required);
    }
  });

  it("isolates gateway, home, and reports identities and credentials", async () => {
    const deployments = parseDeployments(await synthesizeApp());
    const gateway = requireDeployment(deployments, "temporal-temporal-gateway");
    const home = requireDeployment(
      deployments,
      "temporal-temporal-home-worker",
    );
    const reports = requireDeployment(
      deployments,
      "temporal-temporal-reports-worker",
    );
    const definitions = [
      {
        deployment: gateway,
        component: "gateway",
        serviceAccountName: "temporal-gateway",
        resources: { requests: { cpu: "100m", memory: "256Mi" } },
      },
      {
        deployment: home,
        component: "home-worker",
        serviceAccountName: "temporal-home-worker",
        resources: { requests: { cpu: "100m", memory: "512Mi" } },
      },
      {
        deployment: reports,
        component: "reports-worker",
        serviceAccountName: "temporal-reports-worker",
        resources: { requests: { cpu: "100m", memory: "512Mi" } },
      },
    ];
    for (const definition of definitions) {
      expect(definition.deployment.spec).toMatchObject({
        replicas: 1,
        strategy: { type: "Recreate" },
      });
      expect(definition.deployment.spec.template.spec).toMatchObject({
        automountServiceAccountToken: false,
        serviceAccountName: definition.serviceAccountName,
      });
      expect(
        definition.deployment.spec.template.metadata.labels["component"],
      ).toBe(definition.component);
      expect(
        definition.deployment.spec.template.spec.containers[0]?.resources,
      ).toEqual(definition.resources);
    }

    const gatewayEnv = envNames(gateway);
    const homeEnv = envNames(home);
    const reportsEnv = envNames(reports);
    for (const required of [
      "GITHUB_WEBHOOK_SECRET",
      "AGENT_TASK_API_TOKEN",
      "SLEEP_WEBHOOK_TOKEN",
      "XCODE_CLOUD_WEBHOOK_TOKEN",
    ]) {
      expect(gatewayEnv).toContain(required);
      expect(homeEnv).not.toContain(required);
      expect(reportsEnv).not.toContain(required);
    }
    for (const required of ["HA_URL", "HA_TOKEN"]) {
      expect(homeEnv).toContain(required);
      expect(gatewayEnv).not.toContain(required);
      expect(reportsEnv).not.toContain(required);
    }
    for (const required of [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "POSTAL_API_KEY",
      "RECIPIENT_EMAIL",
      "SENDER_EMAIL",
    ]) {
      expect(reportsEnv).toContain(required);
      expect(gatewayEnv).not.toContain(required);
      expect(homeEnv).not.toContain(required);
    }
  });
});

describe("Temporal operations worker isolation", () => {
  it("isolates infra, repo, and Scout identities, resources, and credentials", async () => {
    const deployments = parseDeployments(await synthesizeApp());
    const infra = requireDeployment(
      deployments,
      "temporal-temporal-infra-worker",
    );
    const repo = requireDeployment(
      deployments,
      "temporal-temporal-repo-worker",
    );
    const scout = requireDeployment(
      deployments,
      "temporal-temporal-scout-worker",
    );

    expect(infra.spec.template.spec).toMatchObject({
      automountServiceAccountToken: true,
      serviceAccountName: "temporal-infra-worker",
    });
    expect(repo.spec.template.spec).toMatchObject({
      automountServiceAccountToken: false,
      serviceAccountName: "temporal-repo-worker",
    });
    expect(scout.spec.template.spec).toMatchObject({
      automountServiceAccountToken: false,
      serviceAccountName: "temporal-scout-worker",
    });
    expect(infra.spec.template.spec.containers[0]?.resources).toEqual({
      limits: { cpu: "1500m", memory: "6144Mi" },
      requests: { cpu: "500m", memory: "2048Mi" },
    });
    expect(repo.spec.template.spec.containers[0]?.resources).toEqual({
      limits: { cpu: "1500m", memory: "4096Mi" },
      requests: { cpu: "250m", memory: "512Mi" },
    });
    expect(scout.spec.template.spec.containers[0]?.resources).toEqual({
      limits: { cpu: "1500m", memory: "4096Mi" },
      requests: { cpu: "250m", memory: "512Mi" },
    });

    const infraEnv = envNames(infra);
    const repoEnv = envNames(repo);
    const scoutEnv = envNames(scout);
    for (const required of [
      "TALOSCONFIG",
      "GRAFANA_API_KEY",
      "ARGOCD_AUTH_TOKEN",
    ]) {
      expect(infraEnv).toContain(required);
      expect(repoEnv).not.toContain(required);
      expect(scoutEnv).not.toContain(required);
    }
    for (const required of [
      "FRESHRSS_API_PASSWORD_FILE",
      "BUILDKITE_API_TOKEN",
      "OPENROUTER_API_KEY",
    ]) {
      expect(repoEnv).toContain(required);
      expect(scoutEnv).not.toContain(required);
    }
    for (const required of [
      "SCOUT_WEEKLY_PARLAY_CONTROL_URL",
      "SCOUT_WEEKLY_PARLAY_CONTROL_TOKEN",
    ]) {
      expect(scoutEnv).toContain(required);
      expect(repoEnv).not.toContain(required);
      expect(infraEnv).not.toContain(required);
    }
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
      "temporal-infra-worker",
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
