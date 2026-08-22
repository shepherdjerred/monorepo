import { describe, expect, test } from "vitest";

import { TaskNotesClient } from "./TaskNotesClient";

/**
 * What a full pull is allowed to return.
 *
 * The v2 list endpoint pages by offset into a live array, so a create or a
 * delete landing between two page requests shifts every item after it — and the
 * sync engine treats whatever comes back as the authoritative list, so a skipped
 * task disappears from the app while the vault still holds it. These cases are
 * the three self-checks that stop an incomplete read being adopted, and they are
 * the same three the Rust core's client applies.
 */

const BASE = "http://vault.test:8080";

type Page = { total: number; paths: string[]; hasMore: boolean };

function page({ total, paths, hasMore }: Page): Response {
  return Response.json({
    tasks: paths.map((path) => ({
      path,
      title: "A task",
      status: "open",
      priority: "normal",
    })),
    pagination: { total, offset: 0, limit: 200, hasMore },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** A transport that records every URL and replays scripted pages in order. */
function scripted(pages: Page[]): {
  fetch: typeof fetch;
  offsets: () => string[];
} {
  const urls: string[] = [];
  let next = 0;
  const stub: typeof fetch = (input) => {
    urls.push(requestUrl(input));
    const scriptedPage = pages[next];
    if (scriptedPage === undefined) {
      throw new Error("the transport ran out of scripted pages");
    }
    next += 1;
    return Promise.resolve(page(scriptedPage));
  };
  return {
    fetch: stub,
    offsets: () =>
      urls.map((url) => new URL(url).searchParams.get("offset") ?? ""),
  };
}

describe("listTasks", () => {
  test("pages until hasMore is false, advancing by what it received", async () => {
    const transport = scripted([
      { total: 2, paths: ["TaskNotes/a.md"], hasMore: true },
      { total: 2, paths: ["TaskNotes/b.md"], hasMore: false },
    ]);
    const client = new TaskNotesClient({
      baseUrl: BASE,
      fetch: transport.fetch,
    });

    const result = await client.listTasks();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((task) => String(task.id))).toEqual([
      "TaskNotes/a.md",
      "TaskNotes/b.md",
    ]);
    expect(transport.offsets()).toEqual(["0", "1"]);
  });

  test("a total that moves between pages restarts the pull from the beginning", async () => {
    const transport = scripted([
      { total: 2, paths: ["TaskNotes/a.md"], hasMore: true },
      { total: 3, paths: ["TaskNotes/b.md"], hasMore: true },
      { total: 2, paths: ["TaskNotes/a.md"], hasMore: true },
      { total: 2, paths: ["TaskNotes/b.md"], hasMore: false },
    ]);
    const client = new TaskNotesClient({
      baseUrl: BASE,
      fetch: transport.fetch,
    });

    const result = await client.listTasks();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(transport.offsets()).toEqual(["0", "1", "0", "1"]);
  });

  test("a task arriving on two pages discards the pass", async () => {
    // A delete ahead of the offset pulls the array back by one, so an item
    // already collected slides into the next page — and the one between them is
    // never seen. The repeat is the only evidence.
    const transport = scripted([
      { total: 2, paths: ["TaskNotes/a.md"], hasMore: true },
      { total: 2, paths: ["TaskNotes/a.md"], hasMore: false },
      { total: 2, paths: ["TaskNotes/a.md"], hasMore: true },
      { total: 2, paths: ["TaskNotes/b.md"], hasMore: false },
    ]);
    const client = new TaskNotesClient({
      baseUrl: BASE,
      fetch: transport.fetch,
    });

    const result = await client.listTasks();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((task) => String(task.id))).toEqual([
      "TaskNotes/a.md",
      "TaskNotes/b.md",
    ]);
  });

  test("a pull that never reads a complete list fails rather than shrinking the vault", async () => {
    // Every pass ends one task short of the count the server itself declared.
    // Returning it would delete a live task from the app.
    const short: Page = { total: 3, paths: ["TaskNotes/a.md"], hasMore: false };
    const transport = scripted([short, short, short]);
    const client = new TaskNotesClient({
      baseUrl: BASE,
      fetch: transport.fetch,
    });

    const result = await client.listTasks();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("changed underneath");
    expect(transport.offsets()).toHaveLength(3);
  });
});
