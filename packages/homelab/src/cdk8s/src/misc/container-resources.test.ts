import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { App } from "cdk8s";
import { rm } from "node:fs/promises";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import {
  BATCH_PRIORITY,
  BURST_SERVICE_PRIORITY,
  SERVICE_PRIORITY,
} from "./priority-classes.ts";
import {
  BEST_EFFORT_CONTAINER_ALLOWLIST,
  PARTIAL_REQUEST_CONTAINER_ALLOWLIST,
} from "./container-resource-allowlist.ts";

const LEGACY_DISCORD_MOD_PATH =
  "/data/mods/dcintegration-forge-2.4.7.1-1.12.jar";
const LEGACY_DISCORD_MOD_CLEANUP = expect.arrayContaining([
  expect.stringContaining(LEGACY_DISCORD_MOD_PATH),
]);

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
  priorityClassName: z.string().optional(),
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

const MinecraftApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    source: z.object({
      helm: z.object({ valuesObject: z.record(z.string(), z.unknown()) }),
    }),
    ignoreDifferences: z
      .array(
        z.object({
          group: z.string().optional(),
          kind: z.string(),
          jsonPointers: z.array(z.string()),
        }),
      )
      .optional(),
    syncPolicy: z.object({
      automated: z.object({
        enabled: z.boolean(),
        prune: z.boolean().optional(),
      }),
    }),
  }),
});

