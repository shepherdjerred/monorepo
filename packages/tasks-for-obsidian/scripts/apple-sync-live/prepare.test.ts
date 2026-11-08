import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { fixtures, digest } from "./model";
import { seed } from "./prepare";

test("live seed uses complete official statuses instead of the mapper-only examples", async () => {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-live-seed-")),
  );
  try {
    const target = path.join(directory, "vault");
    const result = await seed(target);
    const settings = await Bun.file(
      path.join(target, ".obsidian/plugins/tasknotes/data.json"),
    ).json();
    const official = await Bun.file(
      path.join(fixtures, "vault/tasknotes-4.13.8-statuses.json"),
    ).json();
    expect(settings.customStatuses).toEqual(official.statuses);
    expect(settings.customStatuses).toHaveLength(4);
    expect(
      settings.customStatuses.map((status: { value: string }) => status.value),
    ).toEqual(["none", "open", "in-progress", "done"]);
    for (const status of settings.customStatuses) {
      expect(status).toMatchObject({
        id: expect.any(String),
        value: expect.any(String),
        label: expect.any(String),
        color: expect.any(String),
        order: expect.any(Number),
        isCompleted: expect.any(Boolean),
        autoArchive: false,
        autoArchiveDelay: 5,
      });
    }
    expect(settings.storeTitleInFilename).toBe(false);
    expect(settings.defaultTaskStatus).toBe("open");
    expect(settings.taskCreationDefaults).toEqual({ useBodyTemplate: false });
    const corpusPath = path.join(fixtures, "vault/upstream/config.json");
    const corpus = await Bun.file(corpusPath).json();
    expect(
      corpus.find((entry: { id: string }) => entry.id === "config.0659").input
        .data.customStatuses[0],
    ).toEqual({
      value: "open",
      isCompleted: false,
    });
    expect(result.pluginFixtureSHA256).toBe(digest(await readFile(corpusPath)));
    expect(Object.keys(result.reference)).toHaveLength(5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
