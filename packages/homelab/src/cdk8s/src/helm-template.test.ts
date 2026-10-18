import { describe, it, expect } from "vitest";
import { Glob } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { workerPoolExpressions } from "@shepherdjerred/homelab/cdk8s/scripts/delivery/worker-pool-template.ts";
import { ORDINARY_DELIVERY_ENVIRONMENTS } from "homelab/src/delivery-target-policy.ts";
import { chartValidationValues } from "homelab/scripts/helm/helm-delivery-publication.ts";
import { imageRegistry } from "@shepherdjerred/version-catalog/image-registry";
import { parseAllDocuments } from "yaml";
import { z } from "zod";

/**
 * Helm Template Rendering Tests
 *
 * These tests validate the full Helm rendering pipeline using pre-built dist/ files.
 * They do NOT require CDK8s synthesis — they test the actual artifacts that get
 * packaged into Helm charts and deployed via ArgoCD.
 *
 * Pipeline: TypeScript → CDK8s synth → YAML (dist/) → Helm chart → ArgoCD helm template → K8s
 *
 */

const HELM_DIR = path.join(import.meta.dir, "../helm");
const DIST_DIR = path.join(import.meta.dir, "../dist");

// Every test below spawns a `helm template` subprocess. PR #1249 raised the
// "render all charts" test's timeout to 60s after the default test timeout
// timeout kept tipping over under concurrent CI load on torvalds
// (single-node) — see the "Helm Escaping - helm template (dist/)" describe
// below. Build 5765 (2026-07-19) hit the identical flake in one of the E2E
// content-verification tests, which spawns its own single `helm template`
// call but never got the same timeout bump. Shared here so both describe
// blocks stay consistent.
const HELM_TEMPLATE_TIMEOUT_MS = 60_000;

const ApplicationAutoSyncSchema = z
  .object({
    kind: z.literal("Application"),
    metadata: z.object({ name: z.string() }).loose(),
    spec: z
      .object({
        syncPolicy: z
          .object({
            automated: z
              .object({ enabled: z.boolean().optional() })
              .loose()
              .optional(),
          })
          .loose()
          .optional(),
      })
      .loose(),
  })
  .loose();

const KubernetesResourceSchema = z
  .object({ kind: z.string().optional() })
  .loose();

const KubernetesListSchema = z
  .object({
    kind: z.literal("List"),
    items: z.array(z.unknown()).optional(),
  })
  .loose();

function resourceObjects(manifest: unknown, source: string): unknown[] {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    return [];
  }
  const resourceResult = KubernetesResourceSchema.safeParse(manifest);
  if (!resourceResult.success) {
    throw new Error(
      `Could not inspect ${source}: ${z.prettifyError(resourceResult.error)}`,
    );
  }
  if (resourceResult.data.kind !== "List") {
    return [manifest];
  }
  const listResult = KubernetesListSchema.safeParse(manifest);
  if (!listResult.success) {
    throw new Error(
      `Could not inspect ${source}: ${z.prettifyError(listResult.error)}`,
    );
  }
  return listResult.data.items ?? [];
}

function implicitAutoSyncApplication(
  manifest: unknown,
  source: string,
): string | undefined {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  )
    return;
  const resourceResult = KubernetesResourceSchema.safeParse(manifest);
  if (!resourceResult.success)
    throw new Error(
      `Could not inspect ${source}: ${z.prettifyError(resourceResult.error)}`,
    );
  if (resourceResult.data.kind !== "Application") return;
  const result = ApplicationAutoSyncSchema.safeParse(manifest);
  if (!result.success)
    throw new Error(
      `Could not inspect ${source}: ${z.prettifyError(result.error)}`,
    );
  const automated = result.data.spec.syncPolicy?.automated;
  if (automated !== undefined && automated.enabled === undefined)
    return result.data.metadata.name;
  return;
}

function implicitAutoSyncApplications(content: string, entry: string) {
  const implicitAutoSync: string[] = [];
  for (const [documentIndex, document] of parseAllDocuments(
    content,
  ).entries()) {
    if (document.errors.length > 0) {
      throw new Error(
        `Could not parse ${entry} document ${documentIndex.toString()}: ${document.errors
          .map((error) => error.message)
          .join("; ")}`,
      );
    }
    const source = `${entry} document ${documentIndex.toString()}`;
    for (const [resourceIndex, manifest] of resourceObjects(
      document.toJS(),
      source,
    ).entries()) {
      const name = implicitAutoSyncApplication(
        manifest,
        `${source} resource ${resourceIndex.toString()}`,
      );
      if (name !== undefined) implicitAutoSync.push(`${entry}:${name}`);
    }
  }
  return implicitAutoSync;
}

