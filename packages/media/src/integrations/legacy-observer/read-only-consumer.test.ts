import { expect, test } from "vitest";
import { LEGACY_DEPLOYMENTS } from "./config.ts";
import { evaluateInventory } from "./evaluate.ts";
import { ResourceSchema } from "./wire.ts";

function create(kind: string, name: string, spec: unknown) {
  return ResourceSchema.parse({
    kind,
    metadata: {
      name,
      namespace: "media",
      uid: `${name}-uid`,
      generation: 1,
      resourceVersion: "1",
    },
    spec,
    status: { observedGeneration: 1 },
  });
}
function fixture() {
  const volume = {
    name: "movies",
    persistentVolumeClaim: { claimName: "legacy-movie-pvc" },
  };
  const readonly = {
    name: "main",
    volumeMounts: [{ name: "movies", readOnly: true }],
  };
  const podSpec = { containers: [readonly], volumes: [volume] };
  const targets = LEGACY_DEPLOYMENTS.map((name) =>
    create("Deployment", name, {
      replicas: 0,
      template: { spec: { volumes: [volume] } },
    }),
  );
  const deployment = create("Deployment", "media-streambot", {
    replicas: 1,
    template: { spec: podSpec },
  });
  const pod = create("Pod", "streambot-running", podSpec);
  pod.status["phase"] = "Running";
  pod.metadata.ownerReferences = [
    {
      name: deployment.metadata.name,
      uid: deployment.metadata.uid,
      kind: "Deployment",
    },
  ];
  return { targets, deployment, pod, readonly, podSpec };
}
test("Streambot stays permitted when actual Pod and desired template use library read-only", () => {
  const { targets, deployment, pod } = fixture();
  const result = evaluateInventory([...targets, deployment, pod]);
  expect(result.quiescent).toBe(true);
  expect(result.blockers).toEqual([]);
});
test.each(["containers", "initContainers", "ephemeralContainers", "template"])(
  "Streambot %s write mount protects and changes stability digest",
  (mode) => {
    const { targets, deployment, pod, readonly } = fixture();
    const before = evaluateInventory([...targets, deployment, pod]);
    const writer = {
      ...readonly,
      volumeMounts: [{ name: "movies", readOnly: false }],
    };
    if (mode === "template")
      deployment.spec["template"] = {
        spec: { ...pod.spec, containers: [writer] },
      };
    else pod.spec[mode] = [writer];
    const after = evaluateInventory([...targets, deployment, pod]);
    expect(after.quiescent).toBe(false);
    expect(after.inventoryDigest).not.toBe(before.inventoryDigest);
    expect(after.blockers).toContainEqual({
      code: "retained_consumer_library_writable",
      kind: mode === "template" ? "Deployment" : "Pod",
      name: mode === "template" ? "media-streambot" : "streambot-running",
    });
  },
);
