import { describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { z } from "zod";
import {
  WorkerPoolSnapshotSchema,
  ArtifactVersionSchema,
  workerHostSpecification,
} from "@shepherdjerred/delivery/contract";
import {
  proveWorkerRetirement,
  requirePoolRoutingCoverage,
  workerOpenExecutionQuery,
  inactiveWorkerVersion,
  type WorkerRetirementEffects,
} from "#lib/delivery/workers/worker-retirement.ts";
import { verifyDeliveryWorkerImages } from "#lib/delivery/workers/worker-image-proof.ts";
import {
  requireLegacyWorkerCoverage,
  verifyWorkerPoolPods,
  verifyControlPlaneArtifactPods,
} from "#lib/delivery/workers/worker-hosts.ts";
import { controlPlanePod } from "./worker-fixtures.ts";
import { verifyCandidateImageBuildId } from "#lib/worker-deployment-proofs.ts";

const OLD = "a".repeat(40);
const CURRENT = "b".repeat(40);
const NOW = new Date("2026-10-17T20:00:00.000Z");
function imageConfiguration(buildId: string, architecture = "amd64") {
  return {
    os: "linux",
    architecture,
    config: { Env: [`GIT_SHA=${buildId}`] },
  };
}
it("visibility retirement covers current/deprecated deployment versions and pinned overrides", () => {
  const route = workerHostSpecification("central").routes[0];
  if (route === undefined) throw new Error("Missing central route");
  const query = workerOpenExecutionQuery(route, OLD);
  expect(query).toContain(`monorepo-central-workflows:${OLD}`);
  expect(query).toContain(`monorepo-central-workflows.${OLD}`);
  expect(query).toContain(`'versioned:${OLD}'`);
  expect(query).toContain(`'pinned:monorepo-central-workflows:${OLD}'`);
  expect(query).toContain("TemporalUsedWorkerDeploymentVersions IN");
});
it("excludes only canonical AutoUpgrade while retaining pinned, unknown and legacy references", () => {
  const route = workerHostSpecification("central").routes[0];
  if (route === undefined) throw new Error("Missing central route");
  const version = `${route.deploymentName}:${OLD}`;
  const legacyVersion = `${route.deploymentName}.${OLD}`;
  const references = [
    ["TemporalWorkerDeploymentVersion", version],
    ["TemporalWorkerDeploymentVersion", legacyVersion],
    ["TemporalUsedWorkerDeploymentVersions", version],
    ["TemporalUsedWorkerDeploymentVersions", legacyVersion],
    ["BuildIds", `versioned:${OLD}`],
    ["BuildIds", `pinned:${version}`],
    ["BuildIds", `pinned:${legacyVersion}`],
  ] as const;
  const database = new Database(":memory:");
  try {
    database.run(`CREATE TABLE visibility (
      ExecutionStatus TEXT, TemporalWorkerDeploymentVersion TEXT,
      TemporalUsedWorkerDeploymentVersions TEXT, BuildIds TEXT,
      TemporalWorkflowVersioningBehavior TEXT
    )`);
    const matches = database.query(
      `SELECT COUNT(*) AS matches FROM visibility WHERE ${workerOpenExecutionQuery(route, OLD)}`,
    );
    // A single matching reference exercises the unchanged IN predicates;
    // SQL evaluation also verifies that missing behavior is not lost to NULL logic.
    for (const [attribute, reference] of references) {
      for (const behavior of [
        "AutoUpgrade",
        "Pinned",
        null,
        "Unknown",
        "Auto-Upgrade",
      ]) {
        database.run("DELETE FROM visibility");
        database
          .query(
            `INSERT INTO visibility (ExecutionStatus, ${attribute}, TemporalWorkflowVersioningBehavior) VALUES ('Running', ?, ?)`,
          )
          .run(reference, behavior);
        expect(
          matches.get(),
          `${String(behavior)} ${attribute} ${reference}`,
        ).toEqual({
          matches: behavior === "AutoUpgrade" ? 0 : 1,
        });
      }
    }
    database.run("UPDATE visibility SET ExecutionStatus = 'Completed'");
    expect(matches.get()).toEqual({ matches: 0 });
  } finally {
    database.close();
  }
});
it("the complete central chart's unrelated multi-container hosts do not enter legacy worker validation", () => {
  const run = Bun.spawnSync(
    [
      "bun",
      "-e",
      'import {App, Chart} from "cdk8s"; import {createTemporalChart} from "./src/cdk8s-charts/platform/temporal.ts"; const app=new App(); createTemporalChart(app); const chart=app.node.findChild("temporal"); if (!(chart instanceof Chart)) throw new Error("Missing chart"); console.log(JSON.stringify(chart.toJson().filter((item)=>item.kind==="Deployment")));',
    ],
    {
      cwd: new URL("../../../../../homelab/src/cdk8s/", import.meta.url)
        .pathname,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(run.exitCode, run.stderr.toString()).toBe(0);
  const deployments = z
    .array(
      z
        .object({
          spec: z.object({
            template: z.object({
              metadata: z.object({ labels: z.record(z.string(), z.string()) }),
              spec: z.object({ containers: z.array(z.unknown()) }),
            }),
          }),
        })
        .loose(),
    )
    .parse(JSON.parse(run.stdout.toString()));
  const unrelated = deployments.filter(
    (host) =>
      host.spec.template.metadata.labels["worker-family"] !==
      "central-workflows",
  );
  expect(
    unrelated.some((host) => host.spec.template.spec.containers.length > 1),
  ).toBe(true);
  expect(requireLegacyWorkerCoverage(unrelated, snapshot())).toBe(false);
});
function snapshot() {
  return WorkerPoolSnapshotSchema.parse({
    schema: "delivery-worker-pool/v1",
    environmentId: "temporal/prod",
    environmentGeneration: 3,
    target: "central",
    candidateBuildId: CURRENT,
    versions: [OLD, CURRENT].map((buildId, index) => ({
      id: `worker/${String(index)}`,
      environmentId: "temporal/prod",
      buildId,
      artifactId: `artifact/${String(index)}`,
      artifactBuildId: `build/${String(index)}`,
      sourceRevision: buildId,
      image: `docker.io/shepherdjerred/temporal-worker@sha256:${buildId.slice(0, 1).repeat(64)}`,
      digest: `sha256:${buildId.slice(0, 1).repeat(64)}`,
      runtimeDigests: [`sha256:${"c".repeat(64)}`],
      introducedByDeploymentId: `deployment/${String(index)}`,
      host: workerHostSpecification("central"),
      replicas: 1,
      generation: 0,
      retiredAt: null,
    })),
  });
}
function effects(
  overrides: Partial<WorkerRetirementEffects> = {},
): WorkerRetirementEffects {
  return {
    async routing() {
      return {
        currentBuildId: CURRENT,
        rampingBuildId: null,
        token: "routing-1",
      };
    },
    async version(_route, buildId) {
      return {
        buildId,
        status: "DRAINED",
        lastDeactivationTime: "2026-10-17T19:00:00.000Z",
        checkedAt: "2026-10-17T19:59:59.000Z",
      };
    },
    async openExecutions() {
      return 0;
    },
    ...overrides,
  };
}
function legacy(image: string) {
  return {
    metadata: { name: "temporal-temporal-workflows-stable" },
    spec: {
      replicas: 1,
      template: {
        metadata: { labels: { "worker-family": "central-workflows" } },
        spec: { containers: [{ image }] },
      },
    },
  };
}
function pod(buildId: string) {
  return {
    metadata: {
      labels: {
        "worker-family": "central-workflows",
        component: `central-workflows-retained-${buildId.slice(0, 12)}`,
        "delivery.shepherdjerred.com/worker-build": buildId,
      },
    },
    spec: {
      containers: [
        {
          name: "host",
          image: `docker.io/shepherdjerred/temporal-worker@sha256:${buildId.slice(0, 1).repeat(64)}`,
        },
      ],
    },
    status: {
      phase: "Running",
      containerStatuses: [
        {
          name: "host",
          ready: true,
          imageID: `containerd://sha256:${"c".repeat(64)}`,
          state: { running: {} },
        },
      ],
    },
  };
}

describe("Retained worker retirement and cutover safety", () => {
  it("checks every original image's baked Git SHA, including reused bytes with forged build provenance", async () => {
    const selected = snapshot();
    const images: string[] = [];
    const run = async (command: readonly string[]) => {
      const image = command[4];
      if (image === undefined)
        throw new Error("Missing image inspection argument");
      images.push(image);
      const worker = selected.versions.find((entry) => entry.image === image);
      if (worker === undefined) throw new Error("Unknown immutable image");
      return {
        stdout: JSON.stringify(imageConfiguration(worker.buildId)),
        stderr: "",
      };
    };
    await verifyDeliveryWorkerImages(
      { deployment: { id: "proof/1", workerSnapshot: selected } },
      run,
    );
    expect(images).toEqual(selected.versions.map((worker) => worker.image));
    await expect(
      verifyDeliveryWorkerImages(
        { deployment: { id: "proof/2", workerSnapshot: selected } },
        async () => ({
          stdout: JSON.stringify(imageConfiguration(CURRENT)),
          stderr: "",
        }),
      ),
    ).rejects.toThrow("was not built from");
  });
  it("checks sibling-platform source metadata and refuses images without production amd64", async () => {
    const image = `docker.io/shepherdjerred/temporal-worker@sha256:${"a".repeat(64)}`;
    let configurations = {
      "linux/amd64": imageConfiguration(OLD),
      "linux/arm64": imageConfiguration(OLD, "arm64"),
    };
    const run = async (command: readonly string[]) => {
      expect(command).toEqual([
        "docker",
        "buildx",
        "imagetools",
        "inspect",
        image,
        "--format",
        "{{json .Image}}",
      ]);
      return { stdout: JSON.stringify(configurations), stderr: "" };
    };
    await verifyCandidateImageBuildId(image, OLD, run);
    configurations = {
      ...configurations,
      "linux/arm64": imageConfiguration(CURRENT, "arm64"),
    };
    await expect(verifyCandidateImageBuildId(image, OLD, run)).rejects.toThrow(
      "was not built from",
    );
    await expect(
      verifyCandidateImageBuildId(image, OLD, async () => ({
        stdout: JSON.stringify(imageConfiguration(OLD, "arm64")),
        stderr: "",
      })),
    ).rejects.toThrow("production linux/amd64");
  });
});

describe("Independent control-plane artifact runtime", () => {
  it("proves the independent control-plane original image without following the candidate", () => {
    const selected = snapshot();
    const artifact = ArtifactVersionSchema.parse({
      id: "artifact/0",
      component: "image:temporal-worker",
      kind: "image",
      uri: "docker.io/shepherdjerred/temporal-worker",
      digest: `sha256:${"a".repeat(64)}`,
      runtimeDigests: [`sha256:${"c".repeat(64)}`],
      version: "2.0.0-1",
      serviceId: "temporal",
      buildId: "build/0",
      sourceRevision: OLD,
      createdAt: NOW.toISOString(),
    });
    const executor = controlPlanePod(artifact);
    expect(() =>
      verifyControlPlaneArtifactPods([executor], artifact),
    ).not.toThrow();
    executor.spec.containers[0]!.image = selected.versions[1]!.image;
    expect(() => verifyControlPlaneArtifactPods([executor], artifact)).toThrow(
      "independently selected",
    );
    expect(() => verifyControlPlaneArtifactPods([], artifact)).toThrow(
      "native Pod",
    );
  });
});
describe("Inactive worker incarnation retirement", () => {
  it("recognizes the actual INACTIVE server shape without fabricating drainage timestamps", () => {
    const expected = {
      deploymentName: "monorepo-central-workflows",
      buildId: OLD,
    };
    const native = {
      deploymentVersion: expected,
      status: 1,
      createTime: { seconds: 1_790_000_000 },
    };
    expect(inactiveWorkerVersion(native, expected)).toMatchObject({
      status: "INACTIVE",
      buildId: OLD,
      lastDeactivationTime: null,
    });
    for (const status of [0, 2, 3, 4, 5, 6, 99])
      expect(() =>
        inactiveWorkerVersion({ ...native, status }, expected),
      ).toThrow("exact INACTIVE");
    for (const field of [
      "firstActivationTime",
      "lastCurrentTime",
      "lastDeactivationTime",
      "currentSinceTime",
      "rampingSinceTime",
      "routingChangedTime",
      "drainageInfo",
    ])
      expect(() =>
        inactiveWorkerVersion({ ...native, [field]: { seconds: 1 } }, expected),
      ).toThrow("history");
    expect(() =>
      inactiveWorkerVersion(native, { ...expected, buildId: CURRENT }),
    ).toThrow("exact INACTIVE");
    expect(() =>
      inactiveWorkerVersion({ ...native, createTime: null }, expected),
    ).toThrow("timestamp");
  });
  it("repeats exact INACTIVE version and open-execution reads on every namespace", async () => {
    const route = snapshot().versions[0]?.host.routes[0];
    if (!route) throw new Error("Missing fixture route");
    const inactive = inactiveWorkerVersion(
      {
        status: 1,
        createTime: { seconds: 1_790_000_000 },
        deploymentVersion: {
          deploymentName: route.deploymentName,
          buildId: OLD,
        },
      },
      { deploymentName: route.deploymentName, buildId: OLD },
    );
    let versions = 0;
    let counts = 0;
    const observed = effects({
      version: async () => {
        versions++;
        return inactive;
      },
      openExecutions: async () => {
        counts++;
        return 0;
      },
    });
    const result = await proveWorkerRetirement(
      snapshot(),
      "worker/0",
      observed,
      NOW,
    );
    expect({ versions, counts }).toEqual({ versions: 4, counts: 4 });
    expect(
      result.proofs.every(
        (proof) =>
          "proofKind" in proof && proof.proofKind === "inactive-unreferenced",
      ),
    ).toBe(true);
    expect(result.proofs.every((proof) => !("drainageStatus" in proof))).toBe(
      true,
    );
    for (const changed of ["version", "executions"] as const) {
      let reads = 0;
      await expect(
        proveWorkerRetirement(
          snapshot(),
          "worker/0",
          effects({
            version: async () =>
              changed === "version" && ++reads === 2
                ? { ...inactive, versionCreatedAt: NOW.toISOString() }
                : inactive,
            openExecutions: async () =>
              changed === "executions" && ++reads === 2 ? 1 : 0,
          }),
          NOW,
        ),
      ).rejects.toThrow("changed or gained pinned");
    }
    await expect(
      proveWorkerRetirement(
        snapshot(),
        "worker/0",
        effects({
          version: async () => inactive,
          openExecutions: async () => 1,
        }),
        NOW,
      ),
    ).rejects.toThrow("open pinned");
  });
});
describe("Retained worker routing, coverage and runtime", () => {
  it("blocks source selection when beta routes to a host absent from the frozen pool", async () => {
    await expect(
      requirePoolRoutingCoverage(snapshot(), async (route) => ({
        currentBuildId: route.namespace === "beta" ? "d".repeat(40) : CURRENT,
        rampingBuildId: null,
        token: "1",
      })),
    ).rejects.toThrow("live frozen retained host");
  });
  it("proves both prod and beta independently before central host retirement", async () => {
    const namespaces: string[] = [];
    const result = await proveWorkerRetirement(
      snapshot(),
      "worker/0",
      effects({
        async openExecutions(route) {
          namespaces.push(route.namespace);
          return 0;
        },
      }),
      NOW,
    );
    expect(namespaces).toEqual(["prod", "beta"]);
    expect(result.proofs).toHaveLength(2);
    expect(result.proofs.map((proof) => proof.routingConflictToken)).toEqual([
      "routing-1",
      "routing-1",
    ]);
  });
  it("retains a host with even one open execution in beta despite prod being drained", async () => {
    await expect(
      proveWorkerRetirement(
        snapshot(),
        "worker/0",
        effects({
          async openExecutions(route) {
            return route.namespace === "beta" ? 1 : 0;
          },
        }),
        NOW,
      ),
    ).rejects.toThrow("open pinned");
  });
  it("does not trust drainage from before the most recent deactivation", async () => {
    await expect(
      proveWorkerRetirement(
        snapshot(),
        "worker/0",
        effects({
          async version(_route, buildId) {
            return {
              buildId,
              status: "DRAINED",
              lastDeactivationTime: NOW.toISOString(),
              checkedAt: "2026-10-17T19:59:59.000Z",
            };
          },
        }),
        NOW,
      ),
    ).rejects.toThrow("deactivation");
  });
  it.each(["current", "ramping"])(
    "retains a %s host even when visibility says zero",
    async (kind) => {
      await expect(
        proveWorkerRetirement(
          snapshot(),
          "worker/0",
          effects({
            async routing() {
              return {
                currentBuildId: kind === "current" ? OLD : CURRENT,
                rampingBuildId: kind === "ramping" ? OLD : null,
                token: "1",
              };
            },
          }),
          NOW,
        ),
      ).rejects.toThrow("routing");
    },
  );
  it("rechecks the routing conflict token after visibility inspection", async () => {
    let reads = 0;
    await expect(
      proveWorkerRetirement(
        snapshot(),
        "worker/0",
        effects({
          async routing() {
            return {
              currentBuildId: CURRENT,
              rampingBuildId: null,
              token: String(++reads),
            };
          },
        }),
        NOW,
      ),
    ).rejects.toThrow("changed");
  });
  it("blocks cutover before any effect when an old host lacks qualified original-image coverage", () => {
    const image = `docker.io/shepherdjerred/temporal-worker:2.0.0-1@sha256:${"d".repeat(64)}`;
    expect(() =>
      requireLegacyWorkerCoverage([legacy(image)], snapshot()),
    ).toThrow("qualified retained-pool coverage");
    expect(
      requireLegacyWorkerCoverage(
        [
          legacy(
            `docker.io/shepherdjerred/temporal-worker:2.0.0-1@sha256:${"a".repeat(64)}`,
          ),
        ],
        snapshot(),
      ),
    ).toBe(true);
    const retired = snapshot();
    const worker = retired.versions[0];
    if (worker === undefined) throw new Error("Missing fixture host");
    worker.replicas = 0;
    expect(() =>
      requireLegacyWorkerCoverage([legacy(worker.image)], retired),
    ).toThrow("coverage");
  });
  it("ignores unrelated multi-container Deployments before applying the worker-only schema", () => {
    const app = legacy("docker.io/other/app@sha256:" + "d".repeat(64));
    app.spec.template.metadata.labels["worker-family"] = "agent-worker";
    app.spec.template.spec.containers.push({ image: "caddy:2" });
    expect(requireLegacyWorkerCoverage([app], snapshot())).toBe(false);
  });
  it("rejects a legacy host whose explicit Build ID conflicts with original image provenance", () => {
    const selected = snapshot();
    const image = selected.versions[0]!.image;
    const host = {
      ...legacy(image),
      spec: {
        ...legacy(image).spec,
        template: {
          ...legacy(image).spec.template,
          spec: {
            containers: [
              {
                image,
                env: [{ name: "TEMPORAL_WORKER_BUILD_ID", value: CURRENT }],
              },
            ],
          },
        },
      },
    };
    expect(() => requireLegacyWorkerCoverage([host], selected)).toThrow(
      "build environment",
    );
  });
  it("proves every active original digest, including multiarch child digests", () => {
    expect(() =>
      verifyWorkerPoolPods([pod(OLD), pod(CURRENT)], snapshot()),
    ).not.toThrow();
    expect(() => verifyWorkerPoolPods([pod(CURRENT)], snapshot())).toThrow(
      "ready Pod",
    );
    const stale = pod(OLD);
    stale.spec.containers[0]!.image = `docker.io/shepherdjerred/temporal-worker@sha256:${"d".repeat(64)}`;
    expect(() =>
      verifyWorkerPoolPods([stale, pod(CURRENT)], snapshot()),
    ).toThrow("outside the frozen original image pool");
  });
  it("requires retired Pods to disappear after scale-zero, including terminating Pods", () => {
    const selected = snapshot();
    selected.versions[0]!.replicas = 0;
    expect(() => verifyWorkerPoolPods([pod(CURRENT)], selected)).not.toThrow();
    expect(() =>
      verifyWorkerPoolPods([pod(OLD), pod(CURRENT)], selected),
    ).toThrow("still has Pods");
  });
});
