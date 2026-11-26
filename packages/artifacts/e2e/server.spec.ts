/**
 * Acceptance of the e2e backend itself, with no UI: the upload API, the
 * content host's isolation headers, ranges, the bridge injection and the
 * feedback delivery state machine. It runs against whatever the webServer
 * serves, so it also gates a swap to the real server.
 */
import { expect, test } from "@playwright/test";
import { TRPCClientError } from "@trpc/client";
import { z } from "zod";
import { agentActor, createApiClient, type ApiClient } from "./client.ts";
import { generateFixtures, type Fixtures } from "./fixtures.ts";
import { publishFixture } from "./seed.ts";

let fixtures: Fixtures;

test.beforeAll(async () => {
  fixtures = await generateFixtures();
});

test.beforeEach(async ({ baseURL }) => {
  const response = await fetch(`${String(baseURL)}/api/_e2e/reset`, {
    method: "POST",
  });
  expect(response.status).toBe(204);
});

const ConflictDataSchema = z.looseObject({
  code: z.string(),
  conflict: z.looseObject({ revision: z.number() }).optional(),
});

async function statusOf(url: string, init?: RequestInit): Promise<number> {
  const response = await fetch(url, init);
  return response.status;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
}

async function deliveryOf(
  api: ApiClient,
  threadId: string,
): Promise<string | undefined> {
  const thread = await api.threads.get.query({ threadId });
  return thread.comments[0]?.delivery?.state;
}

function appUrl(baseURL: string | undefined): string {
  if (baseURL === undefined) throw new Error("baseURL is not configured");
  return baseURL;
}

async function contentUrlOf(
  baseURL: string,
  versionId: string,
): Promise<string> {
  const version = await createApiClient(baseURL).versions.get.query({
    id: versionId,
  });
  if (version.contentUrl === null)
    throw new Error("the version has no content URL");
  return version.contentUrl;
}

test("serves published HTML from an isolated content origin with the bridge injected", async ({
  baseURL,
}) => {
  const app = appUrl(baseURL);
  const committed = await publishFixture(app, {
    board: "smoke",
    title: "Concept A",
    files: fixtures.htmlV1.files,
    entryPath: "index.html",
  });
  const prefix = await contentUrlOf(app, committed.versionId);
  expect(new URL(prefix).origin).not.toBe(new URL(app).origin);
  expect(prefix).toMatch(/\/_t\/[\w-]{32}\/$/u);

  const response = await fetch(prefix);
  expect(response.status).toBe(200);
  const csp = response.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("sandbox allow-scripts allow-forms allow-popups;");
  expect(csp).not.toContain("allow-same-origin");
  expect(csp).toContain(`frame-ancestors ${new URL(app).origin}`);
  expect(csp).toContain(
    `script-src ${prefix} ${new URL(prefix).origin}/_bridge/`,
  );
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("cross-origin-resource-policy")).toBe(
    "cross-origin",
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const html = await response.text();
  expect(html).toContain("Concept A v1");
  expect(html).toContain('<script src="/_bridge/v1.js"></script>');
  expect(html.indexOf("/_bridge/v1.js")).toBeLessThan(html.indexOf("<head>"));

  const bridge = await fetch(`${new URL(prefix).origin}/_bridge/v1.js`);
  expect(bridge.status).toBe(200);
  expect(bridge.headers.get("content-type")).toContain("javascript");
  expect(await bridge.text()).toContain('t:"hello"');
});

test("serves a multi-file site by relative URL and a binary as an attachment", async ({
  baseURL,
}) => {
  const app = appUrl(baseURL);
  const site = await publishFixture(app, {
    board: "smoke",
    title: "Site",
    files: fixtures.site.files,
    entryPath: "index.html",
  });
  const prefix = await contentUrlOf(app, site.versionId);
  const css = await fetch(`${prefix}app.css`);
  expect(css.status).toBe(200);
  expect(css.headers.get("content-type")).toContain("text/css");
  expect(await statusOf(`${prefix}missing.js`)).toBe(404);
  expect(await statusOf(`${prefix}../index.html`)).toBe(404);

  const binary = await publishFixture(app, {
    board: "smoke",
    title: "Data",
    files: fixtures.bin.files,
    entryPath: "data.bin",
  });
  const raw = await fetch(await contentUrlOf(app, binary.versionId));
  expect(raw.headers.get("content-disposition")).toContain("attachment");
  const artifact = await createApiClient(app).artifacts.get.query({
    id: binary.artifactId,
  });
  expect(artifact.kind).toBe("file");
});

