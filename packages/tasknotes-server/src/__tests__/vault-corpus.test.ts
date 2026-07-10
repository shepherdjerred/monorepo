import { describe, expect, test } from "bun:test";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TASKNOTES_SPEC_VERSION, resolveModelConfig } from "tasknotes-types/v2";

import { TaskRepository } from "../engine/task-repository.ts";

/**
 * Golden corpus: the tolerant-parse kill-cases from the 2026-07-02 review,
 * exercised through the real TaskRepository over real files. The manifest
 * says what every fixture MUST parse to; the meta-test below greps fixture
 * bytes so a well-meaning formatter can't quietly defuse a case (e.g. by
 * quoting the unquoted date).
 */

const CORPUS = path.join(import.meta.dir, "fixtures", "vault-corpus");

async function scanCorpus(): Promise<TaskRepository> {
  // Copy to a temp dir so accidental writes can never mutate fixtures.
  const vault = await mkdtemp(path.join(tmpdir(), "tn-corpus-"));
  await cp(CORPUS, vault, { recursive: true });
  const repo = new TaskRepository(
    vault,
    "TaskNotes",
    resolveModelConfig(),
    () => new Date("2026-07-03T12:00:00.000Z"),
  );
  await repo.scan();
  return repo;
}

test("the model spec version is pinned — a bump must be reviewed", () => {
  expect(TASKNOTES_SPEC_VERSION).toBe("0.2.0");
});

describe("golden corpus parses per manifest", () => {
  test("every fixture is visible; none are skipped", async () => {
    const repo = await scanCorpus();
    expect(repo.skippedFiles()).toEqual([]);
    expect(repo.list()).toHaveLength(8);
  });

  test("unquoted YAML date reads as a plain date string", async () => {
    const repo = await scanCorpus();
    const task = repo.get("TaskNotes/unquoted-date.md")?.task;
    expect(task?.due).toBe("2026-07-10");
  });

  test("missing title falls back to the filename (storeTitleInFilename)", async () => {
    const repo = await scanCorpus();
    const task = repo.get("TaskNotes/missing-title.md")?.task;
    expect(task?.title).toBe("missing-title");
  });

  test("workflow status 'none' survives (config-driven, not enum-clamped)", async () => {
    const repo = await scanCorpus();
    const task = repo.get("TaskNotes/status-none.md")?.task;
    expect(task?.status).toBe("none");
    expect(repo.isCompleted(task?.status)).toBe(false);
  });

  test("scalar values for list fields normalize to arrays", async () => {
    const repo = await scanCorpus();
    const task = repo.get("TaskNotes/scalar-fields.md")?.task;
    expect(task?.contexts).toEqual(["home"]);
    expect(task?.projects).toEqual(["Personal"]);
    expect(task?.tags).toContain("task");
  });

  test("wikilink projects pass through verbatim", async () => {
    const repo = await scanCorpus();
    const task = repo.get("TaskNotes/wikilink-project.md")?.task;
    expect(task?.projects).toEqual(["[[Projects/Big Launch|Launch]]"]);
  });

  test("user-defined frontmatter keys survive an update untouched", async () => {
    const repo = await scanCorpus();
    await repo.update("TaskNotes/custom-fields.md", { priority: "high" });
    const entry = repo.get("TaskNotes/custom-fields.md");
    expect(entry?.frontmatter["project-notes"]).toBe(
      "user-defined key the engine must preserve",
    );
    expect(entry?.frontmatter["effort"]).toBe(5);
  });

  test("recurring fields parse with snake_case names intact", async () => {
    const repo = await scanCorpus();
    const task = repo.get("TaskNotes/recurring.md")?.task;
    expect(task?.recurrence).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(task?.recurrence_anchor).toBe("scheduled");
    expect(task?.complete_instances).toEqual(["2026-06-29"]);
  });

  test("a --- pair inside the body is not parsed as frontmatter", async () => {
    const repo = await scanCorpus();
    const entry = repo.get("TaskNotes/body-with-fake-frontmatter.md");
    expect(entry?.task.title).toBe("Fake frontmatter in body");
    expect(entry?.body).toContain("not: frontmatter");
    expect(entry?.frontmatter["not"]).toBeUndefined();
  });
});

function readFixture(name: string): Promise<string> {
  return Bun.file(path.join(CORPUS, "TaskNotes", name)).text();
}

describe("corpus meta-test — fixtures keep their tricky bytes", () => {
  test("formatters have not defused the corpus", async () => {
    const read = readFixture;

    // Unquoted date must stay unquoted.
    expect(await read("unquoted-date.md")).toContain("due: 2026-07-10\n");
    // Scalar list fields must stay scalars.
    expect(await read("scalar-fields.md")).toContain("contexts: home\n");
    // The fake frontmatter pair must remain in the body.
    expect(await read("body-with-fake-frontmatter.md")).toContain(
      "\n---\nnot: frontmatter\n---\n",
    );
    // No title key at all in the missing-title fixture.
    expect(await read("missing-title.md")).not.toContain("title:");
  });
});
