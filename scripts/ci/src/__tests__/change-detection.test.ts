import { describe, expect, it } from "bun:test";
import {
  _checkInfraChanges,
  _extractPackageName,
  _transitiveClosure,
} from "../change-detection.ts";

describe("checkInfraChanges", () => {
  it("returns true for bun.lock changes", () => {
    expect(_checkInfraChanges(["bun.lock"])).toBe(true);
  });

  it("returns true for package.json changes", () => {
    expect(_checkInfraChanges(["package.json"])).toBe(true);
  });

  it("returns true for .buildkite/ changes", () => {
    expect(_checkInfraChanges([".buildkite/pipeline.yml"])).toBe(true);
  });

  it("returns true for .dagger/ changes", () => {
    expect(_checkInfraChanges([".dagger/src/index.ts"])).toBe(true);
  });

  it("returns true for scripts/ci/ changes", () => {
    expect(_checkInfraChanges(["scripts/ci/src/main.ts"])).toBe(true);
  });

  it("returns false for package-only changes", () => {
    expect(_checkInfraChanges(["packages/birmel/src/index.ts"])).toBe(false);
  });

  it("returns false for empty list", () => {
    expect(_checkInfraChanges([])).toBe(false);
  });
});

describe("extractPackageName", () => {
  it("extracts package name from packages/ path", () => {
    expect(_extractPackageName("packages/birmel/src/index.ts")).toBe("birmel");
  });

  it("extracts top-level package from nested paths", () => {
    expect(_extractPackageName("packages/homelab/src/cdk8s/main.ts")).toBe(
      "homelab",
    );
  });

  it("returns null for non-package paths", () => {
    expect(_extractPackageName("scripts/ci/src/main.ts")).toBeNull();
    expect(_extractPackageName(".buildkite/pipeline.yml")).toBeNull();
  });
});

describe("transitiveClosure", () => {
  it("includes directly changed packages", () => {
    const deps = new Map<string, Set<string>>();
    deps.set("a", new Set());
    deps.set("b", new Set());

    const result = _transitiveClosure(new Set(["a"]), deps);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(false);
  });

  it("includes packages that depend on changed packages", () => {
    const deps = new Map<string, Set<string>>();
    deps.set("a", new Set()); // a has no deps
    deps.set("b", new Set(["a"])); // b depends on a

    const result = _transitiveClosure(new Set(["a"]), deps);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
  });

  it("follows transitive dependencies", () => {
    const deps = new Map<string, Set<string>>();
    deps.set("a", new Set()); // a has no deps
    deps.set("b", new Set(["a"])); // b depends on a
    deps.set("c", new Set(["b"])); // c depends on b

    const result = _transitiveClosure(new Set(["a"]), deps);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
    expect(result.has("c")).toBe(true);
  });

  it("does not include unrelated packages", () => {
    const deps = new Map<string, Set<string>>();
    deps.set("a", new Set());
    deps.set("b", new Set(["a"]));
    deps.set("c", new Set());

    const result = _transitiveClosure(new Set(["a"]), deps);
    expect(result.has("c")).toBe(false);
  });
});
