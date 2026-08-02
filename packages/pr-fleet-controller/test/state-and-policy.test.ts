import { describe, expect, test } from "bun:test";
import { buildPrState } from "@shepherdjerred/pr-fleet-controller/src/fleet-logic.ts";
import { FleetStore } from "@shepherdjerred/pr-fleet-controller/src/state.ts";
import { validateWorkerCommand } from "@shepherdjerred/pr-fleet-controller/src/command-policy.ts";
import { evidence, identity } from "./fixtures.ts";

function state(number: number, stackId = `pr-${String(number)}`) {
  const pr = identity(number);
  return buildPrState(
    { identity: pr, evidence: evidence(pr), stackId },
    undefined,
    undefined,
    "openai/gpt-5",
  ).state;
}

describe("controller leases", () => {
  test("serializes setup and same-stack writes", () => {
    const store = new FleetStore(2);
    const first = state(1, "stack");
    const second = state(2, "stack");
    expect(store.requestLease(first, "setup")).toBe(true);
    expect(store.requestLease(second, "setup")).toBe(false);
    expect(store.requestLease(first, "stack-write")).toBe(true);
    expect(store.requestLease(second, "stack-write")).toBe(false);
    store.releaseLeases(first.identity.number);
    expect(store.requestLease(second, "setup")).toBe(true);
    expect(store.requestLease(second, "stack-write")).toBe(true);
  });

  test("caps heavy work at the selected worker limit", () => {
    const store = new FleetStore(1);
    expect(store.requestLease(state(1), "heavy")).toBe(true);
    expect(store.requestLease(state(2), "heavy")).toBe(false);
  });
});

describe("worker command policy", () => {
  test("allows scoped local validation", () => {
    expect(() =>
      validateWorkerCommand("bunx", [
        "turbo",
        "run",
        "test",
        "--filter=@shepherdjerred/pr-fleet-controller",
      ]),
    ).not.toThrow();
    expect(() =>
      validateWorkerCommand("bun", ["run", "verify", "--", "--affected"]),
    ).not.toThrow();
  });

  test("rejects shell, publication, deployment, and unbounded verification", () => {
    expect(() => validateWorkerCommand("sh", ["-c", "echo unsafe"])).toThrow();
    expect(() => validateWorkerCommand("bun", ["run", "deploy"])).toThrow();
    expect(() => validateWorkerCommand("bun", ["run", "verify"])).toThrow();
    expect(() =>
      validateWorkerCommand("bunx", ["turbo", "run", "test"]),
    ).toThrow();
  });

  test("rejects mise exec, which can run an arbitrary nested program", () => {
    expect(() =>
      validateWorkerCommand("mise", ["exec", "--", "sed", "-i", "s/a/b/", "x"]),
    ).toThrow();
    expect(() =>
      validateWorkerCommand("mise", ["exec", "--command", "rm -rf ."]),
    ).toThrow();
  });

  test("requires check mode for the in-place formatters", () => {
    // `cargo fmt` / `tofu fmt` rewrite tracked files by default, which would
    // mutate the shared worktree outside the explicit publication paths.
    expect(() => validateWorkerCommand("cargo", ["fmt"])).toThrow();
    expect(() =>
      validateWorkerCommand("cargo", [
        "fmt",
        "--manifest-path",
        "packages/x/Cargo.toml",
      ]),
    ).toThrow();
    expect(() =>
      validateWorkerCommand("cargo", ["fmt", "--check"]),
    ).not.toThrow();
    // `cargo fmt -- --check` passes --check through to rustfmt; still read-only.
    expect(() =>
      validateWorkerCommand("cargo", ["fmt", "--", "--check"]),
    ).not.toThrow();
    expect(() => validateWorkerCommand("tofu", ["fmt"])).toThrow();
    expect(() =>
      validateWorkerCommand("tofu", ["fmt", "-check"]),
    ).not.toThrow();
    // Non-formatter subcommands are unaffected.
    expect(() => validateWorkerCommand("cargo", ["check"])).not.toThrow();
    expect(() => validateWorkerCommand("tofu", ["validate"])).not.toThrow();
  });
});