test("answers Range requests so video can seek", async ({ baseURL }) => {
  const app = appUrl(baseURL);
  const committed = await publishFixture(app, {
    board: "smoke",
    title: "Clip",
    files: fixtures.mp4.files,
    entryPath: "clip.mp4",
  });
  const url = await contentUrlOf(app, committed.versionId);
  const expected = await Bun.file(fixtures.mp4.files[0]?.absPath ?? "").bytes();

  const whole = await fetch(url);
  expect(whole.status).toBe(200);
  expect(whole.headers.get("accept-ranges")).toBe("bytes");
  expect(whole.headers.get("content-type")).toBe("video/mp4");

  const partial = await fetch(url, { headers: { Range: "bytes=10-109" } });
  expect(partial.status).toBe(206);
  expect(partial.headers.get("content-range")).toBe(
    `bytes 10-109/${String(expected.length)}`,
  );
  expect(new Uint8Array(await partial.arrayBuffer())).toEqual(
    expected.slice(10, 110),
  );

  const tail = await fetch(url, { headers: { Range: "bytes=-20" } });
  expect(tail.status).toBe(206);
  expect(new Uint8Array(await tail.arrayBuffer())).toEqual(expected.slice(-20));

  const beyond = await fetch(url, {
    headers: { Range: `bytes=${String(expected.length)}-` },
  });
  expect(beyond.status).toBe(416);
  const head = await fetch(url, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe(String(expected.length));
});

test("keeps the app and content origins apart", async ({ baseURL }) => {
  const app = appUrl(baseURL);
  const committed = await publishFixture(app, {
    board: "smoke",
    title: "A",
    files: fixtures.htmlV1.files,
    entryPath: "index.html",
  });
  const prefix = await contentUrlOf(app, committed.versionId);
  const content = new URL(prefix).origin;

  expect(await statusOf(`${app}${new URL(prefix).pathname}`)).toBe(404);
  expect(await statusOf(`${content}/trpc/boards.list`)).toBe(404);
  expect(await statusOf(`${content}/api/uploads`, { method: "POST" })).toBe(
    404,
  );
  expect(await statusOf(prefix, { method: "POST" })).toBe(405);
  expect(await statusOf(prefix, { method: "OPTIONS" })).toBe(204);
  const appResponse = await fetch(`${app}/trpc/boards.list`);
  expect(appResponse.headers.get("access-control-allow-origin")).toBeNull();
  expect(await statusOf(`${app}/readyz`)).toBe(200);
});

test("versions a published artifact with compare-and-set", async ({
  baseURL,
}) => {
  const app = appUrl(baseURL);
  const v1 = await publishFixture(app, {
    board: "smoke",
    title: "Concept A",
    files: fixtures.htmlV1.files,
    entryPath: "index.html",
  });
  await expect(
    publishFixture(app, {
      board: "smoke",
      title: "Concept A",
      files: fixtures.htmlV2.files,
      entryPath: "index.html",
      artifactId: v1.artifactId,
      expectedCurrentVersionId: null,
    }),
  ).rejects.toThrow(/409/u);
  const v2 = await publishFixture(app, {
    board: "smoke",
    title: "Concept A",
    files: fixtures.htmlV2.files,
    entryPath: "index.html",
    artifactId: v1.artifactId,
    expectedCurrentVersionId: v1.versionId,
  });
  expect(v2.number).toBe(2);
  const api = createApiClient(app);
  const versions = await api.artifacts.versions.query({ id: v1.artifactId });
  expect(versions.map((version) => version.number)).toEqual([2, 1]);
  const board = await api.boards.get.query({ slug: "smoke" });
  expect(board.artifacts).toHaveLength(1);
  expect(Object.keys(board.index.frames)).toEqual([v1.artifactId]);
});

test("rejects a stale boards.replace with the current document in data.conflict", async ({
  baseURL,
}) => {
  const app = appUrl(baseURL);
  await publishFixture(app, {
    board: "smoke",
    title: "A",
    files: fixtures.htmlV1.files,
    entryPath: "index.html",
  });
  const api = createApiClient(app);
  const board = await api.boards.get.query({ slug: "smoke" });
  const error = await rejection(
    api.boards.replace.mutate({
      slug: "smoke",
      expectedRevision: board.board.revision - 1,
      index: board.index,
    }),
  );
  expect(error).toBeInstanceOf(TRPCClientError);
  const data = ConflictDataSchema.parse(
    error instanceof TRPCClientError ? error.data : null,
  );
  expect(data.code).toBe("CONFLICT");
  expect(data.conflict?.revision).toBe(board.board.revision);
});

test("moves a human comment from queued to handled through an agent", async ({
  baseURL,
}) => {
  const app = appUrl(baseURL);
  const agent = agentActor("Reviewer agent");
  const committed = await publishFixture(app, {
    board: "smoke",
    title: "A",
    files: fixtures.htmlV1.files,
    entryPath: "index.html",
    actor: agent,
  });
  const human = createApiClient(app);
  const bot = createApiClient(app, agent);

  const created = await human.threads.create.mutate({
    board: "smoke",
    artifactId: committed.artifactId,
    anchor: { type: "frame", x: 0.5, y: 0.25 },
    body: "Make the heading larger",
  });
  const [comment] = created.comments;
  expect(comment?.delivery?.state).toBe("queued");
  expect(comment?.editableUntil).not.toBeNull();
  expect(created.versionNumber).toBe(1);

  const edited = await human.threads.editComment.mutate({
    commentId: comment?.id ?? "",
    body: "Make the heading much larger",
  });
  expect(edited.comments[0]?.body).toBe("Make the heading much larger");

  const pending = await bot.feedback.pending.query({});
  expect(pending.deliverable).toBe(1);
  const claim = await bot.feedback.claim.mutate({});
  expect(claim.items).toHaveLength(1);
  expect(claim.items[0]?.thread.anchor).toEqual({
    type: "frame",
    x: 0.5,
    y: 0.25,
  });
  expect(claim.items[0]?.artifact?.currentVersion).toBe(1);
  expect(await deliveryOf(human, created.id)).toBe("claimed");

  await expect(
    human.threads.editComment.mutate({
      commentId: comment?.id ?? "",
      body: "too late",
    }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  const acked = await bot.feedback.ack.mutate({
    commentIds: [comment?.id ?? ""],
  });
  expect(acked.acked).toBe(1);
  const again = await bot.feedback.claim.mutate({});
  expect(again.items).toHaveLength(0);
  expect(await deliveryOf(human, created.id)).toBe("delivered");

  const replied = await bot.threads.reply.mutate({
    threadId: created.id,
    body: "Done in v2",
    resolve: true,
  });
  expect(replied.state).toBe("resolved");
  expect(replied.comments[0]?.delivery?.state).toBe("handled");
  expect(replied.comments[1]?.delivery).toBeNull();
});
