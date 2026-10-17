import { expect, test } from "vitest";
import { legacyObserver } from "./runtime.ts";
import { canonicalFixture } from "./canonical-fixture.ts";

test("canonical-only observation binds both real Pod mounts without requesting a fictitious legacy mount", async () => {
  const f = canonicalFixture();
  const evidence = await legacyObserver(f.request).observeCanonicalMounts();
  expect(
    evidence.mounts.map((mount) => ({
      root: mount.root,
      pod: mount.podUid,
      pvc: mount.pvcUid,
      pv: mount.volumeName,
      volumePath: mount.volumePath,
    })),
  ).toEqual([
    {
      root: "/data/movies",
      pod: "files-pod",
      pvc: "movies-pvc",
      pv: "movies-pv",
      volumePath: "library",
    },
    {
      root: "/data/tv",
      pod: "files-pod",
      pvc: "tv-pvc",
      pv: "tv-pv",
      volumePath: "library",
    },
  ]);
  expect(f.requested.filter((item) => item.includes("/deployments/"))).toEqual(
    Array.from(
      { length: 4 },
      () => "/apis/apps/v1/namespaces/media/deployments/media-media-files",
    ),
  );
});
test.each(["terminating", "old-template", "competing-poller", "not-ready"])(
  "canonical-only proof protects %s",
  async (mode) => {
    const f = canonicalFixture();
    if (mode === "terminating")
      f.pod.metadata.deletionTimestamp = new Date().toISOString();
    if (mode === "old-template")
      f.replicaSet.spec["template"] = { spec: { containers: [], volumes: [] } };
    if (mode === "competing-poller")
      f.resources.push({
        ...f.pod,
        metadata: {
          ...f.pod.metadata,
          name: "media-media-files-old",
          uid: "old-poller",
        },
      });
    if (mode === "not-ready")
      f.pod.status["conditions"] = [{ type: "Ready", status: "False" }];
    await expect(
      legacyObserver(f.request).observeCanonicalMounts(),
    ).rejects.toThrow("canonical_worker_");
  },
);
test("PVC replacement between passes protects even when desired Deployment is unchanged", async () => {
  const f = canonicalFixture();
  let claimReads = 0;
  await expect(
    legacyObserver(async (path, signal) => {
      if (path.includes("persistentvolumeclaims/") && ++claimReads > 2) {
        const claim = f.claims.find((item) =>
          path.endsWith(`/${item.metadata.name}`),
        );
        if (claim !== undefined)
          claim.metadata.uid = `replacement-${claim.metadata.name}`;
      }
      return f.request(path, signal);
    }).observeCanonicalMounts(),
  ).rejects.toThrow("canonical_mount_inventory_changed");
});
test("actual Pod subPathExpr is rejected even when the controller template is safe", async () => {
  const f = canonicalFixture();
  f.pod.spec = {
    ...f.pod.spec,
    containers: [
      {
        name: "media-files",
        volumeMounts: [
          {
            name: "movies",
            mountPath: "/data/movies",
            subPathExpr: "$(POD_NAME)",
          },
        ],
      },
    ],
  };
  await expect(
    legacyObserver(f.request).observeCanonicalMounts(),
  ).rejects.toThrow("mount_subpath_expression");
});
