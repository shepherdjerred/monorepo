import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import path from "node:path";
import {
  firstPartyImageRepository,
  imageRegistry,
} from "@shepherdjerred/version-catalog/image-registry";
import { againstDebt } from "@shepherdjerred/homelab/cdk8s/src/fleet-policy/fleet.ts";
import { UPSTREAM_CONTAINERS_WITHOUT_REQUESTS } from "@shepherdjerred/homelab/cdk8s/src/fleet-policy/debt-allowlists.ts";
import { workloadContainers } from "@shepherdjerred/homelab/cdk8s/src/testing/workload-containers.ts";

/**
 * ArgoCD Helm Render Tests
 *
 * Simulates exactly what ArgoCD does: for each external Helm chart referenced
 * in our Application CRDs, pull the chart at the pinned version, apply our
 * values, and run `helm template`. If this fails, ArgoCD would fail too.
 *
 * This test reads from dist/apps.k8s.yaml (pre-built CDK8s output).
 * Run `bun run build` first to generate dist/.
 *
 * What this catches:
 * - Chart version doesn't exist in the registry
 * - Our values use keys removed/renamed in a chart upgrade
 * - Template rendering failures with our specific config
 * - Incompatible value types
 * - Missing Minecraft volumes referenced by sidecars or init containers
 * - Upstream containers rendered without CPU and memory requests
 *
 * CI-only: This test requires network access (~40s) and is skipped in
 * pre-commit hooks. Run explicitly with:
 *   bun run test -- src/argocd-helm-render.test.ts
 * Or set CI=true to enable in automated pipelines.
 */

// CI-only: skip in local `bun run test` unless explicitly enabled.
// To run locally: HELM_RENDER_TEST=1 bun run test -- src/argocd-helm-render.test.ts
const shouldRun =
  Bun.env["CI"] === "true" ||
  Bun.env["CI"] === "woodpecker" ||
  Bun.env["HELM_RENDER_TEST"] === "1";

const DIST_DIR = path.join(import.meta.dir, "../dist");
const APPS_YAML = path.join(DIST_DIR, "apps.k8s.yaml");

// Internal chart repos — skip these (already validated by helm-template.test.ts)
const INTERNAL_REPOS = [
  "charts.tailnet-1a49.ts.net",
  "registry-1.docker.io/shepherdjerred",
];

// Upstream charts mirrored into the internal Charts registry for Delivery
// delegation; render against their canonical upstream Helm repo here.
const MIRRORED_EXTERNAL_CHARTS: Readonly<Record<string, string>> = {
  minecraft: "https://itzg.github.io/minecraft-server-charts/",
};

const SYNTHETIC_DIGEST = `sha256:${"f".repeat(64)}`;
const SELECTED_DIGEST_DEPENDENCY_PATTERN =
  /\{\{ printf "selected@%s" \(last \(splitList "@" \(required `Delivery requires image:([a-z0-9-]+)` \(get \(get \(\.Values\.delivery \| default dict\) "dependencies" \| default dict\) "\1"\)\)\)\) \}\}/gu;
const DIRECT_DEPENDENCY_PATTERN =
  /\{\{ required `Delivery requires image:([a-z0-9-]+)` \(get \(get \(\.Values\.delivery \| default dict\) "dependencies" \| default dict\) "\1"\) \}\}/gu;

// Git repos (not Helm chart repos) — skip
const GIT_REPOS = ["github.com/adyanth/"];

// OCI registries that need oci:// prefix for helm commands
const OCI_REGISTRIES = ["registry.k8s.io", "ghcr.io"];

const HelmSourceSchema = z.object({
  chart: z.string(),
  repoURL: z.string(),
  targetRevision: z.string(),
  helm: z
    .object({
      valuesObject: z.record(z.string(), z.unknown()).optional(),
      parameters: z
        .array(
          z.object({
            name: z.string(),
            value: z.string(),
          }),
        )
        .optional(),
      releaseName: z.string().optional(),
    })
    .optional(),
});

const ApplicationSchema = z.object({
  apiVersion: z.string(),
  kind: z.literal("Application"),
  metadata: z.object({
    name: z.string(),
    namespace: z.string().optional(),
  }),
  spec: z.object({
    destination: z.object({ namespace: z.string() }),
    source: HelmSourceSchema.optional(),
    sources: z.array(HelmSourceSchema).optional(),
  }),
});

