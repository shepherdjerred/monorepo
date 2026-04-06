import { describe, it, expect } from "bun:test";
import { Glob } from "bun";
import path from "node:path";

/**
 * Helm Template Rendering Tests
 *
 * These tests validate the full Helm rendering pipeline using pre-built dist/ files.
 * They do NOT require CDK8s synthesis — they test the actual artifacts that get
 * packaged into Helm charts and deployed via ArgoCD.
 *
 * Pipeline: TypeScript → CDK8s synth → YAML (dist/) → Helm chart → ArgoCD helm template → K8s
 *
 * See: packages/docs/guides/2026-04-04_helm-escaping-pipeline.md
 */

const HELM_DIR = path.join(import.meta.dir, "../helm");
const DIST_DIR = path.join(import.meta.dir, "../dist");

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
    const stripped = line
      .replaceAll('{{ "{{" }}', "")
      .replaceAll('{{ "}}" }}', "")
      .replaceAll('{{ print "{{" }}', "")
      .replaceAll('{{ print "}}" }}', "")
      .replaceAll("{{ `{{` }}", "")
      .replaceAll("{{ `}}` }}", "");

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
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  const tempDir = path.join(
    import.meta.dir,
    `../.helm-test-${chartName}-${String(Date.now())}`,
  );
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

    const result = Bun.spawnSync(["helm", "template", "test-release", tempDir]);
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } finally {
    const proc = Bun.spawnSync(["rm", "-rf", tempDir]);
    if (proc.exitCode !== 0) {
      console.warn(`Failed to clean up ${tempDir}`);
    }
  }
}

describe("Helm Escaping - Denylist Check (dist/)", () => {
  it("should not contain unescaped {{ in any dist file", async () => {
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
});

describe("Helm Escaping - helm template (dist/)", () => {
  it("should render all charts with helm template without errors", async () => {
    const glob = new Glob("*/Chart.yaml");
    const chartNames: string[] = [];
    for await (const entry of glob.scan(HELM_DIR)) {
      chartNames.push(path.dirname(entry));
    }

    const failures: { chart: string; error: string }[] = [];

    for (const chartName of chartNames) {
      const result = await helmTemplateChart(chartName);
      if (result.exitCode !== 0) {
        failures.push({ chart: chartName, error: result.stderr.trim() });
      }
    }

    if (failures.length > 0) {
      const msg = failures.map((f) => `  ${f.chart}: ${f.error}`).join("\n");
      throw new Error(
        `helm template failed for ${String(failures.length)} chart(s):\n${msg}`,
      );
    }
  });
});

describe("Helm Escaping - E2E Content Verification (dist/)", () => {
  it("apps chart: Prometheus rules contain unescaped Go templates after Helm", async () => {
    const result = await helmTemplateChart("apps");
    expect(result.stdout).toContain("{{ $value }}");
    expect(result.stdout).toContain("{{ $labels.");
  });

  it("apps chart: event-exporter config contains unescaped Go templates after Helm", async () => {
    const result = await helmTemplateChart("apps");
    expect(result.stdout).toContain("{{ .InvolvedObject.Namespace }}");
    expect(result.stdout).toContain("{{ .Reason }}");
  });

  it("apps chart: R2 exporter Python has correct f-string braces after Helm", async () => {
    const result = await helmTemplateChart("apps");
    expect(result.stdout).toContain('{metrics_cache["storage_bytes"]}');
  });

  it("apps chart: PagerDuty config contains unescaped Alertmanager templates after Helm", async () => {
    const result = await helmTemplateChart("apps");
    expect(result.stdout).toContain("{{ range .Alerts }}");
    expect(result.stdout).toContain("{{ .Annotations.summary }}");
  });

  it("apps chart: no Helm escape artifacts remain after rendering", async () => {
    const result = await helmTemplateChart("apps");
    expect(result.stdout).not.toContain('{{ "{{" }}');
    expect(result.stdout).not.toContain('{{ "}}" }}');
  });

  it("home chart: HA Jinja2 templates contain unescaped braces after Helm", async () => {
    const result = await helmTemplateChart("home");
    expect(result.stdout).toContain("{{ states");
  });

  it("home chart: no Helm escape artifacts remain after rendering", async () => {
    const result = await helmTemplateChart("home");
    expect(result.stdout).not.toContain('{{ "{{" }}');
    expect(result.stdout).not.toContain('{{ "}}" }}');
  });
});
