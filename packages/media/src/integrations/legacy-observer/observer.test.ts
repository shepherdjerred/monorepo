import { expect, test } from "vitest";
import { legacyObserver } from "./runtime.ts";
import { LEGACY_DEPLOYMENTS, LEGACY_OBSERVER_CONFIG } from "./config.ts";
import {
  ResourceSchema,
  RESOURCE_PATHS,
  type Resource,
  type ObserverRequest,
} from "./wire.ts";

function resource(
  kind: string,
  name: string,
  spec: Record<string, unknown> = {},
) {
  return ResourceSchema.parse({
    kind,
    metadata: {
      name,
      namespace: "media",
      uid: `${name}-uid`,
      generation: 1,
      resourceVersion: "10",
    },
    spec,
    status: { observedGeneration: 1 },
  });
}
function stopped() {
  return LEGACY_DEPLOYMENTS.map((name) =>
    resource("Deployment", name, { replicas: 0 }),
  );
}
function requestFor(objects: Resource[]): ObserverRequest {
  return (path) => {
    const kind = RESOURCE_PATHS.find(
      (pair) => path.split("?")[0] === pair[1],
    )?.[0];
    if (kind === undefined) throw new Error("Unexpected read");
    return Promise.resolve({
      kind: `${kind}List`,
      metadata: { resourceVersion: "10" },
      items: objects
        .filter((item) => item.kind === kind)
        .map(({ kind: _kind, ...item }) => item),
    });
  };
}
test("requires the entire fixed retirement set and emits only sanitized evidence", async () => {
  const objects = stopped();
  const first = objects[0];
  if (!first) throw new Error("Fixture missing");
  first.spec["privateSetting"] = "synthetic-do-not-persist";
  const result = await legacyObserver(
    requestFor(objects),
    () => 1000,
  ).observe();
  expect(result.quiescent).toBe(true);
  expect(result.controllers).toHaveLength(9);
  expect(result.controllers.map((item) => item.name)).toContain(
    "media-tautulli",
  );
  expect(JSON.stringify(result)).not.toContain("synthetic-do-not-persist");
  expect(Date.parse(result.expiresAt) - Date.parse(result.capturedAt)).toBe(
    LEGACY_OBSERVER_CONFIG.evidenceLifetimeMs,
  );
  const missing = await legacyObserver(requestFor(objects.slice(1))).observe();
  expect(missing.quiescent).toBe(false);
});
test("zero ready does not excuse a desired replica or unobserved generation", async () => {
  const objects = stopped();
  const target = objects[0];
  if (!target) throw new Error("Fixture missing");
  target.spec["replicas"] = 1;
  target.status["observedGeneration"] = 0;
  const result = await legacyObserver(requestFor(objects)).observe();
  expect(result.blockers.map((value) => value.code)).toEqual(
    expect.arrayContaining(["target_not_stopped", "controller_not_observed"]),
  );
});
test("terminating pods and unknown writer jobs block despite stopped deployment", async () => {
  const objects = stopped();
  const pod = resource("Pod", "media-radarr-draining");
  pod.metadata.deletionTimestamp = new Date().toISOString();
  pod.status["phase"] = "Succeeded";
  objects.push(
    pod,
    resource("Job", "old-maintenance", { command: ["radarr", "cleanup"] }),
  );
  const result = await legacyObserver(requestFor(objects)).observe();
  expect(result.quiescent).toBe(false);
  expect(result.blockers.map((value) => value.code)).toEqual(
    expect.arrayContaining([
      "controller_or_pod_terminating",
      "job_not_completed",
    ]),
  );
});
test("follows UID owner graph and detects replacement orphan children", async () => {
  const objects = stopped();
  const child = resource("ReplicaSet", "unexpected-controller", {
    replicas: 1,
  });
  child.metadata.ownerReferences = [
    { kind: "Deployment", name: "media-radarr", uid: "media-radarr-uid" },
  ];
  objects.push(child);
  const result = await legacyObserver(requestFor(objects)).observe();
  expect(result.blockers).toContainEqual({
    code: "replicaset_not_stopped",
    kind: "ReplicaSet",
    name: "unexpected-controller",
  });
});
test("does not require retained read-only Streambot or unrelated workloads stopped", async () => {
  const objects = stopped();
  const stream = resource("Deployment", "media-streambot", { replicas: 1 });
  const pod = resource("Pod", "streambot-pod");
  pod.metadata.ownerReferences = [
    {
      kind: "Deployment",
      name: stream.metadata.name,
      uid: stream.metadata.uid,
    },
  ];
  pod.status["phase"] = "Running";
  objects.push(
    stream,
    pod,
    resource("Deployment", "unrelated-health-exporter", { replicas: 1 }),
  );
  const result = await legacyObserver(requestFor(objects)).observe();
  expect(result.quiescent).toBe(true);
});
test("unknown jobs mounting legacy PVC writable are protected", async () => {
  const objects = stopped();
  const target = objects[0];
  if (!target) throw new Error("Fixture missing");
  const pod = {
    containers: [
      {
        name: "worker",
        volumeMounts: [{ name: "library", mountPath: "/data" }],
      },
    ],
    volumes: [
      {
        name: "library",
        persistentVolumeClaim: { claimName: "movie-library" },
      },
    ],
  };
  target.spec["template"] = { spec: pod };
  objects.push(resource("Job", "mystery-writer", { template: { spec: pod } }));
  const result = await legacyObserver(requestFor(objects)).observe();
  expect(result.blockers).toContainEqual({
    code: "job_not_completed",
    kind: "Job",
    name: "mystery-writer",
  });
});
test("changed snapshots, incomplete pagination and API failures never yield proof", async () => {
  let deploymentReads = 0;
  const request = requestFor(stopped());
  await expect(
    legacyObserver(async (path, signal) => {
      if (path.includes("/deployments?")) deploymentReads++;
      return deploymentReads === 2 && path.includes("/deployments?")
        ? {
            kind: "DeploymentList",
            metadata: { resourceVersion: "11" },
            items: [],
          }
        : request(path, signal);
    }).observe(),
  ).rejects.toThrow("inventory_changed");
  await expect(
    legacyObserver(() =>
      Promise.resolve({
        kind: "DeploymentList",
        metadata: { resourceVersion: "1", continue: "more" },
        items: [],
      }),
    ).observe(),
  ).rejects.toThrow("inventory_incomplete");
  await expect(
    legacyObserver(() =>
      Promise.reject(new Error("synthetic unavailable")),
    ).observe(),
  ).rejects.toThrow("synthetic unavailable");
});