const PostgresOperatorConfigurationSchema = z.object({
  kind: z.literal("OperatorConfiguration"),
  metadata: z.object({
    name: z.literal("postgres-operator"),
  }),
  configuration: z.object({
    enable_maintenance_windows: z.literal(true),
    logical_backup: z.object({
      logical_backup_successful_jobs_history_limit: z.literal(3),
      logical_backup_failed_jobs_history_limit: z.literal(3),
      logical_backup_ttl_seconds_after_finished: z.literal(86_400),
    }),
  }),
});

const MountedContainerSchema = z.object({
  name: z.string(),
  volumeMounts: z.array(z.object({ name: z.string() })).optional(),
});

const MinecraftStatefulSetSchema = z.object({
  kind: z.literal("StatefulSet"),
  metadata: z.object({ name: z.literal("minecraft-tsmc") }),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(MountedContainerSchema),
        initContainers: z.array(MountedContainerSchema).optional(),
        volumes: z.array(
          z.object({
            name: z.string(),
            configMap: z.object({ name: z.string() }).optional(),
            persistentVolumeClaim: z
              .object({ claimName: z.string() })
              .optional(),
          }),
        ),
      }),
    }),
    volumeClaimTemplates: z
      .array(
        z.object({
          metadata: z.object({ name: z.string() }),
        }),
      )
      .optional(),
  }),
});

type HelmSource = z.infer<typeof HelmSourceSchema>;

const privateImageNames = new Set(
  imageRegistry.images
    .filter((image) => image.visibility === "private")
    .map((image) => image.name),
);
function privatePodSpecs(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value))
    return value.flatMap((child: unknown) => privatePodSpecs(child));
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) return [];
  const record = parsed.data;
  const containers = z
    .array(z.object({ image: z.string() }))
    .safeParse([
      ...(Array.isArray(record["containers"]) ? record["containers"] : []),
      ...(Array.isArray(record["initContainers"])
        ? record["initContainers"]
        : []),
    ]);
  const privateConsumer =
    containers.success &&
    containers.data.some(({ image }) => {
      const name = /^docker\.io\/shepherdjerred\/([\w-]+)[:@]/u.exec(
        image,
      )?.[1];
      return name !== undefined && privateImageNames.has(name);
    });
  return [
    ...(privateConsumer ? [record] : []),
    ...Object.values(record).flatMap((child) => privatePodSpecs(child)),
  ];
}

type ExternalChart = {
  appName: string;
  /** The namespace the Application deploys the chart into. */
  namespace: string;
  chart: string;
  repoURL: string;
  version: string;
  values: Record<string, unknown> | undefined;
  parameters: { name: string; value: string }[] | undefined;
  releaseName: string | undefined;
  isOci: boolean;
};

function isInternalOrGitRepo(repoURL: string): boolean {
  for (const internal of INTERNAL_REPOS) {
    if (repoURL.includes(internal)) return true;
  }
  for (const git of GIT_REPOS) {
    if (repoURL.includes(git)) return true;
  }
  return false;
}

function isOciRegistry(repoURL: string): boolean {
  for (const oci of OCI_REGISTRIES) {
    if (repoURL.includes(oci)) return true;
  }
  // If it doesn't start with https://, it's likely OCI
  return !repoURL.startsWith("https://");
}

function resolveExternalRepoUrl(
  chart: string,
  repoURL: string,
): string | undefined {
  if (repoURL.includes("charts.tailnet-1a49.ts.net")) {
    return MIRRORED_EXTERNAL_CHARTS[chart];
  }
  return isInternalOrGitRepo(repoURL) ? undefined : repoURL;
}

function resolveDeliveryPlaceholdersInString(value: string): string {
  return value
    .replaceAll(
      SELECTED_DIGEST_DEPENDENCY_PATTERN,
      `selected@${SYNTHETIC_DIGEST}`,
    )
    .replaceAll(
      DIRECT_DEPENDENCY_PATTERN,
      (_match, name: string) =>
        `${firstPartyImageRepository(name)}:0.0.0@${SYNTHETIC_DIGEST}`,
    );
}

function resolveDeliveryPlaceholders(value: unknown): unknown {
  if (typeof value === "string") {
    return resolveDeliveryPlaceholdersInString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveDeliveryPlaceholders(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        resolveDeliveryPlaceholders(child),
      ]),
    );
  }
  return value;
}

