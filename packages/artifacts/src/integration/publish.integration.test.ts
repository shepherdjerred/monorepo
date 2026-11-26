import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BoardIndexSchema } from "#shared/contract.ts";
import {
  HttpError,
  agentHeaders,
  createClient,
  humanHeaders,
  manifest,
  publish,
  type TestClient,
} from "#testing/client.ts";
import { createMigratedDatabase } from "#testing/database.ts";
import { headerOf, statusOf, textOf } from "#testing/response.ts";
import {
  CONTENT_ORIGIN,
  createTestRuntime,
  type TestRuntime,
} from "#testing/runtime.ts";
import { z } from "zod";

const HTML = {
  body: "<!doctype html><title>a</title><p>one</p>",
  mediaType: "text/html",
};
const CSS = { body: "p { color: red }", mediaType: "text/css" };

/** Content no earlier test uploaded, so the blob is genuinely new. */
const unique = (label: string) => ({
  body: `<!doctype html><p>${label} ${crypto.randomUUID()}</p>`,
  mediaType: "text/html",
});

let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
let runtime: TestRuntime;
let agent: TestClient;
let human: TestClient;

beforeAll(async () => {
  database = await createMigratedDatabase();
  runtime = await createTestRuntime({
    db: database.db,
    databaseUrl: database.url,
  });
  agent = createClient(runtime, agentHeaders("publisher"));
  human = createClient(runtime, humanHeaders());
});
afterAll(async () => {
  await database.close();
});

const entry = (path: string, size: number) => ({
  path,
  size,
  sha256: "a".repeat(64),
  mediaType: "text/plain",
});

async function expectHttp(work: Promise<unknown>, status: number) {
  try {
    await work;
  } catch (error) {
    if (error instanceof HttpError) {
      expect(error.status).toBe(status);
      return error.body;
    }
    throw error;
  }
  throw new Error(`expected HTTP ${String(status)}`);
}

