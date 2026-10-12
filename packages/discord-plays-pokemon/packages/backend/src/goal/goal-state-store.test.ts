import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadGoalHistory } from "./goal-state-store.ts";

describe("loadGoalHistory", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "goal-state-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("starts empty when no state file exists", async () => {
    expect(await loadGoalHistory(path.join(dir, "goal-state.json"))).toEqual(
      [],
    );
  });

  test("moves an unparseable state file aside instead of resetting it", async () => {
    const statePath = path.join(dir, "goal-state.json");
    await writeFile(statePath, "{ truncated");

    await expect(loadGoalHistory(statePath)).rejects.toThrow(/moved it to/);

    const files = await readdir(dir);
    expect(files).not.toContain("goal-state.json");
    const aside = files.find((name) =>
      name.startsWith("goal-state.json.corrupt-"),
    );
    expect(aside).toBeDefined();
    expect(await readFile(path.join(dir, aside ?? ""), "utf8")).toBe(
      "{ truncated",
    );
  });

  test("moves a wrongly shaped state file aside", async () => {
    const statePath = path.join(dir, "goal-state.json");
    await writeFile(statePath, JSON.stringify({ history: "not a list" }));

    await expect(loadGoalHistory(statePath)).rejects.toThrow(/invalid/);
    expect(await readdir(dir)).toHaveLength(1);
  });
});
