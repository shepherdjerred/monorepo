import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  HttpError,
  agentHeaders,
  createClient,
  humanHeaders,
  publish,
  type TestClient,
} from "#testing/client.ts";
import { createMigratedDatabase } from "#testing/database.ts";
import { createTestRuntime, type TestRuntime } from "#testing/runtime.ts";

let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
let runtime: TestRuntime;
let agent: TestClient;
let human: TestClient;
let scene: { slug: string; artifactId: string; versionId: string };

beforeAll(async () => {
  database = await createMigratedDatabase();
  runtime = await createTestRuntime({
    db: database.db,
    databaseUrl: database.url,
    flagValues: { "artifacts-feedback-settle-seconds": 0 },
  });
  agent = createClient(runtime, agentHeaders("api-agent"));
  human = createClient(runtime, humanHeaders());
  const { committed } = await publish(
    agent,
    { "index.html": { body: "<p>api</p>", mediaType: "text/html" } },
    { board: "api" },
  );
  scene = { slug: "api", ...committed };
});
afterAll(async () => {
  await database.close();
});

async function status(work: Promise<unknown>): Promise<number> {
  try {
    await work;
  } catch (error) {
    if (error instanceof HttpError) return error.status;
    throw error;
  }
  return 200;
}

const upload = (path: string) => ({
  board: "paths",
  title: "T",
  entryPath: path,
  idempotencyKey: crypto.randomUUID(),
  expectedCurrentVersionId: null,
  files: [{ path, size: 1, sha256: "c".repeat(64), mediaType: "text/plain" }],
});

const create = (input: object) =>
  human.mutate("threads.create", { board: scene.slug, body: "x", ...input });

describe("upload manifests", () => {
  it.each([
    "../escape.txt",
    "a/../../b.txt",
    "/abs.txt",
    "_t/x.txt",
    String.raw`a\b.txt`,
    "a//b.txt",
    "./a.txt",
    "a\u0000b.txt",
  ])("refuse the path %j", async (path) => {
    expect(
      await status(agent.json("/api/uploads", { body: upload(path) })),
    ).toBe(400);
  });

  it("refuses a manifest whose entry is not among its files", async () => {
    const body = { ...upload("a.txt"), entryPath: "b.txt" };
    expect(await status(agent.json("/api/uploads", { body }))).toBe(400);
  });
});

describe("identity", () => {
  it("needs an actor from a caller that is not a browser", async () => {
    const response = await runtime.call("app", "/trpc/boards.list", {});
    expect(response.status).toBe(400);
  });

  it("refuses a human actor or the human namespace in X-Artifacts-Actor", async () => {
    for (const actor of [
      { key: "human:someone", kind: "agent", name: "x", metadata: {} },
      { key: "agent:impostor", kind: "human", name: "x", metadata: {} },
    ]) {
      const response = await runtime.call("app", "/trpc/boards.list", {
        headers: {
          "X-Artifacts-Actor": Buffer.from(JSON.stringify(actor)).toString(
            "base64",
          ),
        },
      });
      expect(response.status).toBe(400);
    }
  });

  it("ignores an actor header on a browser request: the author is the verified login", async () => {
    const forged = createClient(runtime, {
      ...humanHeaders(),
      ...agentHeaders("forger"),
    });
    const thread = z
      .object({
        comments: z.array(
          z.object({ author: z.object({ key: z.string(), kind: z.string() }) }),
        ),
      })
      .parse(
        await forged.mutate("threads.create", {
          board: scene.slug,
          artifactId: scene.artifactId,
          versionId: scene.versionId,
          anchor: { type: "general" },
          body: "from the browser",
        }),
      );
    expect(thread.comments[0]?.author).toEqual({
      key: "human:operator@example.test",
      kind: "human",
    });
  });

  it("derives the workspace from hostname and worktree metadata", async () => {
    const actor = await database.db.actor.findUniqueOrThrow({
      where: { key: "agent:api-agent" },
    });
    expect(actor.workspaceKey).toBe("karpathy:/work/tree");
    const artifact = await database.db.artifact.findUniqueOrThrow({
      where: { id: scene.artifactId },
    });
    expect(artifact.ownerKey).toBe("karpathy:/work/tree");
  });
});

