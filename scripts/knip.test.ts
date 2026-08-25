import { expect, test } from "vitest";
import { checkKnip, generateCommands, knipCommand } from "./knip.ts";

test("knip gate enforces configuration hints via knip's structured flag", () => {
  expect(knipCommand).toContain("--treat-config-hints-as-errors");
  expect(knipCommand).not.toContain("--no-config-hints");
  // The gate must run the workspace-installed knip, never a network fetch.
  expect(knipCommand.slice(0, 3)).toEqual(["bunx", "--no-install", "knip"]);
});

test("knip gate materializes temporal's ha-schema so resolution is deterministic", () => {
  // Without this the gate is bistable: `#generated/ha-schema.ts` is
  // unresolved on a cold tree and a stale ignoreUnresolved entry on a
  // warm one. It must NOT nest `turbo run generate`: //#knip runs inside
  // the verify graph, which already runs generate, and nesting races the
  // per-package Prisma generate lock.
  expect(generateCommands).toEqual([
    ["bun", "packages/temporal/scripts/ensure-ha-schema.ts"],
  ]);
  expect(generateCommands.flat()).not.toContain("turbo");
});

test("checkKnip propagates knip's non-zero exit as a thrown error", async () => {
  // `--config <missing file>` makes knip itself fail fast without a scan, so
  // this asserts the wrapper's fail-fast contract (run() throws on non-zero)
  // without paying for a full repo analysis in unit tests.
  await expect(
    checkKnip(["--config", "knip.does-not-exist.json"]),
  ).rejects.toThrow(/Command failed/);
});
