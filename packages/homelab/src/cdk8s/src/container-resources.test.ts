import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { App } from "cdk8s";
import { rm } from "node:fs/promises";
import { setupCharts } from "./setup-charts.ts";
import {
  BEST_EFFORT_CONTAINER_ALLOWLIST,
  PARTIAL_REQUEST_CONTAINER_ALLOWLIST,
} from "./misc/container-resource-allowlist.ts";

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
      limits: z
        .object({
          cpu: z.union([z.string(), z.number()]).optional(),
          memory: z.union([z.string(), z.number()]).optional(),
        })
        .optional(),
    })
    .loose()
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
]);

type FoundContainer = {
  workload: string;
  container: string;
  kind: string;
  init: boolean;
  hasRequests: boolean;
  resources: z.infer<typeof ContainerSchema>["resources"];
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
    resources: container.resources,
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
        !BEST_EFFORT_CONTAINER_ALLOWLIST.has(`${workload}/${container}`) &&
        !PARTIAL_REQUEST_CONTAINER_ALLOWLIST.has(`${workload}/${container}`),
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

    const stalePartial = [...PARTIAL_REQUEST_CONTAINER_ALLOWLIST].filter(
      (key) => !missingKeys.has(key),
    );
    expect(stalePartial).toEqual([]);
  });

  it("keeps partial-request exceptions separate from BestEffort", () => {
    for (const key of PARTIAL_REQUEST_CONTAINER_ALLOWLIST) {
      const found = collected.all.find(
        ({ workload, container }) => `${workload}/${container}` === key,
      );
      expect(found, `missing ${key}`).toBeDefined();
      const requests = found?.resources?.requests;
      expect(
        requests?.cpu !== undefined || requests?.memory !== undefined,
        `${key} must reserve at least one scheduling dimension`,
      ).toBe(true);
    }
  });

  it("keeps audited persistent workload reservations exact", () => {
    const expected = new Map<
      string,
      z.infer<typeof ContainerSchema>["resources"]
    >([
      ["birmel/main", { requests: { cpu: "50m", memory: "1280Mi" } }],
      [
        "buildkitd/buildkitd",
        {
          requests: { cpu: "500m", memory: "5120Mi" },
          limits: { cpu: "8", memory: "32768Mi" },
        },
      ],
      [
        "media-qbittorrent/qbittorrent-config-seed",
        { requests: { cpu: "10m", memory: "16Mi" } },
      ],
      [
        "media-qbittorrent/gluetun",
        { requests: { cpu: "25m", memory: "128Mi" } },
      ],
      [
        "media-qbittorrent/qbittorrent",
        {
          requests: { cpu: "200m", memory: "4608Mi" },
          limits: { cpu: "2000m", memory: "6144Mi" },
        },
      ],
      [
        "media-qbittorrent/qbittorrent-exporter",
        { requests: { cpu: "10m", memory: "64Mi" } },
      ],
      ["media-plex/main", { requests: { memory: "8192Mi" }, limits: {} }],
      [
        "media-plex/plex-exporter",
        { requests: { cpu: "10m", memory: "32Mi" } },
      ],
      [
        "mario-kart/main",
        {
          requests: { cpu: "1000m", memory: "1792Mi" },
          limits: { cpu: "8000m", memory: "4096Mi" },
        },
      ],
      [
        "pinchtab/main",
        {
          requests: { cpu: "250m", memory: "512Mi" },
          limits: { cpu: "2000m", memory: "4096Mi" },
        },
      ],
      [
        "scout-beta-scout-backend/main",
        { requests: { cpu: "50m", memory: "2048Mi" } },
      ],
      [
        "scout-prod-scout-backend/main",
        { requests: { cpu: "100m", memory: "2560Mi" } },
      ],
      [
        "temporal-temporal-worker/temporal-worker",
        {
          requests: { cpu: "500m", memory: "3072Mi" },
          limits: { cpu: "1500m", memory: "6144Mi" },
        },
      ],
      [
        "temporal-temporal-glitter-worker/temporal-glitter-worker",
        {
          requests: { cpu: "1", memory: "3072Mi" },
          limits: { cpu: "2", memory: "6144Mi" },
        },
      ],
      [
        "temporal-temporal-agent-worker/temporal-agent-worker",
        {
          requests: { cpu: "500m", memory: "768Mi" },
          limits: { cpu: "1500m", memory: "1024Mi" },
        },
      ],
    ]);

    for (const [key, resources] of expected) {
      const found = collected.all.find(
        ({ workload, container }) => `${workload}/${container}` === key,
      );
      expect(found, `missing ${key}`).toBeDefined();
      expect(found?.resources, key).toEqual(resources);
    }
  });
});