describe("publish", () => {
  it("uploads, commits, places a frame and serves the version from a token URL", async () => {
    const { committed } = await publish(
      agent,
      { "index.html": HTML, "site.css": CSS },
      { board: "first", title: "First" },
    );
    expect(committed.number).toBe(1);
    expect(committed.reviewUrl).toBe(
      `https://app.example.test/a/${committed.artifactId}`,
    );
    expect(committed.boardUrl).toBe("https://app.example.test/b/first");

    const board = z
      .object({ index: BoardIndexSchema })
      .parse(await human.query("boards.get", { slug: "first" }));
    expect(Object.keys(board.index.frames)).toEqual([committed.artifactId]);

    const detail = z
      .object({ current: z.object({ contentUrl: z.string() }) })
      .parse(await human.query("artifacts.get", { id: committed.artifactId }));
    const prefix = new URL(detail.current.contentUrl);
    expect(prefix.origin).toBe(CONTENT_ORIGIN);
    const page = await runtime.call("content", prefix.pathname);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<p>one</p>");
    expect(
      await textOf(runtime.call("content", `${prefix.pathname}site.css`)),
    ).toBe(CSS.body);
    expect(
      await statusOf(runtime.call("content", `${prefix.pathname}missing.js`)),
    ).toBe(404);
  });

  it("names the board by title on the artifact, for the focused view's breadcrumb", async () => {
    await human.mutate("boards.create", {
      slug: "named-board",
      title: "Quarterly review",
    });
    const { committed } = await publish(
      agent,
      { "index.html": HTML },
      { board: "named-board" },
    );
    const Titled = z.object({ boardSlug: z.string(), boardTitle: z.string() });
    expect(
      Titled.parse(
        await human.query("artifacts.get", { id: committed.artifactId }),
      ),
    ).toEqual({ boardSlug: "named-board", boardTitle: "Quarterly review" });
    expect(
      z
        .array(Titled)
        .parse(await human.query("artifacts.list", { board: "named-board" })),
    ).toEqual([{ boardSlug: "named-board", boardTitle: "Quarterly review" }]);
  });

  it("is idempotent: the same key and request resume, a different request conflicts", async () => {
    const files = { "index.html": HTML };
    const first = await publish(agent, files, {
      board: "idem",
      key: "idem-key-0000000001",
    });
    const again = await publish(agent, files, {
      board: "idem",
      key: "idem-key-0000000001",
    });
    expect(again.created.uploadId).toBe(first.created.uploadId);
    expect(again.created.missing).toEqual([]);
    expect(again.created.deduplicated).toBe(true);
    expect(first.committed.deduplicated).toBe(false);
    expect(again.committed).toEqual({ ...first.committed, deduplicated: true });
    await expectHttp(
      publish(
        agent,
        { "index.html": { ...HTML, body: "<p>different</p>" } },
        { board: "idem", key: "idem-key-0000000001" },
      ),
      409,
    );
  });

  it("asks only for blobs the service lacks", async () => {
    const page = unique("dedupe");
    const { created } = await publish(
      agent,
      {
        "index.html": page,
        "a.css": { ...CSS, body: `p { color: ${crypto.randomUUID()} }` },
      },
      { board: "dedupe" },
    );
    expect(created.missing).toHaveLength(2);
    const second = await publish(
      agent,
      {
        "index.html": page,
        "b.css": { ...CSS, body: `p { color: ${crypto.randomUUID()} }` },
      },
      { board: "dedupe", title: "Other" },
    );
    expect(second.created.missing).toHaveLength(1);
  });

  it("compare-and-sets the current version at create and at commit", async () => {
    const v1 = await publish(agent, { "index.html": HTML }, { board: "cas" });
    const v2 = await publish(
      agent,
      { "index.html": { ...HTML, body: "<p>two</p>" } },
      {
        board: "cas",
        artifactId: v1.committed.artifactId,
        expected: v1.committed.versionId,
      },
    );
    expect(v2.committed.number).toBe(2);
    const stale = await expectHttp(
      publish(
        agent,
        { "index.html": { ...HTML, body: "<p>three</p>" } },
        {
          board: "cas",
          artifactId: v1.committed.artifactId,
          expected: v1.committed.versionId,
        },
      ),
      409,
    );
    expect(stale).toMatchObject({ currentVersionId: v2.committed.versionId });

    // Two sessions opened against v2: the first commit wins, the second is told who did.
    const files = (body: string) => ({ "index.html": { ...HTML, body } });
    const open = async (body: string) => {
      const request = {
        board: "cas",
        title: "Concept",
        entryPath: "index.html",
        artifactId: v1.committed.artifactId,
        idempotencyKey: crypto.randomUUID(),
        expectedCurrentVersionId: v2.committed.versionId,
        files: await manifest(files(body)),
      };
      const created = z
        .object({ uploadId: z.string() })
        .parse(await agent.json("/api/uploads", { body: request }));
      for (const file of request.files)
        await agent.putBlob(created.uploadId, file.sha256, body);
      return created.uploadId;
    };
    const [left, right] = [
      await open("<p>left</p>"),
      await open("<p>right</p>"),
    ];
    await agent.json(`/api/uploads/${left}/commit`);
    const conflict = await expectHttp(
      agent.json(`/api/uploads/${right}/commit`),
      409,
    );
    expect(conflict).toMatchObject({ currentVersionId: expect.any(String) });
  });
});

describe("retries and board titles", () => {
  it("returns the original result when a client retries after a successful commit", async () => {
    const v1 = await publish(
      agent,
      { "index.html": unique("retry") },
      { board: "retry" },
    );
    const files = { "index.html": unique("retry v2") };
    const options = {
      board: "retry",
      artifactId: v1.committed.artifactId,
      key: "retry-key-00000000001",
    };
    const v2 = await publish(agent, files, {
      ...options,
      expected: v1.committed.versionId,
    });
    expect(v2.committed).toMatchObject({ number: 2, deduplicated: false });
    // The client lost the response, re-read the current version (now v2) and retries.
    const again = await publish(agent, files, {
      ...options,
      expected: v2.committed.versionId,
    });
    expect(again.created).toMatchObject({
      uploadId: v2.created.uploadId,
      deduplicated: true,
      missing: [],
    });
    expect(again.committed).toEqual({ ...v2.committed, deduplicated: true });
    // A genuinely different manifest under the same key is still a conflict.
    await expectHttp(
      publish(
        agent,
        { "index.html": unique("other") },
        { ...options, expected: v2.committed.versionId },
      ),
      409,
    );
    // The artifact still has exactly two versions.
    const versions = z.array(z.unknown()).parse(
      await human.query("artifacts.versions", {
        id: v1.committed.artifactId,
      }),
    );
    expect(versions).toHaveLength(2);
  });

  it("creates a missing board with boardTitle, or the slug, in the create call", async () => {
    await publish(
      agent,
      { "index.html": unique("titled") },
      { board: "titled-board", boardTitle: "Pretty Title" },
    );
    await publish(
      agent,
      { "index.html": unique("untitled") },
      { board: "untitled-board" },
    );
    await publish(
      agent,
      { "index.html": unique("kept") },
      { board: "titled-board", boardTitle: "Ignored" },
    );
    const boards = z
      .array(z.object({ slug: z.string(), title: z.string() }))
      .parse(await human.query("boards.list"));
    const title = (slug: string) =>
      boards.find((board) => board.slug === slug)?.title;
    expect(title("titled-board")).toBe("Pretty Title");
    expect(title("untitled-board")).toBe("untitled-board");
  });
});

