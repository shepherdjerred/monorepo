import { afterEach, describe, expect, test } from "bun:test";

import { createApp } from "#server/app";
import {
  DocumentConflictError,
  DocumentStore,
  DocumentWorkflowError,
} from "#server/document-store";
import { DocumentDetailSchema } from "#shared/schema";

const temporaryRoots: string[] = [];

async function command(
  cwd: string,
  commandArguments: string[],
): Promise<string> {
  const process = Bun.spawn(commandArguments, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0)
    throw new Error(`${commandArguments.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

async function fixtureRepository(
  markdown: string,
  path = "plans/fixture.md",
): Promise<string> {
  const root = await command("/tmp", [
    "mktemp",
    "-d",
    "-t",
    "docs-board-test.XXXXXX",
  ]);
  if (!root.includes("/docs-board-test."))
    throw new Error(`Unsafe fixture path: ${root}`);
  temporaryRoots.push(root);
  await command(root, [
    "mkdir",
    "-p",
    "packages/docs/plans",
    "packages/docs/todos",
  ]);
  await command(root, ["git", "init", "--initial-branch=main"]);
  await command(root, ["git", "config", "user.name", "Docs Board Test"]);
  await Bun.write(`${root}/packages/docs/${path}`, markdown);
  return root;
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    if (!root.includes("/docs-board-test."))
      throw new Error(`Refusing cleanup: ${root}`);
    await command("/tmp", ["trash", root]);
  }
});

const ACTIVE_PLAN = `---
id: plan-fixture
type: plan
status: in-progress
board: true
verification: human
disposition: active
---

# Fixture

## Remaining

- [ ] Deploy it.

## Human Verification

- Verify it live.
`;

describe("DocumentStore", () => {
  test("appends durable comments and rejects stale revisions", async () => {
    const root = await fixtureRepository(ACTIVE_PLAN);
    const store = new DocumentStore({ repoRoot: root, watchFiles: false });
    const original = await store.get("plan-fixture");
    const updated = await store.addComment(
      original.id,
      original.revision,
      "Human Reviewer",
      "Please verify the production deployment.",
    );

    expect(updated.commentCount).toBe(1);
    expect(updated.markdown).toContain("### ");
    expect(updated.markdown).toContain("Human Reviewer");
    expect(updated.markdown).toContain(
      "Please verify the production deployment.",
    );
    expect(
      store.addComment(original.id, original.revision, "Agent", "Stale"),
    ).rejects.toBeInstanceOf(DocumentConflictError);
    store.close();
  });

  test("guards human confirmation until agent work is cleared", async () => {
    const root = await fixtureRepository(ACTIVE_PLAN);
    const store = new DocumentStore({ repoRoot: root, watchFiles: false });
    const original = await store.get("plan-fixture");

    expect(
      store.updateStatus(original.id, {
        revision: original.revision,
        status: "awaiting-human",
        actor: "Agent",
      }),
    ).rejects.toBeInstanceOf(DocumentWorkflowError);
    store.close();
  });

  test("returns revision conflicts through the HTTP API", async () => {
    const root = await fixtureRepository(ACTIVE_PLAN);
    const store = new DocumentStore({ repoRoot: root, watchFiles: false });
    const original = await store.get("plan-fixture");
    await store.addComment(
      original.id,
      original.revision,
      "Reviewer",
      "First write",
    );
    const response = await createApp(store).request(
      `/api/documents/${original.id}/comments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: original.revision,
          actor: "Reviewer",
          comment: "Second write",
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This document changed on disk. Refresh before writing.",
    });
    store.close();
  });

  test("archives completed TODOs and preserves their audit log", async () => {
    const completedTodo = `---
id: fixture-todo
type: todo
status: complete
board: true
verification: agent
disposition: active
---

# Fixture TODO
`;
    const root = await fixtureRepository(
      completedTodo,
      "todos/fixture-todo.md",
    );
    const store = new DocumentStore({ repoRoot: root, watchFiles: false });
    const original = await store.get("fixture-todo");
    const archived = DocumentDetailSchema.parse(
      await store.archive(original.id, original.revision, "Agent"),
    );

    expect(archived.path).toBe("archive/completed/fixture-todo.md");
    expect(archived.markdown).toContain(
      "Archived to `packages/docs/archive/completed/`",
    );
    expect(
      await Bun.file(`${root}/packages/docs/todos/fixture-todo.md`).exists(),
    ).toBe(false);
    expect(
      await Bun.file(
        `${root}/packages/docs/archive/completed/fixture-todo.md`,
      ).exists(),
    ).toBe(true);
    store.close();
  });
});