describe("threads", () => {
  it("validates where a thread points", async () => {
    expect(
      await status(create({ anchor: { type: "frame", x: 0.1, y: 0.1 } })),
    ).toBe(400);
    expect(
      await status(
        create({
          anchor: { type: "frame", x: 0.1, y: 0.1 },
          artifactId: scene.artifactId,
        }),
      ),
    ).toBe(400);
    expect(
      await status(
        create({
          anchor: { type: "board", page: 0, x: 1, y: 1 },
          artifactId: scene.artifactId,
          versionId: scene.versionId,
        }),
      ),
    ).toBe(400);
    expect(
      await status(
        create({
          anchor: { type: "frame", x: 0.1, y: 0.1 },
          artifactId: scene.artifactId,
          versionId: crypto.randomUUID(),
        }),
      ),
    ).toBe(404);
    expect(
      await status(
        create({
          anchor: { type: "frame", x: 4, y: 0.1 },
          artifactId: scene.artifactId,
          versionId: scene.versionId,
        }),
      ),
    ).toBe(400);
    expect(
      await status(
        create({ anchor: { type: "general" }, board: "no-such-board" }),
      ),
    ).toBe(404);
  });

  it("never delivers an agent's own comment", async () => {
    const thread = z.object({ id: z.string() }).parse(
      await agent.mutate("threads.create", {
        board: scene.slug,
        artifactId: scene.artifactId,
        versionId: scene.versionId,
        anchor: { type: "general" },
        body: "a note from the agent",
      }),
    );
    expect(thread.id).toBeTruthy();
    const claim = z
      .object({
        items: z.array(z.object({ comment: z.object({ body: z.string() }) })),
      })
      .parse(
        await createClient(runtime, agentHeaders("agent-two")).mutate(
          "feedback.claim",
          {},
        ),
      );
    expect(claim.items.map((item) => item.comment.body)).not.toContain(
      "a note from the agent",
    );
  });

  it("lets only a person redeliver, and only an author edit", async () => {
    expect(
      await status(
        agent.mutate("feedback.redeliver", { commentId: crypto.randomUUID() }),
      ),
    ).toBe(403);
    expect(
      await status(
        agent.mutate("threads.editComment", {
          commentId: crypto.randomUUID(),
          body: "x",
        }),
      ),
    ).toBe(404);
  });
});

describe("inbox and artifacts", () => {
  it("lists boards with the counts the inbox groups on", async () => {
    const inbox = z
      .object({
        boards: z.array(
          z.object({
            slug: z.string(),
            needsReviewCount: z.number(),
            openThreadCount: z.number(),
            unhandledCount: z.number(),
          }),
        ),
      })
      .parse(await human.query("inbox.list"));
    const board = inbox.boards.find((entry) => entry.slug === scene.slug);
    expect(board?.openThreadCount).toBeGreaterThan(0);
    expect(board?.needsReviewCount).toBe(0);
  });

  it("renames, versions and deletes an artifact, taking its frame off the board", async () => {
    const created = await publish(
      agent,
      {
        "index.html": {
          body: `<p>${crypto.randomUUID()}</p>`,
          mediaType: "text/html",
        },
      },
      { board: "lifecycle" },
    );
    const { artifactId, versionId } = created.committed;
    const renamed = z.object({ title: z.string() }).parse(
      await human.mutate("artifacts.rename", {
        id: artifactId,
        title: "Renamed",
      }),
    );
    expect(renamed.title).toBe("Renamed");
    const versions = z
      .array(z.object({ number: z.number() }))
      .parse(await human.query("artifacts.versions", { id: artifactId }));
    expect(versions.map((version) => version.number)).toEqual([1]);
    await human.mutate("artifacts.delete", { id: artifactId });
    const board = z
      .object({
        index: z.object({ frames: z.record(z.string(), z.unknown()) }),
      })
      .parse(await human.query("boards.get", { slug: "lifecycle" }));
    expect(Object.keys(board.index.frames)).toEqual([]);
    expect(await status(human.query("artifacts.get", { id: artifactId }))).toBe(
      404,
    );
    const view = z
      .object({ contentUrl: z.string() })
      .parse(await human.query("versions.get", { id: versionId }));
    expect(
      await runtime
        .call("content", new URL(view.contentUrl).pathname)
        .then((response) => response.status),
    ).toBe(404);
  });
});
