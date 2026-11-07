import { expect, it } from "vitest";
import { captureResources } from "./capture-resources.ts";

const input = {
  id: "478c8f9f-df5c-4ec9-b24f-d064b39f9462",
  sourceClaim: "datadir-minecraft-tsmc-0",
  capacity: "128Gi",
  image: `docker.io/shepherdjerred/the-storm-server@sha256:${"a".repeat(64)}`,
};
it("mounts only the disposable clone read-only and never mounts the source claim", () => {
  const rendered = captureResources(input);
  const json = JSON.stringify(rendered);
  expect(json).toContain('"storageClassName":"mc-capture-fixture"');
  expect(json).toContain('"readOnly":true');
  expect(json).toContain('"automountServiceAccountToken":false');
  expect(json.match(/datadir-minecraft-tsmc-0/gu)).toHaveLength(1);
  expect(rendered.items.map((i) => i.kind)).toEqual([
    "VolumeSnapshot",
    "PersistentVolumeClaim",
    "Pod",
  ]);
});
it("requires an immutable image and the exact intended source claim", () => {
  expect(() =>
    captureResources({ ...input, image: "server:latest" }),
  ).toThrow();
  expect(() =>
    captureResources({ ...input, sourceClaim: "another-production-volume" }),
  ).toThrow();
});
