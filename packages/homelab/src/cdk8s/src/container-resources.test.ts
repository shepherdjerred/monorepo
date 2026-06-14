import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { App } from "cdk8s";
import { rm } from "node:fs/promises";
import { setupCharts } from "./setup-charts.ts";
import { BEST_EFFORT_CONTAINER_ALLOWLIST } from "./misc/container-resource-allowlist.ts";

/**
 * Container Resources Backstop
 *
 * Every container and init container synthesized by cdk8s must declare CPU and
 * memory requests, unless it is deliberately BestEffort and listed (with a
 * rationale) in misc/container-resource-allowlist.ts.
 *
 * This complements the `custom-rules/require-container-resources` ESLint rule:
 * the rule forces a visible decision at each cdk8s-plus addContainer call site,
 * while this test also covers raw ApiObject manifests and catches allowlist
 * drift in the final synthesized YAML.
 */

const ContainerSchema = z.object({
  name: z.string().optional(),
  resources: z
    .object({
      requests: z
        .object({
          cpu: z.union([z.string(), z.number()]).optional(),
          memory: z.union([z.string(), z.number()]).optional(),
        })
        .optional(),
    })
    .optional(),
});

const PodSpecSchema = z.object({
  containers: z.array(ContainerSchema).optional(),
  initContainers: z.array(ContainerSchema).optional(),
});

const WorkloadSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string().optional() }).optional(),
  spec: z
    .object({
      template: z.object({ spec: PodSpecSchema.optional() }).optional(),
      jobTemplate: z
        .object({
          spec: z
            .object({
              template: z.object({ spec: PodSpecSchema.optional() }).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

const WORKLOAD_KINDS = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
]);

type FoundContainer = {
  workload: string;
  container: string;
  kind: string;
  init: boolean;
  hasRequests: boolean;
};

async function synthesizeApp(): Promise<string> {
  const app = new App({ outdir: SYNTH_OUTDIR });
  await setupCharts(app);
  return app.synthYaml();
}

function parseWorkload(
  doc: string,
): z.infer<typeof WorkloadSchema> | undefined {
  let parsed: unknown;
  try {
    parsed = parseYaml(doc);
  } catch {
    return undefined; // non-resource documents (e.g. Helm-templated strings)
  }
  const result = WorkloadSchema.safeParse(parsed);
  if (!result.success || !WORKLOAD_KINDS.has(result.data.kind)) {
    return undefined;
  }
  return result.data;
}

function hasRequests(container: z.infer<typeof ContainerSchema>): boolean {
  const requests = container.resources?.requests;
  return requests?.cpu != null && requests.memory != null;
}

/** Flatten a workload's main + init containers into FoundContainer records. */
function containersOf(
  workload: z.infer<typeof WorkloadSchema>,
): FoundContainer[] {
  const podSpec =
    workload.spec?.template?.spec ??
    workload.spec?.jobTemplate?.spec?.template?.spec;
  if (!podSpec) {
    return [];
  }
  const name = workload.metadata?.name ?? "<unnamed>";
  const toFound = (
    container: z.infer<typeof ContainerSchema>,
    init: boolean,
  ): FoundContainer => ({
    workload: name,
    container: container.name ?? "<unnamed>",
    kind: workload.kind,
    init,
    hasRequests: hasRequests(container),
  });
  return [
    ...(podSpec.containers ?? []).map((c) => toFound(c, false)),
    ...(podSpec.initContainers ?? []).map((c) => toFound(c, true)),
  ];
}

function collectContainers(yamlContent: string): {
  all: FoundContainer[];
  missing: FoundContainer[];
} {
  const all = yamlContent
    .split(/^---$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0)
    .flatMap((doc) => {
      const workload = parseWorkload(doc);
      return workload ? containersOf(workload) : [];
    });

  return { all, missing: all.filter((c) => !c.hasRequests) };
}

const SYNTH_OUTDIR = ".test-synth-container-resources";

describe("Container resource requests backstop", () => {
  let collected: { all: FoundContainer[]; missing: FoundContainer[] };

  beforeAll(async () => {
    collected = collectContainers(await synthesizeApp());
  });

  afterAll(async () => {
    await rm(SYNTH_OUTDIR, { recursive: true, force: true });
  });

  it("synthesizes a meaningful number of containers (sanity check)", () => {
    expect(collected.all.length).toBeGreaterThan(50);
  });

  it("every container has cpu+memory requests or an allowlist entry", () => {
    const unexpected = collected.missing.filter(
      ({ workload, container }) =>
        !BEST_EFFORT_CONTAINER_ALLOWLIST.has(`${workload}/${container}`),
    );
    expect(
      unexpected.map(
        (c) =>
          `${c.kind} ${c.workload}/${c.container}${c.init ? " (init)" : ""}`,
      ),
    ).toEqual([]);
  });

  it("allowlist has no stale entries", () => {
    const missingKeys = new Set(
      collected.missing.map(
        ({ workload, container }) => `${workload}/${container}`,
      ),
    );
    const stale = [...BEST_EFFORT_CONTAINER_ALLOWLIST].filter(
      (key) => !missingKeys.has(key),
    );
    expect(stale).toEqual([]);
  });
});
