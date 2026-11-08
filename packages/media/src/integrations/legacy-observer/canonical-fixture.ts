import {
  ResourceSchema,
  RESOURCE_PATHS,
  type ObserverRequest,
} from "./wire.ts";

export function canonicalFixture() {
  const metadata = { namespace: "media", generation: 1, resourceVersion: "1" };
  const template = {
    spec: {
      containers: [
        {
          name: "media-files",
          volumeMounts: ["movies", "tv"].map((name) => ({
            name,
            mountPath: `/data/${name}`,
            subPath: "library",
          })),
        },
      ],
      volumes: ["movies", "tv"].map((name) => ({
        name,
        persistentVolumeClaim: { claimName: name },
      })),
    },
  };
  const deployment = ResourceSchema.parse({
    kind: "Deployment",
    metadata: {
      ...metadata,
      name: "media-media-files",
      uid: "files-deployment",
    },
    spec: { replicas: 1, template },
    status: {
      observedGeneration: 1,
      replicas: 1,
      readyReplicas: 1,
      updatedReplicas: 1,
    },
  });
  const replicaSet = ResourceSchema.parse({
    kind: "ReplicaSet",
    metadata: {
      ...metadata,
      name: "media-media-files-rs",
      uid: "files-rs",
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
      ...metadata,
      name: "media-media-files-pod",
      uid: "files-pod",
      ownerReferences: [
        {
          kind: "ReplicaSet",
          name: replicaSet.metadata.name,
          uid: replicaSet.metadata.uid,
        },
      ],
    },
    spec: template.spec,
    status: {
      phase: "Running",
      conditions: [{ type: "Ready", status: "True" }],
    },
  });
  const claims = ["movies", "tv"].map((name) =>
    ResourceSchema.parse({
      kind: "PersistentVolumeClaim",
      metadata: { ...metadata, name, uid: `${name}-pvc` },
      spec: { volumeName: `${name}-pv` },
      status: { phase: "Bound" },
    }),
  );
  const resources = [deployment, replicaSet, pod];
  const requested: string[] = [];
  const request: ObserverRequest = (path) => {
    requested.push(path);
    const pathname = path.split("?")[0];
    const kind = RESOURCE_PATHS.find((item) => item[1] === pathname)?.[0];
    if (kind !== undefined)
      return Promise.resolve({
        kind: `${kind}List`,
        metadata: { resourceVersion: "1" },
        items: resources.filter((item) => item.kind === kind),
      });
    const result = [...resources, ...claims].find(
      (item) => pathname?.endsWith(`/${item.metadata.name}`) === true,
    );
    if (result === undefined) throw new Error("Unexpected fixture GET");
    return Promise.resolve(result);
  };
  return { deployment, replicaSet, pod, claims, resources, requested, request };
}
