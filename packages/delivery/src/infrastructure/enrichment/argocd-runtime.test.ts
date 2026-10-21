import { describe, expect, it } from "vitest";
import { VersionSetRevisionSchema } from "#shared/contract.ts";
import { compareLiveImages } from "./argocd-runtime.ts";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const selected = VersionSetRevisionSchema.parse({
  id: "set",
  serviceId: "arcade",
  revision: 1,
  baseRevisionId: null,
  lineage: "0".repeat(64),
  orderKey: "0000000001.0000000000",
  createdAt: "2026-10-18T00:00:00.000Z",
  components: {
    "image:arcade": {
      id: "image",
      component: "image:arcade",
      kind: "image",
      uri: "docker.io/shepherdjerred/arcade",
      digest: digest("a"),
      runtimeDigests: [digest("b")],
      version: "1",
      serviceId: "arcade",
      buildId: "build",
      sourceRevision: "a".repeat(40),
      createdAt: "2026-10-18T00:00:00.000Z",
    },
  },
});

describe("compareLiveImages", () => {
  it("accepts the index or a platform runtime digest", () => {
    expect(
      compareLiveImages(selected, [
        `docker.io/shepherdjerred/arcade@${digest("b")}`,
      ])[0]?.matches,
    ).toBe(true);
  });

  it("flags a different running digest", () => {
    expect(
      compareLiveImages(selected, [
        `docker.io/shepherdjerred/arcade@${digest("c")}`,
      ])[0]?.matches,
    ).toBe(false);
  });

  it("skips components ArgoCD reports no image for", () => {
    expect(compareLiveImages(selected, [])).toEqual([]);
    expect(compareLiveImages(null, ["anything"])).toEqual([]);
  });
});