function expectSjerredPostCutoverCleanup(
  application: z.infer<typeof MinecraftApplicationSchema> | undefined,
): void {
  expect(
    application?.spec.source.helm.valuesObject["deploymentAnnotations"],
  ).toBeUndefined();
  expect(application?.spec.syncPolicy.automated).toEqual({
    enabled: true,
  });
  expect(application?.spec.ignoreDifferences).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        group: "apps",
        kind: "StatefulSet",
        jsonPointers: expect.not.arrayContaining([
          "/spec/volumeClaimTemplates",
        ]),
      }),
    ]),
  );
}

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
  priorityClassName: string | undefined;
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
  return !result.success || !WORKLOAD_KINDS.has(result.data.kind)
    ? undefined
    : result.data;
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
    priorityClassName: podSpec.priorityClassName,
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
    const expected = new Map<
      string,
      z.infer<typeof ContainerSchema>["resources"]
    >([
      [
        "birmel/main",
        {
          requests: { cpu: "50m", memory: "768Mi" },
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
      [
        "media-plex/main",
        { requests: { memory: "4096Mi" }, limits: { memory: "12288Mi" } },
      ],
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
        {
          requests: { cpu: "50m", memory: "3072Mi" },
          limits: { memory: "8192Mi" },
        },
      ],
      [
        "scout-prod-scout-backend/main",
        {
          requests: { cpu: "100m", memory: "2560Mi" },
          limits: { memory: "8192Mi" },
        },
      ],
      [
        "temporal-temporal-workflows-stable/temporal-workflows-stable",
        {
          requests: { cpu: "250m", memory: "1536Mi" },
          limits: { cpu: "1000m", memory: "2048Mi" },
        },
      ],
      [
        "temporal-temporal-workflows-candidate/temporal-workflows-candidate",
        {
          requests: { cpu: "250m", memory: "1536Mi" },
          limits: { cpu: "1000m", memory: "2048Mi" },
        },
      ],
      [
        "temporal-temporal-gateway/temporal-gateway",
        { requests: { cpu: "100m", memory: "256Mi" } },
      ],
      [
        "temporal-temporal-home-worker/temporal-home-worker",
        { requests: { cpu: "100m", memory: "512Mi" } },
      ],
      [
        "temporal-temporal-reports-worker/temporal-reports-worker",
        { requests: { cpu: "100m", memory: "512Mi" } },
      ],
      [
        "temporal-temporal-infra-worker/temporal-infra-worker",
        {
          requests: { cpu: "500m", memory: "768Mi" },
          limits: { cpu: "1500m", memory: "6144Mi" },
        },
      ],
      [
        "temporal-temporal-repo-worker/temporal-repo-worker",
        {
          requests: { cpu: "250m", memory: "512Mi" },
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
          requests: { cpu: "250m", memory: "768Mi" },
          limits: { cpu: "1", memory: "4096Mi" },
        },
      ],
      [
        "temporal-temporal-glitter-context-worker/temporal-glitter-context-worker",
        {
          requests: { cpu: "750m", memory: "512Mi" },
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
      ["mario-kart", BURST_SERVICE_PRIORITY],
      ["pokemon", BURST_SERVICE_PRIORITY],
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
      "temporal-temporal-workflows-stable",
      "temporal-temporal-workflows-candidate",
      "temporal-temporal-infra-worker",
      "temporal-temporal-backup-worker",
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
    for (const [name, cpu, request, limit, heap, mapPort, mapName] of [
      ["minecraft-shuxin", "500m", "8Gi", "8Gi", "7G", 8100, "bluemap"],
      ["minecraft-tsmc", "2", "6Gi", "8Gi", "6G", 8100, "bluemap"],
      ["minecraft-sjerred", "2", "6Gi", "8Gi", "5G", 8123, "dynmap"],
    ] as const) {
      const values = applications.find((app) => app.metadata.name === name)
        ?.spec.source.helm.valuesObject;
      expect(values, name).toBeDefined();
      expect(values?.["extraPodSpec"], name).toEqual({
        priorityClassName: BURST_SERVICE_PRIORITY,
      });
      expect(values?.["replicaCount"], name).toBe(0);
      expect(values?.["workloadAsStatefulSet"], name).toBe(true);
      expect(values?.["resources"], name).toEqual({
        requests: { cpu, memory: request },
        limits: { memory: limit },
      });
      expect(values?.["minecraftServer"], name).toMatchObject({
        memory: heap,
        extraPorts: expect.arrayContaining([
          {
            service: { enabled: true, port: mapPort },
            protocol: "TCP",
            containerPort: mapPort,
            name: mapName,
            ingress: { enabled: false },
          },
        ]),
      });
    }
    const sjerredApplication = applications.find(
      (app) => app.metadata.name === "minecraft-sjerred",
    );
    const sjerred = sjerredApplication?.spec.source.helm.valuesObject;
    expect(sjerred?.["startupProbe"]).toEqual({
      enabled: true,
      failureThreshold: 120,
      periodSeconds: 10,
    });
    expect(sjerred?.["minecraftServer"]).toMatchObject({
      type: "AUTO_CURSEFORGE",
      version: "1.12.2",
      autoCurseForge: {
        apiKey: {
          existingSecret: "minecraft-sjerred-curseforge",
          secretKey: "CF_API_KEY",
        },
        slug: "rlcraft",
        fileId: "4612979",
      },
      modUrls: [
        "https://github.com/webbukkit/dynmap/releases/download/v3.3-beta-2/Dynmap-3.3-beta-2-forge-1.12.2.jar",
        versions["mc2discord-forge-1.12.2"],
      ],
      gameMode: "survival",
      onlineMode: true,
      maxPlayers: 20,
      enableCommandBlock: true,
      announcePlayerAchievements: true,
      maxTickTime: -1,
      overrideServerProperties: true,
    });
    expect(sjerred?.["persistence"]).toEqual({
      dataDir: {
        enabled: true,
        existingClaim: "minecraft-sjerred-rlcraft-data",
      },
    });
    expectSjerredPostCutoverCleanup(sjerredApplication);
    expect(sjerred?.["extraEnv"]).toEqual({
      ALLOW_FLIGHT: "TRUE",
      ENABLE_WHITELIST: "TRUE",
    });
    expect(sjerred?.["extraDeploy"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: { name: "minecraft-sjerred-dynmap-config" },
          data: expect.objectContaining({
            "configuration.txt": expect.stringMatching(
              /defaultzoom: 3\ndefaultworld: world\ndefaultmap: flat/,
            ),
          }),
        }),
        expect.objectContaining({
          metadata: { name: "minecraft-sjerred-discord-integration-config" },
          data: {
            "mc2discord.toml": expect.stringMatching(
              /token = "\$\{CFG_DISCORD_BOT_TOKEN\}"[\s\S]*\[Messages\][\s\S]*start = ""[\s\S]*stop = ""[\s\S]*\[Status\.Channels\][\s\S]*Channel = \[\]/,
            ),
          },
        }),
      ]),
    );
    expect(sjerred?.["initContainers"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "configure-discord-integration",
          command: LEGACY_DISCORD_MOD_CLEANUP,
          env: [
            {
              name: "CFG_DISCORD_BOT_TOKEN",
              valueFrom: {
                secretKeyRef: {
                  name: "minecraft-sjerred-discord",
                  key: "DISCORD_BOT_TOKEN",
                },
              },
            },
            {
              name: "CFG_DISCORD_CHANNEL_ID",
              valueFrom: {
                secretKeyRef: {
                  name: "minecraft-sjerred-discord",
                  key: "DISCORD_CHANNEL_ID",
                },
              },
            },
          ],
        }),
      ]),
    );
    const tempo = applications.find((app) => app.metadata.name === "tempo");
    expect(tempo).toBeDefined();
    expect(tempo?.spec.source.helm.valuesObject["tempo"]).toMatchObject({
      resources: {
        requests: { cpu: "1", memory: "1Gi" },
        limits: { memory: "4Gi" },
      },
    });
  });
});
