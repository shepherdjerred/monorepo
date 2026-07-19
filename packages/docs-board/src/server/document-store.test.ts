import { afterEach, describe, expect, test } from "bun:test";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { z } from "zod";

import { createApp } from "#server/app";
import {
  DocumentConflictError,
  DocumentStore,
  DocumentWorkflowError,
} from "#server/document-store";
import { appRouter, type AppRouter } from "#server/trpc";
import { DocumentDetailSchema } from "#shared/schema";

const temporaryRoots: string[] = [];
const RequestTargetSchema = z.union([
  z.string(),
  z.instanceof(URL),
  z.instanceof(Request),
]);

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
  test("serves an inferred document contract through Hono and tRPC", async () => {
    const root = await fixtureRepository(ACTIVE_PLAN);
    const store = new DocumentStore({ repoRoot: root, watchFiles: false });
    const app = createApp(store);
    const client = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: "http://docs-board.test/trpc",
          fetch: async (request, init) => {
            const requestInit: RequestInit = {};
            if (init?.method !== undefined) requestInit.method = init.method;
            if (init?.headers !== undefined) {
              requestInit.headers = new Headers(init.headers);
            }
            if (init?.body !== undefined && init.body !== null) {
              requestInit.body = init.body;
            }
            const target = RequestTargetSchema.parse(request);
            const url =
              typeof target === "string"
                ? target
                : target instanceof URL
                  ? target.href
                  : target.url;
            return await app.request(url, requestInit);
          },
        }),
      ],
    });

    const document = await client.documents.byId.query({ id: "plan-fixture" });

    expect(document.title).toBe("Fixture");
    expect(document.workflow.humanVerificationMarkdown).toBe(
      "- Verify it live.",
    );
    store.close();
  });

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

  test("returns revision conflicts through the typed tRPC router", async () => {
    const root = await fixtureRepository(ACTIVE_PLAN);
    const store = new DocumentStore({ repoRoot: root, watchFiles: false });
    const original = await store.get("plan-fixture");
    await store.addComment(
      original.id,
      original.revision,
      "Reviewer",
      "First write",
    );
    const caller = appRouter.createCaller({ store });

    await expect(
      caller.documents.addComment({
        id: original.id,
        revision: original.revision,
        actor: "Reviewer",
        comment: "Second write",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This document changed on disk. Refresh before writing.",
    });
    store.close();
  });

  test("publishes typed changes after a successful mutation", async () => {
    const root = await fixtureRepository(ACTIVE_PLAN);
    const store = new DocumentStore({ repoRoot: root, watchFiles: false });
    const original = await store.get("plan-fixture");
    const change = Promise.withResolvers<{
      documentId: string | null;
      changedAt: string;
    }>();
    const unsubscribe = store.subscribe(change.resolve);

    await store.addComment(
      original.id,
      original.revision,
      "Reviewer",
      "Ready for the next pass.",
    );

    expect(await change.promise).toMatchObject({ documentId: original.id });
    unsubscribe();
    store.close();
  });

  test("streams typed changes through the tRPC subscription", async () => {
    const root = await fixtureRepository(ACTIVE_PLAN);
    const store = new DocumentStore({ repoRoot: root, watchFiles: false });
    const original = await store.get("plan-fixture");
    const caller = appRouter.createCaller({ store });
    const changes = await caller.documents.changes();
    const iterator = changes[Symbol.asyncIterator]();
    const nextChange = iterator.next();

    await store.addComment(
      original.id,
      original.revision,
      "Reviewer",
      "Subscription fixture.",
    );

    await expect(nextChange).resolves.toMatchObject({
      done: false,
      value: { documentId: original.id },
    });
    await iterator.return?.();
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
