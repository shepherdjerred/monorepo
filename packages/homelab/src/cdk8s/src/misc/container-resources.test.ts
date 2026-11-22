import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { App } from "cdk8s";
import { rm } from "node:fs/promises";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import {
  BATCH_PRIORITY,
  BURST_SERVICE_PRIORITY,
  SERVICE_PRIORITY,
} from "./priority-classes.ts";
import {
  workloadContainers,
  type ContainerResources,
  type FoundContainer,
} from "@shepherdjerred/homelab/cdk8s/src/testing/workload-containers.ts";
import {
  BEST_EFFORT_CONTAINER_ALLOWLIST,
  PARTIAL_REQUEST_CONTAINER_ALLOWLIST,
} from "./container-resource-allowlist.ts";

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

const MinecraftApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.object({
    source: z.object({
      helm: z.object({ valuesObject: z.record(z.string(), z.unknown()) }),
    }),
  }),
});

async function synthesizeApp(): Promise<string> {
  const app = new App({ outdir: SYNTH_OUTDIR });
  await setupCharts(app);
  return app.synthYaml();
}

function parseDocument(doc: string): unknown {
  try {
    return parseYaml(doc);
  } catch {
    return undefined; // non-resource documents (e.g. Helm-templated strings)
  }
}

function collectContainers(yamlContent: string): {
  all: FoundContainer[];
  missing: FoundContainer[];
} {
  const all = yamlContent
    .split(/^---$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0)
    .flatMap((doc) => workloadContainers(parseDocument(doc)));

  return { all, missing: all.filter((c) => !c.hasRequests) };
}

const SYNTH_OUTDIR = ".test-synth-container-resources";

let collected: { all: FoundContainer[]; missing: FoundContainer[] };
let documents: unknown[];

beforeAll(async () => {
  const yaml = await synthesizeApp();
  collected = collectContainers(yaml);
  documents = yaml
    .split(/^---$/m)
    .filter((doc) => doc.trim().length > 0)
    .map((doc) => parseYaml(doc));
});

afterAll(async () => {
  await rm(SYNTH_OUTDIR, { recursive: true, force: true });
});

// Declared requests. Live production pods on torvalds run with these scaled
// at admission by the request overcommit policy
// (src/resources/cluster-baseline/request-overcommit.ts).
const AUDITED_PERSISTENT_RESERVATIONS = new Map<string, ContainerResources>([
  [
    "birmel/main",
    {
      requests: { cpu: "50m", memory: "224Mi" },
      limits: { memory: "2048Mi" },
    },
  ],
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
  ["media-qbittorrent/gluetun", { requests: { cpu: "25m", memory: "64Mi" } }],
  [
    "media-qbittorrent/qbittorrent",
    {
      requests: { cpu: "200m", memory: "256Mi" },
      limits: { cpu: "2000m", memory: "6144Mi" },
    },
  ],
  [
    "media-qbittorrent/qbittorrent-exporter",
    { requests: { cpu: "10m", memory: "64Mi" } },
  ],
  [
    "media-plex/main",
    { requests: { memory: "2816Mi" }, limits: { memory: "20480Mi" } },
  ],
  ["media-plex/plex-exporter", { requests: { cpu: "10m", memory: "32Mi" } }],
  [
    "arcade/main",
    {
      requests: { cpu: "2", memory: "256Mi" },
      limits: { cpu: "12", memory: "16384Mi" },
    },
  ],
  [
    "stash/stash",
    {
      requests: { cpu: "250m", memory: "96Mi" },
      limits: { cpu: "4", memory: "4096Mi" },
    },
  ],
  [
    "pinchtab/main",
    {
      requests: { cpu: "250m", memory: "1024Mi" },
      limits: { cpu: "2000m", memory: "4096Mi" },
    },
  ],
  [
    "scout-beta-scout-backend/main",
    {
      requests: { cpu: "50m", memory: "2816Mi" },
      limits: { memory: "8192Mi" },
    },
  ],
  [
    "scout-prod-scout-backend/main",
    {
      requests: { cpu: "100m", memory: "2816Mi" },
      limits: { memory: "8192Mi" },
    },
  ],
  [
    "temporal-temporal-workflows-candidate/temporal-workflows-candidate",
    {
      requests: { cpu: "250m", memory: "512Mi" },
      limits: { cpu: "1000m", memory: "2048Mi" },
    },
  ],
  [
    "temporal-temporal-gateway/temporal-gateway",
    { requests: { cpu: "100m", memory: "256Mi" } },
  ],
  [
    "temporal-temporal-home-worker/temporal-home-worker",
    { requests: { cpu: "100m", memory: "288Mi" } },
  ],
  [
    "temporal-temporal-reports-worker/temporal-reports-worker",
    { requests: { cpu: "100m", memory: "352Mi" } },
  ],
  [
    "temporal-temporal-infra-worker/temporal-infra-worker",
    {
      requests: { cpu: "500m", memory: "2176Mi" },
      limits: { cpu: "1500m", memory: "6144Mi" },
    },
  ],
  [
    "temporal-temporal-repo-worker/temporal-repo-worker",
    {
      requests: { cpu: "250m", memory: "288Mi" },
      limits: { cpu: "1500m", memory: "4096Mi" },
    },
  ],
  [
    "temporal-temporal-scout-worker/temporal-scout-worker",
    {
      requests: { cpu: "250m", memory: "512Mi" },
      limits: { cpu: "1500m", memory: "4096Mi" },
    },
  ],
  [
    "temporal-temporal-glitter-corpus-worker/temporal-glitter-corpus-worker",
    {
      requests: { cpu: "250m", memory: "352Mi" },
      limits: { cpu: "1", memory: "4096Mi" },
    },
  ],
  [
    "temporal-temporal-glitter-context-worker/temporal-glitter-context-worker",
    {
      requests: { cpu: "250m", memory: "320Mi" },
      limits: { cpu: "2", memory: "6144Mi" },
    },
  ],
  [
    "temporal-temporal-agent-worker/temporal-agent-worker",
    {
      requests: { cpu: "250m", memory: "256Mi" },
      limits: { cpu: "1500m", memory: "1024Mi" },
    },
  ],
]);