function stripDeliveryImageBindings(line: string, chart: string): string {
  let stripped = line;
  for (const image of imageRegistry.images) {
    stripped = stripped.replaceAll(
      `{{ required \`Delivery requires image:${image.name}\` (get (get (.Values.delivery | default dict) "dependencies" | default dict) "${image.name}") }}`,
      "",
    );
  }
  if (
    ORDINARY_DELIVERY_ENVIRONMENTS[chart] !== undefined ||
    ["temporal", "scout-beta", "scout-prod", "delivery-control-plane"].includes(
      chart,
    )
  )
    stripped = stripped.replaceAll(
      /\{\{ required `Delivery requires image:([a-z0-9-]+)` \(get \(get \(\.Values\.delivery \| default dict\) "images" \| default dict\) "\1"\) \}\}/gu,
      "",
    );
  if (["arcade", "delivery"].includes(chart))
    stripped = stripped.replaceAll(
      '{{ required `Delivery requires image` (get (.Values.delivery | default dict) "image") }}',
      "",
    );
  return stripped;
}

/**
 * Check that no unescaped {{ sequences exist in YAML content.
 * Helm's Go template engine processes the ENTIRE file before YAML parsing.
 * Any {{ that isn't escaped as {{ "{{" }} or {{ print "{{" }} will crash Helm.
 */
function checkForUnescapedBraces(yamlContent: string, fileName: string) {
  const violations: { lineNumber: number; line: string }[] = [];
  const lines = yamlContent.split("\n");

  for (const [i, line] of lines.entries()) {
    if (!line || line.trim().startsWith("#")) continue;

    // Strip all known Helm escape patterns:
    // - {{ "{{" }} / {{ "}}" }} — standard escape used by escapeHelmGoTemplate
    // - {{ print "{{" }} / {{ print "}}" }} — alternative used by Grafana dashboards
    // - {{ `{{` }} / {{ `}}` }} — backtick-based escape for JSON-rendered templates
    let stripped = line
      .replaceAll('{{ "{{" }}', "")
      .replaceAll('{{ "}}" }}', "")
      .replaceAll('{{ print "{{" }}', "")
      .replaceAll('{{ print "}}" }}', "")
      .replaceAll("{{ `{{` }}", "")
      .replaceAll("{{ `}}` }}", "");

    // First-party release inputs are intentional Helm, scoped to their chart
    // and exact reviewed expression grammar. Consumer templates still escape.
    if (
      ["storm-forum.k8s.yaml", "storm-forum-beta.k8s.yaml"].includes(fileName)
    ) {
      stripped = stripped.replaceAll(
        /\{\{ required `Delivery requires (image|bundleKey|bundleSha256|previousBundleSha256|previousXenforoVersion|previousRuntimeImage|releaseId)` \.Values\.delivery\.\1 \}\}/gu,
        "",
      );
    }

    for (const expression of workerPoolExpressions(
      fileName.replace(/\.k8s\.yaml$/u, ""),
    )) {
      stripped = stripped.replaceAll(expression, "");
    }
    const chart = fileName.replace(/\.k8s\.yaml$/u, "");
    stripped = stripDeliveryImageBindings(stripped, chart);
    // Only {{ triggers Helm template parsing. Standalone }} is safe.
    if (stripped.includes("{{")) {
      violations.push({ lineNumber: i + 1, line: line.trim() });
    }
  }

  if (violations.length > 0) {
    const preview = violations
      .slice(0, 5)
      .map((v) => `  line ${String(v.lineNumber)}: ${v.line}`)
      .join("\n");
    throw new Error(
      `${fileName}: Found ${String(violations.length)} line(s) with unescaped {{ (Helm will crash on these):\n${preview}`,
    );
  }
}

/**
 * Run `helm template` on a chart and return { exitCode, stdout, stderr }.
 * Creates a temp chart directory with Chart.yaml + the synthesized manifest.
 */