describe("blob uploads", () => {
  it("refuses a commit with missing blobs and lists them", async () => {
    const page = unique("missing");
    const request = {
      board: "missing",
      title: "Concept",
      entryPath: "index.html",
      idempotencyKey: crypto.randomUUID(),
      expectedCurrentVersionId: null,
      files: await manifest({ "index.html": page }),
    };
    const created = z
      .object({ uploadId: z.string() })
      .parse(await agent.json("/api/uploads", { body: request }));
    const body = await expectHttp(
      agent.json(`/api/uploads/${created.uploadId}/commit`),
      409,
    );
    expect(body).toMatchObject({ missing: [request.files[0]?.sha256] });
  });

  it("deletes the object and answers 422 on a sha256 or size mismatch", async () => {
    const page = unique("mismatch");
    const request = {
      board: "mismatch",
      title: "Concept",
      entryPath: "index.html",
      idempotencyKey: crypto.randomUUID(),
      expectedCurrentVersionId: null,
      files: await manifest({ "index.html": page }),
    };
    const created = z
      .object({ uploadId: z.string() })
      .parse(await agent.json("/api/uploads", { body: request }));
    const digest = request.files[0]?.sha256 ?? "";
    const before = runtime.store.keys().length;
    await expectHttp(
      agent.putBlob(created.uploadId, digest, "x".repeat(page.body.length)),
      422,
    );
    await expectHttp(
      agent.putBlob(created.uploadId, digest, `${page.body}!`),
      422,
    );
    await expectHttp(
      agent.putBlob(created.uploadId, digest, page.body.slice(1)),
      422,
    );
    expect(runtime.store.keys()).toHaveLength(before);
    await expectHttp(agent.putBlob(created.uploadId, "a".repeat(64), "x"), 404);
    expect(await agent.putBlob(created.uploadId, digest, page.body)).toEqual({
      status: "stored",
    });
    expect(runtime.store.keys()).toHaveLength(before + 1);
  });

  it("keeps one object when two uploads race to store the same digest", async () => {
    const files = {
      "index.html": { body: "<p>race</p>", mediaType: "text/html" },
    };
    const open = async (title: string) => {
      const request = {
        board: "race",
        title,
        entryPath: "index.html",
        idempotencyKey: crypto.randomUUID(),
        expectedCurrentVersionId: null,
        files: await manifest(files),
      };
      const created = z
        .object({ uploadId: z.string() })
        .parse(await agent.json("/api/uploads", { body: request }));
      return {
        uploadId: created.uploadId,
        digest: request.files[0]?.sha256 ?? "",
      };
    };
    const [a, b] = [await open("A"), await open("B")];
    const before = runtime.store.keys().length;
    const results = await Promise.all([
      agent.putBlob(a.uploadId, a.digest, files["index.html"].body),
      agent.putBlob(b.uploadId, b.digest, files["index.html"].body),
    ]);
    expect(
      results
        .map((result) => z.object({ status: z.string() }).parse(result).status)
        .toSorted(),
    ).toEqual(expect.arrayContaining(["stored"]));
    expect(runtime.store.keys()).toHaveLength(before + 1);
  });
});

describe("publish limits", () => {
  it("enforces the configured limits with 413", async () => {
    const small = await createTestRuntime({
      db: database.db,
      flagValues: {
        "artifacts-max-files": 1,
        "artifacts-max-file-bytes": 10,
        "artifacts-max-version-bytes": 15,
      },
    });
    const client = createClient(small, agentHeaders("limited"));
    const base = {
      board: "limits",
      title: "T",
      entryPath: "a.txt",
      expectedCurrentVersionId: null,
    };
    await expectHttp(
      client.json("/api/uploads", {
        body: {
          ...base,
          idempotencyKey: "limit-key-00000000001",
          files: [entry("a.txt", 5), entry("b.txt", 5)],
        },
      }),
      413,
    );
    await expectHttp(
      client.json("/api/uploads", {
        body: {
          ...base,
          idempotencyKey: "limit-key-00000000002",
          files: [entry("a.txt", 11)],
        },
      }),
      413,
    );
  });

  it("pauses every write, and only writes, while artifacts-enabled is off", async () => {
    const paused = await createTestRuntime({
      db: database.db,
      flagValues: { "artifacts-enabled": false },
    });
    const agentPaused = createClient(paused, agentHeaders("paused"));
    const humanPaused = createClient(paused, humanHeaders());
    await expectHttp(
      publish(agentPaused, { "index.html": HTML }, { board: "paused" }),
      403,
    );
    await expectHttp(
      humanPaused.mutate("boards.create", { slug: "paused-board", title: "x" }),
      403,
    );
    expect(Array.isArray(await humanPaused.query("boards.list"))).toBe(true);
    await expectHttp(
      humanPaused.mutate("feedback.claim", {
        scope: { type: "board", board: "first" },
      }),
      403,
    );
  });
});