function toExternalChart(
  appName: string,
  namespace: string,
  source: HelmSource,
): ExternalChart | undefined {
  if (!source.chart) return undefined;
  const repoURL = resolveExternalRepoUrl(source.chart, source.repoURL);
  if (repoURL === undefined) return undefined;
  return {
    appName,
    namespace,
    chart: source.chart,
    repoURL,
    version: source.targetRevision,
    values:
      source.helm?.valuesObject === undefined
        ? undefined
        : z
            .record(z.string(), z.unknown())
            .parse(resolveDeliveryPlaceholders(source.helm.valuesObject)),
    parameters: source.helm?.parameters?.map((param) => ({
      name: param.name,
      value: resolveDeliveryPlaceholdersInString(param.value),
    })),
    releaseName: source.helm?.releaseName,
    isOci: isOciRegistry(repoURL),
  };
}

function extractExternalCharts(yamlContent: string): ExternalChart[] {
  const charts: ExternalChart[] = [];

  for (const doc of parseAllDocuments(yamlContent)) {
    const result = ApplicationSchema.safeParse(doc.toJSON() as unknown);
    if (!result.success) continue;

    const app = result.data;
    const sources = [
      ...(app.spec.source ? [app.spec.source] : []),
      ...(app.spec.sources ?? []),
    ];

    for (const source of sources) {
      const external = toExternalChart(
        app.metadata.name,
        app.spec.destination.namespace,
        source,
      );
      if (external !== undefined) charts.push(external);
    }
  }

  return charts;
}

// Stderr patterns that indicate a transient upstream/network failure
// (registry behind a flaky proxy, GitHub releases 5xx, DNS hiccup, etc.).
// Real chart bugs — bad values, missing chart version, template errors —
// must NOT match here, or we'd risk hiding real failures.
//
// A failure that still matches this pattern after exhausting all retries is
// treated as a non-fatal *skip*, not a build failure: this test's contract is
// to validate that OUR values render against the pinned chart, which we can
// only assert once the chart is actually fetched. If GitHub's release CDN (or
// any upstream) is returning 504s, that's its uptime, not our config — gating
// the PR on it just produces flaky red builds. The skip is logged loudly so it
// is never silent. Note `404`/`not found` (a missing chart version) and helm
// template errors deliberately do NOT match here and remain hard failures.
const TRANSIENT_HELM_ERROR_PATTERN =
  /\b(?:502|503|504)\b|Bad Gateway|Proxy Error|Service Unavailable|Gateway Timeout|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|i\/o timeout|TLS handshake|tls: handshake|connection reset|connection refused|no route to host|temporary failure in name resolution/i;

// Exponential backoff (ms) for transient upstream errors. Seven attempts over
// ~60s base (plus jitter) rides out the multi-second 504 windows GitHub's
// release CDN intermittently serves — a 10s budget was too short and flaked.
const HELM_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16_000, 30_000];

// Spread retries so a fleet of charts hitting the same flaky upstream don't all
// re-request in lockstep (thundering herd). ±25% jitter around the base delay.
function jitter(delayMs: number): number {
  return Math.round(delayMs * (0.75 + Math.random() * 0.5));
}

type HelmTemplateResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  // True when the final (post-retry) result still matched the transient
  // upstream pattern — i.e. we never got a clean fetch, but the failure is a
  // network/5xx signal rather than a real chart/values error.
  transient: boolean;
};

