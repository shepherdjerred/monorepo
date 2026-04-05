import { describe, it, expect, beforeAll } from "bun:test";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import path from "node:path";

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
 *
 * CI-only: This test requires network access (~40s) and is skipped in
 * pre-commit hooks. Run explicitly with:
 *   bun test src/argocd-helm-render.test.ts
 * Or set CI=true to enable in automated pipelines.
 */

// CI-only: skip in local `bun test` (runs all tests) unless explicitly enabled.
// To run locally: HELM_RENDER_TEST=1 bun test src/argocd-helm-render.test.ts
const shouldRun =
  Bun.env["CI"] === "true" ||
  Bun.env["BUILDKITE"] === "true" ||
  Bun.env["HELM_RENDER_TEST"] === "1";

const DIST_DIR = path.join(import.meta.dir, "../dist");
const APPS_YAML = path.join(DIST_DIR, "apps.k8s.yaml");

// Internal chart repos — skip these (already validated by helm-template.test.ts)
const INTERNAL_REPOS = [
  "chartmuseum.tailnet-1a49.ts.net",
  "chartmuseum.sjer.red",
];

// Git repos (not Helm chart repos) — skip
const GIT_REPOS = ["github.com/dotdc/", "github.com/adyanth/"];

// OCI registries that need oci:// prefix for helm commands
const OCI_REGISTRIES = ["registry.dagger.io", "registry.k8s.io", "ghcr.io"];

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
    source: HelmSourceSchema.optional(),
    sources: z.array(HelmSourceSchema).optional(),
  }),
});

type HelmSource = z.infer<typeof HelmSourceSchema>;

type ExternalChart = {
  appName: string;
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

function extractExternalCharts(yamlContent: string): ExternalChart[] {
  const documents = parseAllDocuments(yamlContent);
  const charts: ExternalChart[] = [];

  for (const doc of documents) {
    const json = doc.toJSON() as unknown;
    const result = ApplicationSchema.safeParse(json);
    if (!result.success) continue;

    const app = result.data;
    const sources: HelmSource[] = [];

    if (app.spec.source) {
      sources.push(app.spec.source);
    }
    if (app.spec.sources) {
      sources.push(...app.spec.sources);
    }

    for (const source of sources) {
      if (!source.chart) continue; // No chart = git source, skip
      if (isInternalOrGitRepo(source.repoURL)) continue;

      charts.push({
        appName: app.metadata.name,
        chart: source.chart,
        repoURL: source.repoURL,
        version: source.targetRevision,
        values: source.helm?.valuesObject,
        parameters: source.helm?.parameters,
        releaseName: source.helm?.releaseName,
        isOci: isOciRegistry(source.repoURL),
      });
    }
  }

  return charts;
}

async function helmTemplate(chart: ExternalChart): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const tempDir = path.join(
    import.meta.dir,
    `../.argocd-test-${chart.appName}-${String(Date.now())}`,
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

    const result = Bun.spawnSync(args, {
      timeout: 60_000, // 60s per chart
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } finally {
    // Clean up temp dir
    const proc = Bun.spawnSync(["rm", "-rf", tempDir]);
    if (proc.exitCode !== 0) {
      console.warn(`Failed to clean up ${tempDir}`);
    }
  }
}

const describeFn = shouldRun ? describe : describe.skip;

describeFn("ArgoCD Helm Render - External Charts", () => {
  let externalCharts: ExternalChart[];

  beforeAll(async () => {
    const appsFile = Bun.file(APPS_YAML);
    if (!(await appsFile.exists())) {
      throw new Error(
        `${APPS_YAML} not found. Run 'bun run build' first to generate dist/.`,
      );
    }
    const yamlContent = await appsFile.text();
    externalCharts = extractExternalCharts(yamlContent);
  });

  it("should find external helm charts to test", () => {
    expect(externalCharts.length).toBeGreaterThan(0);
    console.log(
      `Found ${String(externalCharts.length)} external charts: ${externalCharts.map((c) => c.appName).join(", ")}`,
    );
  });

  it("should render all external helm charts with our values", async () => {
    const failures: { chart: string; error: string }[] = [];

    // Run in batches of 5 for concurrency control
    const batchSize = 5;
    for (let i = 0; i < externalCharts.length; i += batchSize) {
      const batch = externalCharts.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (chart) => {
          const result = await helmTemplate(chart);
          return { chart, result };
        }),
      );

      for (const { chart, result } of results) {
        if (result.exitCode !== 0) {
          failures.push({
            chart: `${chart.appName} (${chart.chart}@${chart.version} from ${chart.repoURL})`,
            error: result.stderr.trim(),
          });
        }
      }
    }

    if (failures.length > 0) {
      const msg = failures
        .map((f) => `  ${f.chart}:\n    ${f.error.split("\n").join("\n    ")}`)
        .join("\n\n");
      throw new Error(
        `helm template failed for ${String(failures.length)}/${String(externalCharts.length)} chart(s):\n\n${msg}`,
      );
    }
  }, 300_000); // 5 minute timeout for all charts

  it("should produce non-empty output for all charts", async () => {
    const emptyOutputs: string[] = [];

    const batchSize = 5;
    for (let i = 0; i < externalCharts.length; i += batchSize) {
      const batch = externalCharts.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (chart) => {
          const result = await helmTemplate(chart);
          return { chart, result };
        }),
      );

      for (const { chart, result } of results) {
        if (result.exitCode === 0 && result.stdout.trim() === "") {
          emptyOutputs.push(chart.appName);
        }
      }
    }

    if (emptyOutputs.length > 0) {
      throw new Error(
        `Charts with empty template output: ${emptyOutputs.join(", ")}`,
      );
    }
  }, 300_000);
});
