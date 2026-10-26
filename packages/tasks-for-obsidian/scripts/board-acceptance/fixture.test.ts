import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { boardFixture, seedBoardVault, verifyBoardVault } from "./fixture.ts";

const day = "2026-10-25";
async function fixture(body: (vault: string) => Promise<void>): Promise<void> {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-board-fixture-")),
  );
  try {
    const vault = path.join(directory, "vault");
    await seedBoardVault(vault, day);
    await body(vault);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("board journeys preserve all 120 tasks and complete configuration/reference/view bytes", async () => {
  await fixture(async (vault) => {
    const result = await verifyBoardVault(vault, day);
    expect(result.taskCount).toBe(120);
    expect(result.markdownCount).toBe(122);
    expect(Object.keys(result.hashes)).toHaveLength(125);
  });
});

test("portable workflow owns two active task columns without plugin status shadowing", () => {
  const files = boardFixture(day);
  const portable = files["tasknotes.yaml"];
  const settings = files[".obsidian/plugins/tasknotes/data.json"];
  expect(portable).toBeDefined();
  expect(settings).toBeDefined();
  const workflow = z
    .object({
      status: z.object({
        values: z.array(z.string()),
        completed_values: z.array(z.string()),
      }),
    })
    .parse(Bun.YAML.parse(z.string().parse(portable))).status;
  const plugin = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(z.string().parse(settings)));
  expect(plugin["defaultTaskStatus"]).toBeUndefined();
  expect(plugin["customStatuses"]).toBeUndefined();
  expect(workflow.values).toEqual(["open", "doing", "done"]);
  expect(workflow.completed_values).toEqual(["done"]);
  const taskStatuses = Object.entries(files)
    .filter(([name]) => name.startsWith("Tasks/"))
    .map(([, source]) => {
      const frontmatter = /^---\n([\s\S]*?)\n---\n/u.exec(source)?.[1];
      return z
        .object({ status: z.string() })
        .parse(Bun.YAML.parse(z.string().parse(frontmatter))).status;
    });
  expect(taskStatuses.filter((status) => status === "open")).toHaveLength(60);
  expect(taskStatuses.filter((status) => status === "doing")).toHaveLength(60);
  expect(
    taskStatuses.every(
      (status) =>
        workflow.values.includes(status) &&
        !workflow.completed_values.includes(status),
    ),
  ).toBe(true);
});

test.each([
  ["Tasks/Card-095.md", "vendorBoard", "changedVendor"],
  ["Tasks/Card-119.md", "Second line.", "Changed body."],
  ["Reference.md", "**Markdown**", "Changed reference"],
  ["Facet/Views/board-acceptance.md", "viewType: board", "viewType: list"],
  ["tasknotes.yaml", "[open, doing, done]", "[open, done]"],
  [".obsidian/plugins/tasknotes/data.json", '"Tasks"', '"Elsewhere"'],
  ["Assets/unchanged.txt", "exact", "changed"],
])(
  "rejects collateral bytes changed in %s",
  async (relative, before, after) => {
    await fixture(async (vault) => {
      const filename = path.join(vault, relative);
      const original = await Bun.file(filename).text();
      const changed = original.replace(before, after);
      expect(changed).not.toBe(original);
      await Bun.write(filename, changed);
      await expect(verifyBoardVault(vault, day)).rejects.toThrow(
        "changed bytes",
      );
    });
  },
);

test("rejects an extra captured task and a missing late task", async () => {
  await fixture(async (vault) => {
    const extra = path.join(vault, "Tasks/Unexpected.md");
    await Bun.write(extra, "Unexpected note\n");
    await expect(verifyBoardVault(vault, day)).rejects.toThrow(
      "exact file set",
    );
    await rm(extra);
    await rm(path.join(vault, "Tasks/Card-119.md"));
    await expect(verifyBoardVault(vault, day)).rejects.toThrow(
      "exact file set",
    );
  });
});