async function helmTemplate(chart: ExternalChart): Promise<HelmTemplateResult> {
  const tempDir = await mkdtemp(
    path.join(tmpdir(), `argocd-test-${chart.appName}-`),
  );

  try {
    const args = ["helm", "template", chart.releaseName ?? chart.appName];

    if (chart.isOci) {
      // OCI charts: helm template RELEASE oci://REGISTRY/CHART --version VERSION
      const ociRef = `oci://${chart.repoURL.replace(/^https?:\/\//, "")}/${chart.chart}`;
      args.push(ociRef);
    } else {
      // Traditional repos: helm template RELEASE CHART --repo REPO_URL --version VERSION
      args.push(chart.chart, "--repo", chart.repoURL);
    }

    args.push("--version", chart.version);

    // Write values to temp file if present
    if (chart.values && Object.keys(chart.values).length > 0) {
      await Bun.write(
        path.join(tempDir, "values.json"),
        JSON.stringify(chart.values),
      );
      args.push("-f", path.join(tempDir, "values.json"));
    }

    // Add --set flags for parameters
    if (chart.parameters) {
      for (const param of chart.parameters) {
        args.push("--set", `${param.name}=${param.value}`);
      }
    }

    // Skip CRD validation and Kubernetes version checks
    args.push("--skip-crds");

    const totalAttempts = HELM_RETRY_DELAYS_MS.length + 1;
    let lastResult: HelmTemplateResult = {
      exitCode: 1,
      stdout: "",
      stderr: "",
      transient: false,
    };

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      const spawn = Bun.spawnSync(args, {
        timeout: 60_000, // 60s per chart
      });

      const stdout = spawn.stdout.toString();
      const stderr = spawn.stderr.toString();
      // Bun reports exitCode === null when it had to kill the process (timeout/signal).
      // Treat that as both a failure AND a transient signal to retry.
      const timedOut = spawn.exitCode === null;
      const exitCode = timedOut ? 124 : spawn.exitCode;
      const isTransient = timedOut || TRANSIENT_HELM_ERROR_PATTERN.test(stderr);

      lastResult = { exitCode, stdout, stderr, transient: isTransient };

      if (exitCode === 0) {
        return lastResult;
      }

      if (!isTransient || attempt === totalAttempts) {
        return lastResult;
      }

      const delayMs = jitter(HELM_RETRY_DELAYS_MS[attempt - 1] ?? 0);
      console.warn(
        `helm template ${chart.appName} attempt ${String(attempt)}/${String(totalAttempts)} hit transient error, retrying in ${String(delayMs)}ms: ${stderr.trim().split("\n").slice(-1).join("") || (timedOut ? "timeout" : "unknown")}`,
      );
      await Bun.sleep(delayMs);
    }

    return lastResult;
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

type RenderOutcome = { chart: ExternalChart; result: HelmTemplateResult };

function describeChart(chart: ExternalChart): string {
  return `${chart.appName} (${chart.chart}@${chart.version} from ${chart.repoURL})`;
}

// Render every chart exactly once (batched for concurrency), shared by all
// assertions below. Rendering each chart per-test would double the network
// load — and the flake surface — against the same upstream repos.
async function renderAllCharts(
  charts: ExternalChart[],
): Promise<RenderOutcome[]> {
  const outcomes: RenderOutcome[] = [];
  const batchSize = 5;
  for (let i = 0; i < charts.length; i += batchSize) {
    const batch = charts.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (chart) => ({
        chart,
        result: await helmTemplate(chart),
      })),
    );
    outcomes.push(...results);
  }
  return outcomes;
}

/**
 * Containers of the rendered charts that declare no CPU or no memory request,
 * as `<application>/<workload>/<container>`, split against the debt
 * allowlist. A chart skipped for a transient upstream error rendered nothing,
 * so its allowlist entries are neither confirmed nor stale.
 */
function upstreamRequestDebt(outcomes: readonly RenderOutcome[]): {
  containers: number;
  unexpected: string[];
  stale: string[];
} {
  const rendered = outcomes.filter(({ result }) => result.exitCode === 0);
  const containers = rendered.flatMap(({ chart, result }) =>
    parseAllDocuments(result.stdout)
      .flatMap((document) => workloadContainers(document.toJSON()))
      .map((found) => ({
        key: `${chart.appName}/${found.workload}/${found.container}`,
        hasRequests: found.hasRequests,
      })),
  );
  const renderedApps = new Set(rendered.map(({ chart }) => chart.appName));
  return {
    containers: containers.length,
    ...againstDebt(
      containers.filter((found) => !found.hasRequests).map(({ key }) => key),
      new Set(
        [...UPSTREAM_CONTAINERS_WITHOUT_REQUESTS].filter((key) =>
          renderedApps.has(key.slice(0, key.indexOf("/"))),
        ),
      ),
    ),
  };
}