async function helmTemplateChart(chartName: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const manifestPath = path.join(DIST_DIR, `${chartName}.k8s.yaml`);
  const manifestFile = Bun.file(manifestPath);
  if (!(await manifestFile.exists())) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Synthesized manifest is missing: ${manifestPath}`,
    };
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), `helm-test-${chartName}-`));
  try {
    const chartYaml = await Bun.file(
      path.join(HELM_DIR, chartName, "Chart.yaml"),
    ).text();
    const templatesDir = path.join(tempDir, "templates");
    await Bun.write(
      path.join(tempDir, "Chart.yaml"),
      chartYaml
        .replace("$version", "0.0.0-test")
        .replace("$appVersion", "0.0.0-test"),
    );
    await Bun.write(
      path.join(templatesDir, `${chartName}.k8s.yaml`),
      manifestFile,
    );
    const valuesFile = Bun.file(path.join(HELM_DIR, chartName, "values.yaml"));
    if (await valuesFile.exists()) {
      await Bun.write(path.join(tempDir, "values.yaml"), valuesFile);
    }

    const validation = chartValidationValues(chartName),
      validationPath = path.join(tempDir, "producer-validation.json");
    if (validation !== undefined)
      await Bun.write(validationPath, JSON.stringify(validation));
    const proc = Bun.spawn(
      [
        "helm",
        "template",
        "test-release",
        tempDir,
        ...(validation === undefined ? [] : ["--values", validationPath]),
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

describe("Helm Escaping - Denylist Check (dist/)", () => {
  it("rejects unknown release expressions and consumer templates", () => {
    for (const [content, source] of [
      ["{{ .Values.delivery.unreviewed }}", "arcade.k8s.yaml"],
      ["{{ .Values.delivery.image }}", "arcade.k8s.yaml"],
      [
        '{{ .Values.delivery.image | default "docker.io/shepherdjerred/arcade:1" }}',
        "apps.k8s.yaml",
      ],
      ["{{ unescaped_consumer_template }}", "storm-forum.k8s.yaml"],
      [
        "{{ required `Delivery requires image` .Values.delivery.bundleKey }}",
        "storm-forum.k8s.yaml",
      ],
      [
        "{{ required `Delivery requires unreviewed` .Values.delivery.unreviewed }}",
        "storm-forum.k8s.yaml",
      ],
      [
        "{{ required `Delivery requires image` .Values.delivery.image }}",
        "apps.k8s.yaml",
      ],
    ] as const) {
      expect(() => checkForUnescapedBraces(content, source)).toThrow(
        "unescaped {{",
      );
    }
  });

  it("escapes consumer templates and permits only reviewed release expressions", async () => {
    const glob = new Glob("*.k8s.yaml");
    for await (const entry of glob.scan(DIST_DIR)) {
      const content = await Bun.file(path.join(DIST_DIR, entry)).text();
      checkForUnescapedBraces(content, entry);
    }
  });

  it("should have escaped template markers present in apps chart", async () => {
    const appsContent = await Bun.file(
      path.join(DIST_DIR, "apps.k8s.yaml"),
    ).text();
    const escapedCount = (appsContent.match(/\{\{ "\{\{" \}\}/g) ?? []).length;
    expect(escapedCount).toBeGreaterThan(0);
  });

  it("declares automated sync state explicitly for every Application", async () => {
    const implicitAutoSync: string[] = [];
    const glob = new Glob("*.k8s.yaml");
    for await (const entry of glob.scan(DIST_DIR)) {
      const content = await Bun.file(path.join(DIST_DIR, entry)).text();
      implicitAutoSync.push(...implicitAutoSyncApplications(content, entry));
    }

    expect(implicitAutoSync).toEqual([]);
  });

  it("inspects Applications nested in Kubernetes Lists", () => {
    const content = `---
scalar document
---
- array document
---
kind: List
items:
  - kind: Application
    metadata:
      name: implicit-list-application
    spec:
      syncPolicy:
        automated: {}
  - kind: Application
    metadata:
      name: explicit-list-application
    spec:
      syncPolicy:
        automated:
          enabled: true
`;

    expect(implicitAutoSyncApplications(content, "fixture.k8s.yaml")).toEqual([
      "fixture.k8s.yaml:implicit-list-application",
    ]);
  });
});

describe("Helm Escaping - helm template (dist/)", () => {
  // Renders ~24 helm charts concurrently via `helm template` subprocesses.
  // Each chart takes 50-200ms on a quiet machine; rendered in parallel the
  // whole test wraps in ~1s locally. PR #1249 raised this to 60s (see the
  // shared HELM_TEMPLATE_TIMEOUT_MS above) after the serial loop kept
  // tipping over the default 5s under concurrent CI load on torvalds
  // (single-node). Parallelization keeps wall time well under that ceiling
  // even when load slows individual subprocesses.
  it(
    "should render all charts with helm template without errors",
    async () => {
      const glob = new Glob("*/Chart.yaml");
      const chartNames: string[] = [];
      for await (const entry of glob.scan(HELM_DIR)) {
        chartNames.push(path.dirname(entry));
      }

      const results = await Promise.all(
        chartNames.map(async (chartName) => ({
          chart: chartName,
          result: await helmTemplateChart(chartName),
        })),
      );

      const failures = results
        .filter(({ result }) => result.exitCode !== 0)
        .map(({ chart, result }) => ({
          chart,
          error: result.stderr.trim(),
        }));

      if (failures.length > 0) {
        const msg = failures.map((f) => `  ${f.chart}: ${f.error}`).join("\n");
        throw new Error(
          `helm template failed for ${String(failures.length)} chart(s):\n${msg}`,
        );
      }
    },
    HELM_TEMPLATE_TIMEOUT_MS,
  );
});

describe("Helm Escaping - E2E Content Verification (dist/)", () => {
  it(
    "woodpecker chart: preserves the server's status context template after Helm",
    async () => {
      const result = await helmTemplateChart("woodpecker");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        '{{ .context }}/{{ if and (eq .event "pull_request_metadata") (eq .workflow "ci-complete") }}pr{{ else }}{{ .event }}{{ end }}/{{ .workflow }}',
      );
    },
    HELM_TEMPLATE_TIMEOUT_MS,
  );

  it(
    "apps chart: Prometheus rules contain unescaped Go templates after Helm",
    async () => {
      const result = await helmTemplateChart("apps");
      expect(result.stdout).toContain("{{ $value }}");
      expect(result.stdout).toContain("{{ $labels.");
    },
    HELM_TEMPLATE_TIMEOUT_MS,
  );

  it(
    "apps chart: event-exporter config contains unescaped Go templates after Helm",
    async () => {
      const result = await helmTemplateChart("apps");
      expect(result.stdout).toContain("{{ .InvolvedObject.Namespace }}");
      expect(result.stdout).toContain("{{ .Reason }}");
    },
    HELM_TEMPLATE_TIMEOUT_MS,
  );

  it(
    "apps chart: R2 exporter Python has correct f-string braces after Helm",
    async () => {
      const result = await helmTemplateChart("apps");
      expect(result.stdout).toContain('{cache["storage_bytes"]}');
    },
    HELM_TEMPLATE_TIMEOUT_MS,
  );

  it(
    "apps chart: Alerts receiver stays authenticated after Helm",
    async () => {
      const result = await helmTemplateChart("apps");
      expect(result.stdout).toContain(
        "url: http://alert-dashboard-alert-dashboard-service.alert-dashboard.svc.cluster.local:7341/internal/v1/alertmanager/events",
      );
      expect(result.stdout).toContain(
        "credentials_file: /etc/alertmanager/secrets/alert-dashboard-secrets/WEBHOOK_TOKEN",
      );
      expect(result.stdout).toContain("send_resolved: true");
      expect(result.stdout).toContain(
        "smtp_smarthost: postal-postal-smtp-service.postal.svc.cluster.local:25",
      );
      expect(result.stdout).toContain("smtp_require_tls: true");
      expect(result.stdout).toContain(
        "ca_file: /etc/alertmanager/secrets/alertmanager-postal-smtp-ca/ca.crt",
      );
      expect(result.stdout).not.toContain("smtp_require_tls: false");
      expect(result.stdout).not.toContain(
        "smtp_smarthost: postal-smtp-service.postal.svc.cluster.local:25",
      );
      expect(result.stdout).not.toContain("alert: KubeMemoryOvercommit");
      expect(result.stdout).toContain(
        "persistentvolumeclaims=[velero.io/backup]",
      );
    },
    HELM_TEMPLATE_TIMEOUT_MS,
  );

  it(
    "apps chart: no Helm escape artifacts remain after rendering",
    async () => {
      const result = await helmTemplateChart("apps");
      expect(result.stdout).not.toContain('{{ "{{" }}');
      expect(result.stdout).not.toContain('{{ "}}" }}');
    },
    HELM_TEMPLATE_TIMEOUT_MS,
  );

  it(
    "home chart: HA Jinja2 templates contain unescaped braces after Helm",
    async () => {
      const result = await helmTemplateChart("home");
      expect(result.stdout).toContain("{{ states");
    },
    HELM_TEMPLATE_TIMEOUT_MS,
  );

  it(
    "home chart: no Helm escape artifacts remain after rendering",
    async () => {
      const result = await helmTemplateChart("home");
      expect(result.stdout).not.toContain('{{ "{{" }}');
      expect(result.stdout).not.toContain('{{ "}}" }}');
    },
    HELM_TEMPLATE_TIMEOUT_MS,
  );
});
