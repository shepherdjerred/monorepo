import { expect, test } from "vitest";
import { readLiveVersionCatalogSource } from "./live-version-catalog.ts";
import type { LiveCatalogExecutor } from "./live-version-catalog.ts";
import type { BuildxCommandResult } from "./bake-retry.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";

function commandResult(exitCode = 0, stdout = ""): BuildxCommandResult {
  return { exitCode, stdout, stderr: "" };
}

const CATALOG = JSON.stringify({
  entries: [
    {
      name: "shepherdjerred/temporal-worker/workflows/stable",
      value: `2.0.0-500@sha256:${"a".repeat(64)}`,
    },
    {
      name: "shepherdjerred/temporal-worker/workflows/candidate",
      value: `2.0.0-500@sha256:${"a".repeat(64)}`,
    },
  ],
});

test("returns the live catalog without consulting the version-bump branch", async () => {
  const commands: string[] = [];
  const executor: LiveCatalogExecutor = async (command) => {
    commands.push(command.join(" "));
    return command[1] === "fetch" ? commandResult() : commandResult(0, CATALOG);
  };
  await expect(readLiveVersionCatalogSource(executor)).resolves.toBe(CATALOG);
  expect(commands).toEqual([
    "git fetch origin main",
    "git show origin/main:packages/version-catalog/src/catalog.json",
  ]);
});

test("fails transiently when origin main cannot be refreshed", async () => {
  await expect(
    readLiveVersionCatalogSource(async () => commandResult(1)),
  ).rejects.toThrow(TransientError);
});

test("fails transiently when the live version catalog cannot be read", async () => {
  await expect(
    readLiveVersionCatalogSource(async (command) =>
      command[1] === "fetch" ? commandResult() : commandResult(1),
    ),
  ).rejects.toThrow(TransientError);
});

test("rejects malformed live version catalogs", async () => {
  for (const catalog of [
    JSON.stringify({ entries: "invalid" }),
    JSON.stringify({ entries: ["invalid"] }),
  ]) {
    await expect(
      readLiveVersionCatalogSource(async (command) =>
        command[1] === "fetch" ? commandResult() : commandResult(0, catalog),
      ),
    ).rejects.toThrow("Live version catalog has an invalid");
  }
});