describe("tokens", () => {
  it("rotates a token: the old URL 404s at once and the new one serves", async () => {
    const { committed } = await publish(
      agent,
      { "index.html": HTML },
      { board: "rotate" },
    );
    const read = async () =>
      z
        .object({ contentUrl: z.string() })
        .parse(await human.query("versions.get", { id: committed.versionId }))
        .contentUrl;
    const oldUrl = new URL(await read());
    expect(await statusOf(runtime.call("content", oldUrl.pathname))).toBe(200);
    const rotated = z
      .object({ contentUrl: z.string() })
      .parse(
        await human.mutate("versions.rotateToken", { id: committed.versionId }),
      );
    expect(rotated.contentUrl).not.toBe(oldUrl.href);
    expect(await statusOf(runtime.call("content", oldUrl.pathname))).toBe(404);
    expect(
      await statusOf(
        runtime.call("content", new URL(rotated.contentUrl).pathname),
      ),
    ).toBe(200);
    expect(
      await headerOf(
        runtime.call("content", oldUrl.pathname),
        "Content-Security-Policy",
      ),
    ).toContain("sandbox");
  });
});

describe("boards", () => {
  it("merges operations under a lock and never refuses them", async () => {
    await human.mutate("boards.create", { slug: "ops", title: "Ops" });
    const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
    const results = await Promise.all(
      ids.map((artifactId) =>
        human.mutate("boards.applyOps", {
          slug: "ops",
          ops: [{ op: "placeFrame", artifactId, w: 100, h: 100 }],
        }),
      ),
    );
    expect(results).toHaveLength(8);
    const board = z
      .object({
        index: BoardIndexSchema,
        board: z.object({ revision: z.number() }),
      })
      .parse(await human.query("boards.get", { slug: "ops" }));
    expect(Object.keys(board.index.frames).toSorted()).toEqual(ids.toSorted());
    expect(board.board.revision).toBe(9);
    const frames = Object.values(board.index.frames).map((frame) => frame.x);
    expect(new Set(frames).size).toBe(8);
  });

  it("replaces the whole document only against the current revision", async () => {
    await human.mutate("boards.create", { slug: "replace", title: "Replace" });
    const current = z
      .object({
        index: BoardIndexSchema,
        board: z.object({ revision: z.number() }),
      })
      .parse(await human.query("boards.get", { slug: "replace" }));
    const next = { ...current.index, pages: [{ name: "Renamed" }] };
    const saved = z.object({ revision: z.number() }).parse(
      await human.mutate("boards.replace", {
        slug: "replace",
        expectedRevision: current.board.revision,
        index: next,
      }),
    );
    expect(saved.revision).toBe(current.board.revision + 1);
    const conflict = await expectHttp(
      human.mutate("boards.replace", {
        slug: "replace",
        expectedRevision: current.board.revision,
        index: next,
      }),
      409,
    );
    expect(JSON.stringify(conflict)).toContain("Renamed");
    expect(JSON.stringify(conflict)).toContain(
      `"revision":${String(saved.revision)}`,
    );
  });

  it("keeps the last 50 whole-document revisions", async () => {
    await human.mutate("boards.create", { slug: "history", title: "History" });
    let revision = 1;
    for (let step = 0; step < 55; step += 1) {
      const doc = z
        .object({ index: BoardIndexSchema })
        .parse(await human.query("boards.get", { slug: "history" }));
      const saved = z.object({ revision: z.number() }).parse(
        await human.mutate("boards.replace", {
          slug: "history",
          expectedRevision: revision,
          index: { ...doc.index, pages: [{ name: `Page ${String(step)}` }] },
        }),
      );
      revision = saved.revision;
    }
    const board = await database.db.board.findUniqueOrThrow({
      where: { slug: "history" },
    });
    expect(
      await database.db.boardRevision.count({ where: { boardId: board.id } }),
    ).toBe(50);
  });
});
