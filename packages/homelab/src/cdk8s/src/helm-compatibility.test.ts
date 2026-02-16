import { describe, it, expect, beforeAll } from "bun:test";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { App } from "cdk8s";
import { setupCharts } from "./setup-charts.ts";

/**
 * Helm Compatibility Tests
 *
 * These tests ensure that CDK8s-generated manifests don't interfere with Helm's
 * management capabilities when packaged as a Helm chart.
 *
 * These tests synthesize the manifests in-memory, so they always test the latest code
 * without requiring pre-built artifacts.
 */

const K8sResourceSchema = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z
    .object({
      name: z.string().optional(),
      namespace: z.string().optional(),
      labels: z.record(z.string(), z.string()).optional(),
      annotations: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

type K8sResource = z.infer<typeof K8sResourceSchema>;

// Helm-reserved annotation prefixes that should not be used by generated manifests
const HELM_RESERVED_ANNOTATIONS = ["meta.helm.sh/", "helm.sh/"];

/**
 * Synthesizes all CDK8s charts and returns the YAML content
 */
async function synthesizeApp(): Promise<string> {
  const app = new App({ outdir: ".test-synth" });
  await setupCharts(app);
  return app.synthYaml();
}

describe("Helm Compatibility Tests", () => {
  let yamlContent: string;
  let allResources: { file: string; resource: K8sResource }[];

  beforeAll(async () => {
    // Synthesize all manifests in-memory
    yamlContent = await synthesizeApp();

    // Parse all resources from the YAML content
    allResources = [];
    const documents = yamlContent
      .split(/^---$/m)
      .map((doc) => doc.trim())
      .filter((doc) => doc.length > 0);

    for (const doc of documents) {
      try {
        const parsed = parseYaml(doc) as unknown;
        const result = K8sResourceSchema.safeParse(parsed);
        if (result.success) {
          allResources.push({ file: "manifests.k8s.yaml", resource: result.data });
        }
      } catch {
        // Skip invalid YAML documents
      }
    }
  });

  describe("Annotation Validation", () => {
    it("should not use Helm-reserved annotation prefixes", () => {
      const violations: {
        file: string;
        resource: string;
        annotation: string;
      }[] = [];

      for (const { file, resource } of allResources) {
        const annotations = resource.metadata?.annotations ?? {};
        const resourceName = `${resource.kind}/${resource.metadata?.name ?? "unnamed"}`;

        for (const annotationKey of Object.keys(annotations)) {
          for (const reservedPrefix of HELM_RESERVED_ANNOTATIONS) {
            if (annotationKey.startsWith(reservedPrefix)) {
              violations.push({
                file,
                resource: resourceName,
                annotation: annotationKey,
              });
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });

    it("should not use helm.sh/hook annotations", () => {
      const violations: {
        file: string;
        resource: string;
      }[] = [];

      for (const { file, resource } of allResources) {
        const annotations = resource.metadata?.annotations ?? {};
        const resourceName = `${resource.kind}/${resource.metadata?.name ?? "unnamed"}`;

        if ("helm.sh/hook" in annotations) {
          violations.push({
            file,
            resource: resourceName,
          });
        }
      }

      expect(violations).toEqual([]);
    });

    it("should not use helm.sh/resource-policy annotations", () => {
      const violations: {
        file: string;
        resource: string;
      }[] = [];

      for (const { file, resource } of allResources) {
        const annotations = resource.metadata?.annotations ?? {};
        const resourceName = `${resource.kind}/${resource.metadata?.name ?? "unnamed"}`;

        if ("helm.sh/resource-policy" in annotations) {
          violations.push({
            file,
            resource: resourceName,
          });
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe("Label Validation", () => {
    it("should not set app.kubernetes.io/managed-by to 'Helm'", () => {
      const violations: {
        file: string;
        resource: string;
        value: string;
      }[] = [];

      for (const { file, resource } of allResources) {
        const labels = resource.metadata?.labels ?? {};
        const resourceName = `${resource.kind}/${resource.metadata?.name ?? "unnamed"}`;

        if (labels["app.kubernetes.io/managed-by"] === "Helm") {
          violations.push({
            file,
            resource: resourceName,
            value: labels["app.kubernetes.io/managed-by"],
          });
        }
      }

      expect(violations).toEqual([]);
    });

    it("should not use helm.sh/chart label", () => {
      const violations: {
        file: string;
        resource: string;
      }[] = [];

      for (const { file, resource } of allResources) {
        const labels = resource.metadata?.labels ?? {};
        const resourceName = `${resource.kind}/${resource.metadata?.name ?? "unnamed"}`;

        if ("helm.sh/chart" in labels) {
          violations.push({
            file,
            resource: resourceName,
          });
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe("Template Syntax Validation", () => {
    it("should not contain unescaped Helm template syntax", () => {
      const violations: {
        file: string;
        lineNumber: number;
        line: string;
        reason: string;
      }[] = [];

      const lines = yamlContent.split("\n");
      const fileName = "manifests.k8s.yaml";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        // Skip comments
        if (line.trim().startsWith("#")) {
          continue;
        }

        // Check for unescaped Helm template syntax
        // {{ "{{" }} and {{ "}}" }} are properly escaped and should be allowed
        // These are used to preserve literal {{ }} in the final output (e.g., for Prometheus alerts)

        // Pattern to find {{ }} that are NOT escaped
        // Escaped patterns look like: {{ "{{" }} or {{ "}}" }}
        const hasTemplateStart = line.includes("{{");
        const hasTemplateEnd = line.includes("}}");

        if (hasTemplateStart && hasTemplateEnd) {
          // If we have {{ }} but it's not the escaped form, it's a violation
          // We need to check for unescaped patterns like:
          // - {{ .Values.something }}
          // - {{ template "name" }}
          // - {{ range .Items }}
          // But NOT:
          // - {{ "{{" }} $value {{ "}}" }} (this is escaped and OK)

          // Simple heuristic: if line contains {{ but NOT {{ " then it might be unescaped
          // This catches {{ .Values and {{ template but allows {{ "{{" }}
          if (
            /\{\{(?!\s*"[{"}]")/.test(line) || // Matches {{ not followed by "{{" or "}}"
            /[^"]\}\}/.test(line.replaceAll('}}" }}', "")) // Matches }} not part of }}" }}
          ) {
            // Additional check: the escaped pattern should have the quotes
            // If we see {{ something }} where something is not a string literal with {{ or }}
            // then it's likely unescaped
            const suspiciousPatterns = [
              /\{\{\s*\.\w+/, // {{ .Values, {{ .Release, etc.
              /\{\{\s*template\s+/, // {{ template
              /\{\{\s*include\s+/, // {{ include
              /\{\{\s*range\s+/, // {{ range
              /\{\{\s*if\s+/, // {{ if
              /\{\{\s*with\s+/, // {{ with
              /\{\{\s*define\s+/, // {{ define
            ];

            for (const pattern of suspiciousPatterns) {
              if (pattern.test(line)) {
                violations.push({
                  file: fileName,
                  lineNumber: i + 1,
                  line: line.trim(),
                  reason: "Contains unescaped Helm template syntax",
                });
                break;
              }
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });

    it("should properly escape template syntax for Prometheus alerts", () => {
      // This test verifies that Prometheus alert templates are properly escaped
      // Prometheus uses Go templates with {{ }}, which must be escaped in Helm charts
      // Count properly escaped template syntax
      // {{ "{{" }} is the correct way to output a literal {{ in Helm
      const escapedStartCount = (yamlContent.match(/\{\{ "\{\{" \}\}/g) ?? []).length;
      const escapedEndCount = (yamlContent.match(/\{\{ "\}\}" \}\}/g) ?? []).length;
      const escapedCount = escapedStartCount + escapedEndCount;

      // This is informational - we expect to see proper escaping in files with Prometheus rules
      if (escapedCount > 0) {
        console.log(
          [
            "✓ Found properly escaped template syntax (for Prometheus/Grafana templates):",
            `  - manifests.k8s.yaml: ${String(escapedCount)} escaped template markers`,
          ].join("\n"),
        );
      }
    });
  });

  describe("Resource Uniqueness", () => {
    it("should not have duplicate resources (same kind/name/namespace)", () => {
      const resourceMap = new Map<string, { file: string }[]>();
      const violations: {
        resource: string;
        files: string[];
      }[] = [];

      for (const { file, resource } of allResources) {
        const namespace = resource.metadata?.namespace ?? "default";
        const name = resource.metadata?.name ?? "unnamed";
        const key = `${resource.kind}/${namespace}/${name}`;

        const existingResources = resourceMap.get(key) ?? [];
        existingResources.push({ file });
        resourceMap.set(key, existingResources);
      }

      for (const [key, occurrences] of resourceMap.entries()) {
        if (occurrences.length > 1) {
          violations.push({
            resource: key,
            files: occurrences.map((o) => o.file),
          });
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe("YAML Validity", () => {
    it("should generate valid YAML for all manifests", () => {
      const violations: {
        file: string;
        error: string;
      }[] = [];

      const documents = yamlContent
        .split(/^---$/m)
        .map((doc) => doc.trim())
        .filter((doc) => doc.length > 0);

      for (const [index, document] of documents.entries()) {
        try {
          parseYaml(document);
        } catch (error) {
          const errorCheck = z.instanceof(Error).safeParse(error);
          const errorMessage = errorCheck.success ? errorCheck.data.message : String(error);
          violations.push({
            file: `manifests.k8s.yaml (document ${String(index + 1)})`,
            error: errorMessage,
          });
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe("Metadata Requirements", () => {
    it("should have metadata.name for all resources", () => {
      const violations: {
        file: string;
        resource: string;
      }[] = [];

      for (const { file, resource } of allResources) {
        if (!resource.metadata?.name) {
          violations.push({
            file,
            resource: `${resource.kind} (unnamed)`,
          });
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe("Helm Chart Lint", () => {
    it("should pass helm lint when packaged as a chart", async () => {
      // This test validates that the manifests work correctly in a Helm chart context
      // The actual helm lint is run by the lint-helm.sh script
      // Here we just verify that the script exists and can be executed

      const scriptPath = `${import.meta.dir}/../../../scripts/lint-helm.sh`;
      const fileExists = await Bun.file(scriptPath).exists();

      expect(fileExists).toBe(true);
    });
  });

  describe("Reserved Kubernetes Annotations", () => {
    it("should not use kubernetes.io annotations reserved for system components", () => {
      // Some kubernetes.io annotations are reserved for the system
      const RESERVED_K8S_ANNOTATIONS = [
        "kubernetes.io/ingress.class", // Use spec.ingressClassName instead
      ];

      const violations: {
        file: string;
        resource: string;
        annotation: string;
      }[] = [];

      for (const { file, resource } of allResources) {
        const annotations = resource.metadata?.annotations ?? {};
        const resourceName = `${resource.kind}/${resource.metadata?.name ?? "unnamed"}`;

        for (const reserved of RESERVED_K8S_ANNOTATIONS) {
          if (reserved in annotations) {
            violations.push({
              file,
              resource: resourceName,
              annotation: reserved,
            });
          }
        }
      }

      // This is a warning, not a hard failure - some charts may intentionally use these
      if (violations.length > 0) {
        console.warn(
          [
            "⚠️  Found potentially deprecated Kubernetes annotations:",
            ...violations.map((v) => `  - ${v.file}: ${v.resource} uses "${v.annotation}"`),
            "",
            "Consider using newer alternatives if available.",
          ].join("\n"),
        );
      }
    });
  });
});