function expectMinecraftStatefulSetMounts(outcomes: readonly RenderOutcome[]) {
  const outcome = outcomes.find(
    ({ chart }) => chart.appName === "minecraft-tsmc",
  );
  if (!outcome) {
    throw new Error("Minecraft tsmc chart was not discovered");
  }
  expect(outcome.result.exitCode, outcome.result.stderr).toBe(0);
  const workload = parseAllDocuments(outcome.result.stdout)
    .map((document) => MinecraftStatefulSetSchema.safeParse(document.toJSON()))
    .find((result) => result.success);
  if (!workload?.success) {
    throw new Error("Minecraft chart did not render its StatefulSet");
  }
  const pod = workload.data.spec.template.spec;
  expect(pod.initContainers).toEqual(
    expect.arrayContaining([
      {
        name: "migrate-bluemap",
        volumeMounts: [
          { name: "datadir" },
          { name: "bluemap" },
          { name: "bluemap-migration" },
        ],
      },
    ]),
  );
  expect(pod.volumes).toEqual(
    expect.arrayContaining([
      {
        name: "bluemap",
        persistentVolumeClaim: { claimName: "minecraft-tsmc-bluemap" },
      },
      {
        name: "bluemap-migration",
        configMap: { name: "minecraft-tsmc-bluemap-migration" },
      },
    ]),
  );
  const claimNames = (workload.data.spec.volumeClaimTemplates ?? []).map(
    (claim) => claim.metadata.name,
  );
  expect(claimNames).toContain("datadir");
  const volumeNames = new Set([
    ...pod.volumes.map((volume) => volume.name),
    ...claimNames,
  ]);
  for (const container of [...pod.containers, ...(pod.initContainers ?? [])]) {
    for (const mount of container.volumeMounts ?? []) {
      expect(
        volumeNames.has(mount.name),
        `${container.name} mounts undeclared volume ${mount.name}`,
      ).toBe(true);
    }
  }
}
const describeFn = shouldRun ? describe : describe.skip;

