import { describe, expect, test } from "vitest";
import { changedEntries } from "./dist-equivalence.ts";

const BASE = "/tmp/base/packages/homelab/src/cdk8s/dist";
const HEAD = "/repo/packages/homelab/src/cdk8s/dist";

describe("changedEntries", () => {
  test("is empty when diff reports nothing", () => {
    expect(changedEntries("", BASE, HEAD)).toEqual([]);
  });

  test("names differing files once, sorted", () => {
    const brief = [
      `Files ${BASE}/syncthing.k8s.yaml and ${HEAD}/syncthing.k8s.yaml differ`,
      `Files ${BASE}/apps.k8s.yaml and ${HEAD}/apps.k8s.yaml differ`,
      "",
    ].join("\n");
    expect(changedEntries(brief, BASE, HEAD)).toEqual([
      "apps.k8s.yaml",
      "syncthing.k8s.yaml",
    ]);
  });

  test("names files present on only one side", () => {
    const brief = [
      `Only in ${BASE}: removed.k8s.yaml`,
      `Only in ${HEAD}: added.k8s.yaml`,
    ].join("\n");
    expect(changedEntries(brief, BASE, HEAD)).toEqual([
      "added.k8s.yaml",
      "removed.k8s.yaml",
    ]);
  });

  test("reports a nested difference by its top-level entry", () => {
    const brief = `Only in ${HEAD}/nested: file.yaml`;
    expect(changedEntries(brief, BASE, HEAD)).toEqual(["nested"]);
  });
});
