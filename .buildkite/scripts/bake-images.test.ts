import { expect, test } from "bun:test";
import {
  expandTargets,
  findPinnedDigest,
  knownImageTargets,
  parseBakeArguments,
  parseBuildkiteCommits,
  parseStringArray,
} from "./migration-core.ts";

test("expands the infra group into invokable targets", () => {
  expect(expandTargets(["infra"])).toContain("caddy-s3proxy");
  expect(expandTargets(["infra"])).not.toContain("infra");
});

test("reads production and beta image pins", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  expect(
    findPinnedDigest(
      `  "shepherdjerred/example/beta": {\n    digest: "${digest}",\n`,
      "example",
    ),
  ).toBe(digest);
  expect(findPinnedDigest("", "example")).toBeUndefined();
});

test("only accepts documented flags", () => {
  expect(parseBakeArguments(["--affected"])).toEqual({
    affected: true,
    push: false,
  });
  expect(() => parseBakeArguments(["--unknown"])).toThrow("Unknown");
  expect(knownImageTargets).toContain("scout-for-lol");
});

test("validates external JSON arrays", () => {
  expect(parseStringArray(["one", "two"], "targets")).toEqual(["one", "two"]);
  expect(() => parseStringArray({}, "targets")).toThrow("array");
  expect(() => parseStringArray(["one", 2], "targets")).toThrow(
    "only contain strings",
  );
  expect(parseBuildkiteCommits([{ commit: "one" }, { commit: "two" }])).toEqual(
    ["one", "two"],
  );
  expect(() => parseBuildkiteCommits({})).toThrow("array");
  expect(() => parseBuildkiteCommits([{}])).toThrow("contain a commit");
});