describeFn("ArgoCD Helm Render - External Charts", () => {
  let externalCharts: ExternalChart[];
  let outcomes: RenderOutcome[];

  beforeAll(async () => {
    const appsFile = Bun.file(APPS_YAML);
    if (!(await appsFile.exists())) {
      throw new Error(
        `${APPS_YAML} not found. Run 'bun run build' first to generate dist/.`,
      );
    }
    const yamlContent = await appsFile.text();
    externalCharts = extractExternalCharts(yamlContent);

    // Single render pass for the whole suite.
    outcomes = await renderAllCharts(externalCharts);

    // Log transient skips ONCE, loudly, here — so the "never silent" invariant
    // holds regardless of which downstream assertion observes the outcome.
    // (A chart that exhausted retries on a transient upstream error has
    // exitCode !== 0 && transient; it is reported, not failed — see
    // TRANSIENT_HELM_ERROR_PATTERN.)
    const transientSkips = outcomes.filter(
      (o) => o.result.exitCode !== 0 && o.result.transient,
    );
    if (transientSkips.length > 0) {
      const msg = transientSkips
        .map(
          (o) =>
            `  ${describeChart(o.chart)}:\n    ${o.result.stderr.trim().replaceAll("\n", "\n    ")}`,
        )
        .join("\n\n");
      console.warn(
        `⚠️  Skipped ${String(transientSkips.length)}/${String(externalCharts.length)} chart(s) due to transient upstream errors that persisted through all retries. This is upstream (registry/CDN) unavailability, NOT a chart/values bug — not failing the build:\n\n${msg}`,
      );
    }
  }, 600_000); // 10 minute ceiling: ample headroom for full-fleet retries during an upstream blip

  it("should find external helm charts to test", () => {
    expect(externalCharts.length).toBeGreaterThan(0);
    console.log(
      `Found ${String(externalCharts.length)} external charts: ${externalCharts.map((c) => c.appName).join(", ")}`,
    );
  });

  it("should render all external helm charts with our values", () => {
    // Real (non-transient) failures only — these are the chart/values bugs this
    // test exists to catch. Transient skips were already logged in beforeAll.
    const failures = outcomes.filter(
      (o) => o.result.exitCode !== 0 && !o.result.transient,
    );

    if (failures.length > 0) {
      const msg = failures
        .map(
          (f) =>
            `  ${describeChart(f.chart)}:\n    ${f.result.stderr.trim().replaceAll("\n", "\n    ")}`,
        )
        .join("\n\n");
      throw new Error(
        `helm template failed for ${String(failures.length)}/${String(externalCharts.length)} chart(s):\n\n${msg}`,
      );
    }
  });

  it("should produce non-empty output for every chart that rendered", () => {
    // Scoped to charts that actually rendered (exitCode === 0). Charts skipped
    // for transient upstream errors are intentionally excluded and were already
    // surfaced by the beforeAll warning — never silently dropped here.
    const emptyOutputs = outcomes
      .filter((o) => o.result.exitCode === 0 && o.result.stdout.trim() === "")
      .map((o) => o.chart.appName);

    if (emptyOutputs.length > 0) {
      throw new Error(
        `Charts with empty template output: ${emptyOutputs.join(", ")}`,
      );
    }
  });

  it("renders reader pull secrets on every private consumer in external charts", () => {
    for (const name of [
      "minecraft-tsmc",
      "seaweedfs",
      "velero",
      "prometheus",
    ]) {
      const outcome = outcomes.find(({ chart }) => chart.appName === name);
      expect(outcome, name).toBeDefined();
      if (outcome === undefined)
        throw new Error(`Missing private chart ${name}`);
      // Match the suite's bounded, reported upstream-outage skips. A rendered
      // chart must still contain private consumers and their reader references.
      if (outcome.result.exitCode !== 0 && outcome.result.transient) continue;
      expect(outcome.result.exitCode, outcome.result.stderr).toBe(0);
      const specs = parseAllDocuments(outcome.result.stdout).flatMap(
        (document) => privatePodSpecs(document.toJSON()),
      );
      expect(specs.length, name).toBeGreaterThan(0);
      for (const spec of specs) {
        const secrets = z
          .array(z.object({ name: z.string() }))
          .parse(spec["imagePullSecrets"]);
        expect(
          secrets.map((secret) => secret.name),
          name,
        ).toContain(`dockerhub-pull-${name}`);
      }
    }
  });

  describe("every upstream container declares CPU and memory requests", () => {
    it("finds the rendered containers (sanity check)", () => {
      expect(upstreamRequestDebt(outcomes).containers).toBeGreaterThan(30);
    });

    it("holds outside the debt allowlist", () => {
      expect(upstreamRequestDebt(outcomes).unexpected).toEqual([]);
    });

    it("has no stale debt allowlist entry", () => {
      expect(upstreamRequestDebt(outcomes).stale).toEqual([]);
    });
  });

  it("renders the PostgreSQL operator v2 defaults in OperatorConfiguration", () => {
    const outcome = outcomes.find(
      ({ chart }) => chart.appName === "postgres-operator",
    );
    if (!outcome) {
      throw new Error("Postgres Operator chart was not discovered");
    }
    if (outcome.result.exitCode !== 0) {
      expect(outcome.result.transient).toBe(true);
      return;
    }

    const configuration = parseAllDocuments(outcome.result.stdout)
      .map((document) =>
        PostgresOperatorConfigurationSchema.safeParse(document.toJSON()),
      )
      .find((result) => result.success);
    if (!configuration?.success) {
      throw new Error(
        "Postgres Operator chart did not render its OperatorConfiguration",
      );
    }

    expect(configuration.data.configuration).toEqual(
      expect.objectContaining({
        enable_maintenance_windows: true,
        logical_backup: expect.objectContaining({
          logical_backup_successful_jobs_history_limit: 3,
          logical_backup_failed_jobs_history_limit: 3,
          logical_backup_ttl_seconds_after_finished: 86_400,
        }),
      }),
    );
  });

  it("renders the Minecraft StatefulSet and resolves every container mount", () => {
    expectMinecraftStatefulSetMounts(outcomes);
  });
});