describe("Container resource requests backstop", () => {
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
    for (const [key, resources] of AUDITED_PERSISTENT_RESERVATIONS) {
      const found = collected.all.find(
        ({ workload, container }) => `${workload}/${container}` === key,
      );
      expect(found, `missing ${key}`).toBeDefined();
      expect(found?.resources, key).toEqual(resources);
    }
  });
});

describe("Burst-memory sharing policy", () => {
  it("only lets interactive services preempt lower-priority batch workers", () => {
    const schema = z.object({
      kind: z.literal("PriorityClass"),
      metadata: z.object({
        name: z.string(),
        annotations: z.record(z.string(), z.string()).optional(),
      }),
      value: z.number(),
      globalDefault: z.boolean(),
      preemptionPolicy: z.string(),
    });
    const classes = documents.flatMap((doc) => {
      const result = schema.safeParse(doc);
      return result.success ? [result.data] : [];
    });
    const burst = classes.find(
      (item) => item.metadata.name === BURST_SERVICE_PRIORITY,
    );
    const standard = classes.find(
      (item) => item.metadata.name === SERVICE_PRIORITY,
    );
    const batch = classes.find((item) => item.metadata.name === BATCH_PRIORITY);
    expect([burst, standard, batch].every(Boolean)).toBe(true);
    expect(burst?.value).toBe(100_000);
    expect(burst?.value).toBe(standard?.value);
    expect(batch?.value).toBe(1000);
    expect(burst?.globalDefault).toBe(false);
    expect(burst?.preemptionPolicy).toBe("PreemptLowerPriority");
    expect(burst?.metadata.annotations?.["argocd.argoproj.io/sync-wave"]).toBe(
      "-1",
    );
    expect(standard?.globalDefault).toBe(true);
    expect(standard?.preemptionPolicy).toBe("Never");
    expect(batch?.preemptionPolicy).toBe("Never");
    const expected = new Map([
      ["media-plex", BURST_SERVICE_PRIORITY],
      ["arcade", BURST_SERVICE_PRIORITY],
      ["temporal-temporal-glitter-corpus-worker", BATCH_PRIORITY],
      ["temporal-temporal-glitter-context-worker", BATCH_PRIORITY],
    ]);
    for (const [name, priority] of expected) {
      const containers = collected.all.filter(
        (container) => container.workload === name,
      );
      expect(containers.length, name).toBeGreaterThan(0);
      for (const container of containers) {
        expect(container.priorityClassName, name).toBe(priority);
      }
    }
    for (const name of [
      "temporal-temporal-workflows-candidate",
      "temporal-temporal-infra-worker",
      "temporal-temporal-billing-worker",
    ]) {
      const container = collected.all.find((item) => item.workload === name);
      expect(container, name).toBeDefined();
      expect(container?.priorityClassName, name).toBeUndefined();
    }
  });
  it("keeps Minecraft heaps and reservations while enabling burst preemption", () => {
    const applications = documents.flatMap((doc) => {
      const result = MinecraftApplicationSchema.safeParse(doc);
      return result.success ? [result.data] : [];
    });
    const values = applications.find(
      (app) => app.metadata.name === "minecraft-tsmc",
    )?.spec.source.helm.valuesObject;
    expect(values, "minecraft-tsmc").toBeDefined();
    expect(values?.["extraPodSpec"], "minecraft-tsmc").toEqual({
      priorityClassName: BURST_SERVICE_PRIORITY,
      automountServiceAccountToken: "false",
    });
    expect(values?.["replicaCount"], "minecraft-tsmc").toBe(1);
    expect(values?.["workloadAsStatefulSet"], "minecraft-tsmc").toBe(true);
    expect(values?.["resources"], "minecraft-tsmc").toEqual({
      requests: { cpu: "3", memory: "11648Mi" },
      limits: { memory: "16Gi" },
    });
    expect(values?.["minecraftServer"], "minecraft-tsmc").toMatchObject({
      memory: "8G",
      extraPorts: expect.arrayContaining([
        {
          service: { enabled: true, port: 8100 },
          protocol: "TCP",
          containerPort: 8100,
          name: "bluemap",
          ingress: { enabled: false },
        },
      ]),
    });
    const tempo = applications.find((app) => app.metadata.name === "tempo");
    expect(tempo).toBeDefined();
    expect(tempo?.spec.source.helm.valuesObject["tempo"]).toMatchObject({
      resources: {
        requests: { cpu: "250m", memory: "1Gi" },
        limits: { memory: "4Gi" },
      },
    });
  });
});