test.each(["CronJob", "initContainers", "ephemeralContainers"])(
  "detects %s library writers without relying on a legacy name",
  async (mode) => {
    const objects = stopped();
    const target = objects[0];
    if (!target) throw new Error("Fixture missing");
    const volumes = [
      {
        name: "storage",
        persistentVolumeClaim: { claimName: "shared-library" },
      },
    ];
    target.spec["template"] = { spec: { volumes } };
    const writer = {
      name: "writer",
      volumeMounts: [{ name: "storage", readOnly: false }],
    };
    const readonly = {
      name: "reader",
      volumeMounts: [{ name: "storage", readOnly: true }],
    };
    const pod =
      mode === "CronJob"
        ? { volumes, containers: [writer] }
        : { volumes, containers: [readonly], [mode]: [writer] };
    const item =
      mode === "CronJob"
        ? resource("CronJob", "nightly-script", {
            jobTemplate: { spec: { template: { spec: pod } } },
          })
        : resource("Pod", "unrelated-name", pod);
    item.status["phase"] = "Running";
    objects.push(item);
    const result = await legacyObserver(requestFor(objects)).observe();
    expect(result.quiescent).toBe(false);
    expect(result.blockers).toContainEqual({
      code:
        mode === "CronJob" ? "schedule_not_suspended" : "live_or_unknown_pod",
      kind: item.kind,
      name: item.metadata.name,
    });
  },
);