// Network-free guardrail for the resilience contract: a transient upstream
// failure is rendered non-fatal (skipped) only because the classifier reliably
// distinguishes it from a real chart/values error. If that line ever blurs we'd
// start hiding real failures, so pin both directions explicitly. Runs always
// (not gated on `shouldRun`) — it's pure regex, no helm/network needed.
describe("transient helm error classification", () => {
  const TRANSIENT_STDERRS = [
    "Error: failed to fetch https://github.com/itzg/minecraft-server-charts/releases/download/mc-router-1.5.0/mc-router-1.5.0.tgz : 504 Gateway Time-out",
    "Error: looks like the repo is down : 502 Bad Gateway",
    "Error: 503 Service Unavailable",
    "Error: Get ... dial tcp 140.82.112.3:443: connect: connection refused",
    "Error: Get ... dial tcp 20.29.134.23:443: connect: no route to host",
    "Error: read tcp: connection reset by peer",
    "Error: dial tcp: lookup github.com: temporary failure in name resolution",
    "Error: net/http: TLS handshake timeout",
  ];

  // Real chart/values bugs — the failures this test exists to catch. These must
  // NEVER be treated as transient, or a broken upgrade would slip through.
  const HARD_STDERRS = [
    "Error: failed to fetch https://charts.example.com/foo-1.2.3.tgz : 404 Not Found",
    'Error: chart "foo" version "9.9.9" not found in repository',
    'Error: template: foo/templates/deploy.yaml:12:18: executing "foo/templates/deploy.yaml" at <.Values.image.tag>: nil pointer evaluating interface {}.tag',
    "Error: values don't meet the specifications of the schema(s) in the following chart(s):\nfoo:\n- image.tag is required",
    "Error: YAML parse error on foo/templates/cm.yaml: error converting YAML to JSON",
  ];

  it.each(TRANSIENT_STDERRS)(
    "classifies upstream/network failure as transient: %s",
    (stderr) => {
      expect(TRANSIENT_HELM_ERROR_PATTERN.test(stderr)).toBe(true);
    },
  );

  it.each(HARD_STDERRS)(
    "classifies real chart/values failure as NOT transient: %s",
    (stderr) => {
      expect(TRANSIENT_HELM_ERROR_PATTERN.test(stderr)).toBe(false);
    },
  );

  it("keeps jitter within ±25% of the base delay", () => {
    for (let i = 0; i < 1000; i++) {
      const d = jitter(8000);
      expect(d).toBeGreaterThanOrEqual(6000);
      expect(d).toBeLessThanOrEqual(10_000);
    }
  });
});

describe("extractExternalCharts discovery and Delivery placeholder binding", () => {
  it("rewrites mirrored minecraft charts at charts.tailnet-1a49.ts.net while skipping first-party charts", () => {
    const fixture = `
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: minecraft-tsmc
spec:
  destination:
    namespace: minecraft-tsmc
  source:
    chart: minecraft
    repoURL: https://charts.tailnet-1a49.ts.net
    targetRevision: 5.4.0
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: birmel
spec:
  destination:
    namespace: birmel
  source:
    chart: birmel
    repoURL: https://charts.tailnet-1a49.ts.net
    targetRevision: ~2.0.0-0
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: charts
spec:
  destination:
    namespace: charts
  source:
    chart: charts-bootstrap
    repoURL: registry-1.docker.io/shepherdjerred
    targetRevision: ~2.0.0-0
`;
    const extracted = extractExternalCharts(fixture);
    expect(extracted).toEqual([
      {
        appName: "minecraft-tsmc",
        namespace: "minecraft-tsmc",
        chart: "minecraft",
        repoURL: "https://itzg.github.io/minecraft-server-charts/",
        version: "5.4.0",
        values: undefined,
        parameters: undefined,
        releaseName: undefined,
        isOci: false,
      },
    ]);
  });

  it("substitutes synthetic digests for root-chart Delivery requires image placeholders", () => {
    const fixture = `
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: prometheus
spec:
  destination:
    namespace: prometheus
  source:
    chart: kube-prometheus-stack
    repoURL: https://prometheus-community.github.io/helm-charts
    targetRevision: 93.6.1
    helm:
      valuesObject:
        prometheus:
          prometheusSpec:
            containers:
              - name: authenticated-gateway
                image: '{{ required \`Delivery requires image:caddy-s3proxy\` (get (get (.Values.delivery | default dict) "dependencies" | default dict) "caddy-s3proxy") }}'
        openebs:
          zfsPlugin:
            image:
              tag: '{{ printf "selected@%s" (last (splitList "@" (required \`Delivery requires image:zfs-driver\` (get (get (.Values.delivery | default dict) "dependencies" | default dict) "zfs-driver")))) }}'
`;
    const extracted = extractExternalCharts(fixture);
    expect(extracted).toHaveLength(1);
    const serialized = JSON.stringify(extracted[0]?.values);
    expect(serialized).not.toContain("Delivery requires image:");
    expect(serialized).toContain(
      `docker.io/shepherdjerred/caddy-s3proxy:0.0.0@${SYNTHETIC_DIGEST}`,
    );
    expect(serialized).toContain(`selected@${SYNTHETIC_DIGEST}`);
  });
});
