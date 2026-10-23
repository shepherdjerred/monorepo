import { describe, it, expect, beforeAll } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { App } from "cdk8s";
import { setupCharts } from "./setup-charts.ts";
import { ARGOCD_SYNC_OPTIONS_ANNOTATION } from "./application-release-policy.ts";
import { transitionRendering } from "./release-configuration.ts";
import {
  BASELINE_CHART_APPLICATIONS,
  ROOT_CHART,
} from "./resources/cluster-baseline/charts.ts";
import { COMPANION_CHARTS } from "./resources/companions/names.ts";

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

/** Every synthesized resource with the chart that renders it. */
async function synthesizeChartResources(): Promise<
  { chart: string; resource: unknown }[]
> {
  const app = new App({ outdir: ".test-synth" });
  await setupCharts(app);
  return app.charts.flatMap((chart) =>
    z
      .array(z.unknown())
      .parse(chart.toJson())
      .map((resource) => ({ chart: chart.node.id, resource })),
  );
}

/** Data-layer charts and the application chart each takes its cluster from. */
const DATA_LAYER_CHARTS: Readonly<Record<string, string>> = {
  "delivery-data": "delivery",
  "temporal-data": "temporal",
};

function withoutRetention(resource: unknown): unknown {
  const parsed = z
    .looseObject({
      metadata: z.looseObject({
        annotations: z.record(z.string(), z.string()).optional(),
      }),
    })
    .parse(resource);
  const annotations = Object.fromEntries(
    Object.entries(parsed.metadata.annotations ?? {}).filter(
      ([key]) => key !== ARGOCD_SYNC_OPTIONS_ANNOTATION,
    ),
  );
  return {
    ...parsed,
    metadata: {
      ...parsed.metadata,
      annotations:
        Object.keys(annotations).length === 0 ? undefined : annotations,
    },
  };
}

/**
 * The duplications the Delivery v2 cutover declares: a cluster baseline or
 * companion chart mirroring the root's own object (`cluster-baseline.test.ts`,
 * `resources/companions/names.ts`), and,
 * until transition rendering moves them, a data-layer chart rendering the
 * application chart's database objects plus retention. Each pair must be the
 * same object; anything else is an accidental duplicate.
 */
function isDeclaredMirror(
  occurrences: readonly { chart: string; resource: unknown }[],
): boolean {
  if (occurrences.length !== 2) return false;
  const [first, second] = occurrences;
  if (first === undefined || second === undefined) return false;
  const charts = new Set([first.chart, second.chart]);
  if (
    charts.has(ROOT_CHART) &&
    [...BASELINE_CHART_APPLICATIONS, ...COMPANION_CHARTS].some((chart) =>
      charts.has(chart),
    )
  )
    return Bun.deepEquals(first.resource, second.resource, true);
  const data = [first, second].find(
    (occurrence) => DATA_LAYER_CHARTS[occurrence.chart] !== undefined,
  );
  const application = [first, second].find((occurrence) => occurrence !== data);
  return (
    !transitionRendering() &&
    data !== undefined &&
    application !== undefined &&
    DATA_LAYER_CHARTS[data.chart] === application.chart &&
    Bun.deepEquals(
      withoutRetention(data.resource),
      withoutRetention(application.resource),
      true,
    )
  );
}

/**
 * Parse all K8s resources from synthesized YAML content
 */
function parseResources(
  yamlContent: string,
): { file: string; resource: K8sResource }[] {
  const resources: { file: string; resource: K8sResource }[] = [];
  const documents = yamlContent
    .split(/^---$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0);

  for (const doc of documents) {
    try {
      const parsed = parseYaml(doc) as unknown;
      const result = K8sResourceSchema.safeParse(parsed);
      if (result.success) {
        resources.push({
          file: "manifests.k8s.yaml",
          resource: result.data,
        });
      }
    } catch {
      // Skip invalid YAML documents
    }
  }

  return resources;
}

describe("Helm Compatibility - Annotations and Labels", () => {
  let allResources: { file: string; resource: K8sResource }[];

  beforeAll(async () => {
    const yamlContent = await synthesizeApp();
    allResources = parseResources(yamlContent);
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

  describe("Reserved Kubernetes Annotations", () => {
    it("should not use kubernetes.io annotations reserved for system components", () => {
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

      if (violations.length > 0) {
        console.warn(
          [
            "Warning: Found potentially deprecated Kubernetes annotations:",
            ...violations.map(
              (v) => `  - ${v.file}: ${v.resource} uses "${v.annotation}"`,
            ),
            "",
            "Consider using newer alternatives if available.",
          ].join("\n"),
        );
      }
    });
  });
});

describe("Helm Compatibility - Templates and Structure", () => {
  let yamlContent: string;
  let allResources: { file: string; resource: K8sResource }[];

  beforeAll(async () => {
    yamlContent = await synthesizeApp();
    allResources = parseResources(yamlContent);
  });

  // Template syntax validation moved to helm-template.test.ts (reads from dist/ without synthesis)

  describe("Resource Uniqueness", () => {
    it("should not have duplicate resources (same kind/name/namespace)", async () => {
      const resourceMap = new Map<
        string,
        { chart: string; resource: unknown }[]
      >();
      for (const { chart, resource } of await synthesizeChartResources()) {
        const parsed = K8sResourceSchema.parse(resource);
        const namespace = parsed.metadata?.namespace ?? "default";
        const name = parsed.metadata?.name ?? "unnamed";
        const key = `${parsed.kind}/${namespace}/${name}`;
        const existing = resourceMap.get(key) ?? [];
        existing.push({ chart, resource });
        resourceMap.set(key, existing);
      }

      const violations: { resource: string; charts: string[] }[] = [];
      for (const [key, occurrences] of resourceMap.entries()) {
        if (occurrences.length > 1 && !isDeclaredMirror(occurrences)) {
          violations.push({
            resource: key,
            charts: occurrences.map((o) => o.chart),
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
          const errorMessage = errorCheck.success
            ? errorCheck.data.message
            : String(error);
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
});
