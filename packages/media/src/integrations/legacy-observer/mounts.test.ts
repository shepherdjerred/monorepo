import { expect, test } from "vitest";
import { legacyObserver } from "./runtime.ts";
import {
  RESOURCE_PATHS,
  ResourceSchema,
  type ObserverRequest,
} from "./wire.ts";

const binding = {
  sourceDeployment: "media-radarr",
  sourceContainer: "container-0",
  sourceRoot: "/movies",
  canonicalDeployment: "media-media-files",
  canonicalContainer: "media-files",
  canonicalRoot: "/data/movies",
};
function response(path: string) {
  const name = path.split("/").at(-1);
  if (name === undefined) throw new Error("Fixture path missing");
  if (path.includes("persistentvolumeclaims"))
    return {
      kind: "PersistentVolumeClaim",
      metadata: {
        name,
        namespace: "media",
        uid: "shared-claim-uid",
        resourceVersion: "1",
      },
      spec: { volumeName: "pv-movies" },
      status: { phase: "Bound" },
    };
  const source = name === "media-radarr";
  return {
    kind: "Deployment",
    metadata: {
      name,
      namespace: "media",
      uid: `${name}-uid`,
      generation: 1,
      resourceVersion: "1",
    },
    spec: {
      replicas: source ? 0 : 1,
      template: {
        spec: {
          containers: [
            {
              name: source ? "container-0" : "media-files",
              volumeMounts: [
                {
                  name: "library",
                  mountPath: source ? "/movies" : "/data/movies",
                },
              ],
            },
          ],
          volumes: [
            { name: "library", persistentVolumeClaim: { claimName: "movies" } },
          ],
        },
      },
    },
    status: {
      observedGeneration: 1,
      replicas: 1,
      readyReplicas: 1,
      updatedReplicas: 1,
    },
  };
}
function listResponse(path: string) {
  const kind = RESOURCE_PATHS.find(
    (pair) => pair[1] === path.split("?")[0],
  )?.[0];
  if (kind === undefined) throw new Error("Fixture list missing");
  const deployment = ResourceSchema.parse(
    response("/deployments/media-media-files"),
  );
  const template = deployment.spec["template"];
  if (
    typeof template !== "object" ||
    template === null ||
    !("spec" in template)
  )
    throw new Error("Fixture template missing");
  const set = ResourceSchema.parse({
    kind: "ReplicaSet",
    metadata: {
      ...deployment.metadata,
      name: "media-media-files-rs",
      uid: "files-rs-uid",
      ownerReferences: [
        {
          kind: "Deployment",
          name: deployment.metadata.name,
          uid: deployment.metadata.uid,
        },
      ],
    },
    spec: { template },
    status: {},
  });
  const pod = ResourceSchema.parse({
    kind: "Pod",
    metadata: {
      ...deployment.metadata,
      name: "media-media-files-pod",
      uid: "files-pod-uid",
      ownerReferences: [
        { kind: "ReplicaSet", name: set.metadata.name, uid: set.metadata.uid },
      ],
    },
    spec: template.spec,
    status: {
      phase: "Running",
      conditions: [{ type: "Ready", status: "True" }],
    },
  });
  return {
    kind: `${kind}List`,
    metadata: { resourceVersion: "1" },
    items: [deployment, set, pod].filter((item) => item.kind === kind),
  };
}
const read: ObserverRequest = (path) =>
  Promise.resolve(
    path.includes("?limit=") ? listResponse(path) : response(path),
  );
test("proves aliases only through equal PVC UID, PV identity and volume-relative path", async () => {
  const result = await legacyObserver(read).observeMountBindings([binding]);
  expect(result.bindings[0]?.source).toMatchObject({
    pvcUid: "shared-claim-uid",
    volumeName: "pv-movies",
    root: "/movies",
    volumePath: ".",
  });
  expect(result.bindings[0]?.canonical.root).toBe("/data/movies");
  expect(result.bindings[0]?.canonical.podUid).toBe("files-pod-uid");
});
test("PVC replacement between observations invalidates an otherwise identical mapping", async () => {
  let calls = 0;
  await expect(
    legacyObserver((path) => {
      if (path.includes("?limit=")) return Promise.resolve(listResponse(path));
      const item = response(path);
      if (path.includes("persistentvolumeclaims") && ++calls > 2)
        item.metadata.uid = "replacement-uid";
      return Promise.resolve(item);
    }).observeMountBindings([binding]),
  ).rejects.toThrow("mount_inventory_changed");
});
test.each(["subPathExpr", "ambiguous", "changedSubPath"])(
  "protects %s mounts",
  async (mode) => {
    await expect(
      legacyObserver((path) => {
        if (path.includes("?limit="))
          return Promise.resolve(listResponse(path));
        const item = response(path);
        if (path.endsWith("media-radarr") && "template" in item.spec) {
          const mount = item.spec.template?.spec.containers[0]?.volumeMounts[0];
          if (!mount) throw new Error("Fixture missing");
          if (mode === "subPathExpr")
            Object.assign(mount, { subPathExpr: "$(POD_NAME)" });
          if (mode === "changedSubPath")
            Object.assign(mount, { subPath: "other" });
          if (mode === "ambiguous")
            item.spec.template?.spec.containers[0]?.volumeMounts.push({
              ...mount,
            });
        }
        return Promise.resolve(item);
      }).observeMountBindings([binding]),
    ).rejects.toThrow(
      mode === "changedSubPath" ? "mount_storage_identity_mismatch" : "mount_",
    );
  },
);
test.each(["old-template", "competing-poller", "terminating"])(
  "blocks canonical worker %s",
  async (mode) => {
    await expect(
      legacyObserver((path) => {
        if (!path.includes("?limit=")) return Promise.resolve(response(path));
        const list = listResponse(path);
        const item = list.items[0];
        if (mode === "old-template" && item?.kind === "ReplicaSet")
          item.spec["template"] = { spec: { containers: [], volumes: [] } };
        if (item?.kind === "Pod") {
          if (mode === "competing-poller")
            list.items.push({
              ...item,
              metadata: {
                ...item.metadata,
                name: "media-media-files-old",
                uid: "old-poller",
              },
            });
          if (mode === "terminating")
            item.metadata.deletionTimestamp = new Date().toISOString();
        }
        return Promise.resolve(list);
      }).observeMountBindings([binding]),
    ).rejects.toThrow("canonical_worker_");
  },
);
