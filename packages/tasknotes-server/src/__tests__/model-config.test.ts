import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { dataJsonPath, loadModelConfig } from "../engine/model-config.ts";

async function makeVault(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tn-model-config-"));
}

async function writeDataJson(vault: string, value: unknown): Promise<void> {
  const target = dataJsonPath(vault);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value));
}

describe("loadModelConfig", () => {
  test("missing data.json falls back to defaults with source=defaults", async () => {
    const vault = await makeVault();
    const loaded = await loadModelConfig(vault);
    expect(loaded.source).toBe("defaults");
    expect(loaded.config.taskIdentification.tag.length).toBeGreaterThan(0);
    expect(loaded.config.statuses.length).toBeGreaterThan(0);
  });

  test("plugin settings drive identification, statuses, and mapping", async () => {
    const vault = await makeVault();
    await writeDataJson(vault, {
      taskTag: "todo",
      taskIdentificationMethod: "tag",
      storeTitleInFilename: false,
      fieldMapping: { due: "deadline" },
      customStatuses: [
        {
          id: "s-open",
          value: "open",
          label: "Open",
          color: "#aaa",
          isCompleted: false,
          order: 1,
          autoArchive: false,
          autoArchiveDelay: 0,
        },
        {
          id: "s-done",
          value: "done",
          label: "Done",
          color: "#bbb",
          isCompleted: true,
          order: 2,
          autoArchive: false,
          autoArchiveDelay: 0,
        },
      ],
      // Plugin versions carry plenty of keys we don't consume:
      apiPort: 8080,
      enableWebhooks: false,
    });

    const loaded = await loadModelConfig(vault);
    expect(loaded.source).toBe("plugin-data-json");
    expect(loaded.config.taskIdentification.tag).toBe("todo");
    expect(loaded.config.storeTitleInFilename).toBe(false);
    expect(loaded.config.fieldMapping.due).toBe("deadline");
    // Unmapped fields keep their defaults (merged, not replaced).
    expect(loaded.config.fieldMapping.status.length).toBeGreaterThan(0);
    expect(loaded.config.statuses.map((s) => s.value)).toEqual([
      "open",
      "done",
    ]);
  });

  test("a present-but-corrupt data.json throws (never silent defaults)", async () => {
    const vault = await makeVault();
    await writeDataJson(vault, { customStatuses: [{ bogus: true }] });
    await expect(loadModelConfig(vault)).rejects.toThrow();
  });
});
