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

const image = (char: string) =>
  `docker.io/shepherdjerred/arcade@${digest(char)}`;
const worker = (char: string, runtimeDigests: string[] = []) => ({
  uri: "docker.io/shepherdjerred/arcade",
  digest: digest(char),
  runtimeDigests,
});

describe("compareLiveImages", () => {
  it("accepts the index or a platform runtime digest", () => {
    expect(compareLiveImages(selected, [image("b")], [])[0]?.matches).toBe(
      true,
    );
  });

  it("flags a different running digest", () => {
    expect(compareLiveImages(selected, [image("c")], [])[0]?.matches).toBe(
      false,
    );
  });

  it("skips components ArgoCD reports no image for", () => {
    expect(compareLiveImages(selected, [], [])).toEqual([]);
    expect(compareLiveImages(null, ["anything"], [])).toEqual([]);
  });

  it("without a worker pool, every live image must be the accepted artifact", () => {
    expect(compareLiveImages(selected, [image("a"), image("b")], [])).toEqual([
      {
        component: "image:arcade",
        expected: digest("a"),
        live: [image("a"), image("b")],
        retained: 0,
        unexpected: [],
        matches: true,
      },
    ]);
    expect(compareLiveImages(selected, [image("a"), image("c")], [])).toEqual([
      {
        component: "image:arcade",
        expected: digest("a"),
        live: [image("a"), image("c")],
        retained: 0,
        unexpected: [image("c")],
        matches: false,
      },
    ]);
  });

  it("matches when retained worker builds explain every other live image", () => {
    const live = [image("a"), image("c"), image("d"), image("f")];
    expect(
      compareLiveImages(selected, live, [
        worker("c"),
        worker("d"),
        // A retained build is also running under its platform digest.
        worker("e", [digest("f")]),
      ]),
    ).toEqual([
      {
        component: "image:arcade",
        expected: digest("a"),
        live,
        retained: 3,
        unexpected: [],
        matches: true,
      },
    ]);
  });

  it("does not count the accepted artifact's own worker row as retained", () => {
    const [check] = compareLiveImages(
      selected,
      [image("a"), image("c")],
      [worker("a", [digest("b")]), worker("c")],
    );
    expect(check).toMatchObject({ retained: 1, unexpected: [], matches: true });
  });

  it("does not match while only retained builds run and the accepted digest is absent", () => {
    const [check] = compareLiveImages(
      selected,
      [image("c"), image("d")],
      [worker("c"), worker("d")],
    );
    expect(check).toMatchObject({
      retained: 2,
      unexpected: [],
      matches: false,
    });
  });

  it("lists a live image that nothing explains", () => {
    const [check] = compareLiveImages(
      selected,
      [image("a"), image("c"), image("d")],
      [worker("c")],
    );
    expect(check).toMatchObject({
      retained: 1,
      unexpected: [image("d")],
      matches: false,
    });
  });

  it("ignores a retained artifact of another image repository", () => {
    const [check] = compareLiveImages(
      selected,
      [image("a"), image("c")],
      [{ ...worker("c"), uri: "docker.io/shepherdjerred/other" }],
    );
    expect(check).toMatchObject({
      retained: 0,
      unexpected: [image("c")],
      matches: false,
    });
  });
});

/** A desired release Delivery has not accepted, whose arcade image is `char`. */
function desiredRelease(char: string, revision = 348) {
  const artifact = selected.components["image:arcade"];
  if (artifact === undefined) throw new Error("fixture has image:arcade");
  return {
    ...selected,
    id: "desired",
    revision,
    components: {
      "image:arcade": { ...artifact, digest: digest(char), runtimeDigests: [] },
    },
  };
}

describe("compareLiveImages against a desired release not yet accepted", () => {
  it("counts the desired release's digest apart, never as unexpected", () => {
    // Streambot prod: r345 accepted, r348 desired, and r348's image running.
    expect(
      compareLiveImages(selected, [image("d")], [], desiredRelease("d")),
    ).toEqual([
      {
        component: "image:arcade",
        expected: digest("a"),
        live: [image("d")],
        retained: 0,
        unexpected: [],
        matches: false,
        desiredRevision: 348,
        desired: 1,
      },
    ]);
  });

  it("still flags a digest that is neither accepted nor desired", () => {
    expect(
      compareLiveImages(selected, [image("c")], [], desiredRelease("d"))[0],
    ).toMatchObject({ unexpected: [image("c")], desired: 0, matches: false });
  });

  it("says nothing of a desired release that is the accepted one", () => {
    const [check] = compareLiveImages(selected, [image("a")], [], selected);
    expect(check?.matches).toBe(true);
    expect(check).not.toHaveProperty("desiredRevision");
  });
});
