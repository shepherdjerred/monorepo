import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { requiredCredentialsFor } from "#lib/credential-commands.ts";
import { artifactsCommand } from "#commands/artifacts/index.ts";
import type { Runtime } from "#commands/artifacts/runtime.ts";
import { createArtifactsClient } from "#lib/artifacts/client.ts";
import { buildSource } from "#lib/artifacts/manifest.ts";
import {
  ACTOR,
  BASE,
  controlledStream,
  feedbackItem,
  fakeService,
  IDS,
  sseResponse,
  tempDirectory,
  TrpcFailure,
} from "#test/support/artifacts.ts";

type Service = ReturnType<typeof fakeService>;

function runtimeFor(service: Service, overrides: Partial<Runtime> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const events: string[] = [];
  const runtime: Runtime = {
    io: {
      stdout: (text) => {
        out.push(text);
        events.push("stdout");
        return Promise.resolve();
      },
      stderr: (text) => {
        err.push(text);
      },
    },
    env: {},
    now: () => new Date(2026, 10, 26, 12, 0, 0),
    workspace: "/work/Monorepo",
    connect: () =>
      Promise.resolve(
        createArtifactsClient({
          baseUrl: BASE,
          actor: ACTOR,
          fetch: (input, init) => {
            const found = /\/trpc\/([\w.]+)/u.exec(String(input));
            if (found !== null) events.push(`trpc:${found[1] ?? ""}`);
            return service.fetch(input, init);
          },
        }),
      ),
    stdin: () => Promise.resolve("from stdin"),
    ...overrides,
  };
  return { runtime, out, err, events };
}

const committed = (number = 1) => ({
  artifactId: IDS.artifact,
  versionId: IDS.version,
  number,
  reviewUrl: `${BASE}/a/${IDS.artifact}?v=${String(number)}`,
  boardUrl: `${BASE}/b/concept-a`,
  deduplicated: false,
});

const UploadBodySchema = z.looseObject({
  files: z.array(z.looseObject({ sha256: z.string() })),
});
type Created = { body: z.infer<typeof UploadBodySchema> };

/** A publish-capable service that records each create request. */
function publishService(
  options: {
    conflict?: boolean;
    /** The files the artifact's current version already holds. */
    unchangedFiles?: readonly {
      path: string;
      sha256: string;
      size: number;
      mediaType: string;
    }[];
  } = {},
) {
  const created: Created[] = [];
  let artifactCounter = 0;
  const service = fakeService({
    trpc: {
      "artifacts.get": () => ({
        id: IDS.artifact,
        boardId: IDS.board,
        boardSlug: "concepts",
        title: "Concept B",
        kind: "html",
        ownerKey: "karpathy:/work/tree",
        createdAt: "2026-11-26T08:00:00.000Z",
        versionCount: 1,
        openThreadCount: 0,
        currentVersion: {
          id: IDS.version,
          artifactId: IDS.artifact,
          number: 1,
          entryPath: "index.html",
          totalBytes: 5,
          fileCount: 1,
          note: "",
          viewport: null,
          createdAt: "2026-11-26T08:00:00.000Z",
          publisher: {
            key: "claude-code:s",
            kind: "agent",
            name: "claude-code",
          },
          purged: false,
        },
        current:
          options.unchangedFiles === undefined
            ? null
            : {
                id: IDS.version,
                artifactId: IDS.artifact,
                number: 1,
                entryPath: options.unchangedFiles[0]?.path ?? "index.html",
                totalBytes: 5,
                fileCount: options.unchangedFiles.length,
                note: "",
                viewport: null,
                createdAt: "2026-11-26T08:00:00.000Z",
                publisher: {
                  key: "claude-code:s",
                  kind: "agent",
                  name: "claude-code",
                },
                purged: false,
                contentUrl: null,
                files: options.unchangedFiles.map(
                  ({ path: filePath, sha256, size, mediaType }) => ({
                    path: filePath,
                    sha256,
                    size,
                    mediaType,
                  }),
                ),
              },
      }),
    },
    http: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/uploads") {
        const body = UploadBodySchema.parse(await request.json());
        created.push({ body });
        if (options.conflict === true)
          return Response.json(
            {
              error: "stale",
              currentVersionId: "99999999-9999-4999-8999-999999999999",
            },
            { status: 409 },
          );
        return Response.json({
          uploadId: IDS.upload,
          missing: body.files.map((file) => file.sha256),
          expiresAt: "2026-11-27T00:00:00.000Z",
          deduplicated: false,
        });
      }
      if (request.method === "PUT") {
        await request.arrayBuffer();
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/commit")) {
        artifactCounter += 1;
        const artifactId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(artifactCounter).padStart(12, "0")}`;
        return Response.json({
          ...committed(),
          artifactId,
          reviewUrl: `${BASE}/a/${artifactId}?v=1`,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { service, created };
}

async function htmlFile(name = "concept-a.html", text = "<h1>A</h1>") {
  const dir = await tempDirectory();
  const file = path.join(dir, name);
  await writeFile(file, text);
  return file;
}

test("publish prints the review URL first, then the board, then the next command", async () => {
  const { service, created } = publishService();
  const { runtime, out } = runtimeFor(service);
  const file = await htmlFile();
  const code = await artifactsCommand("publish", [file], runtime);
  expect(code).toBe(0);
  const lines = out.join("").trimEnd().split("\n");
  expect(lines[0]).toBe(
    `Review: ${BASE}/a/aaaaaaaa-aaaa-4aaa-8aaa-000000000001?v=1`,
  );
  expect(lines[1]).toBe(`Board: ${BASE}/b/concept-a`);
  expect(lines[2]).toMatch(/^Next: toolkit artifacts wait/u);
  const body = created[0]?.body;
  expect(body).toMatchObject({
    board: "concept-a",
    title: "concept-a",
    kind: "html",
    entryPath: "concept-a.html",
    expectedCurrentVersionId: null,
    placement: { w: 1440, h: 900 },
  });
  expect(String(body?.["idempotencyKey"])).toMatch(/^[0-9a-f]{64}$/u);
  // The service creates the board from the slug and title in the same call.
  expect(body?.["boardTitle"]).toBe("concept-a");
  expect(service.calls.filter((call) => call.procedure !== null)).toEqual([]);
});

test("--json prints one object with the artifacts, the board, and the next command", async () => {
  const { service } = publishService();
  const { runtime, out, err } = runtimeFor(service);
  const code = await artifactsCommand(
    "publish",
    [await htmlFile(), "--board", "concepts", "--json"],
    runtime,
  );
  expect(code).toBe(0);
  expect(JSON.parse(out.join(""))).toEqual({
    artifacts: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
        version: 1,
        reviewUrl: `${BASE}/a/aaaaaaaa-aaaa-4aaa-8aaa-000000000001?v=1`,
      },
    ],
    board: { slug: "concepts", url: `${BASE}/b/concept-a` },
    deduplicated: false,
    next: "toolkit artifacts wait",
  });
  expect(err).toEqual([]);
});

test("republishing the same content sends the same idempotency key", async () => {
  const keys: string[] = [];
  for (let run = 0; run < 2; run += 1) {
    const { service, created } = publishService();
    const { runtime } = runtimeFor(service);
    await artifactsCommand(
      "publish",
      [await htmlFile(), "--board", "concepts"],
      runtime,
    );
    keys.push(String(created[0]?.body["idempotencyKey"]));
  }
  expect(keys[0]).toBe(keys[1]);
  const { service, created } = publishService();
  await artifactsCommand(
    "publish",
    [
      await htmlFile("concept-a.html", "<h1>changed</h1>"),
      "--board",
      "concepts",
    ],
    runtimeFor(service).runtime,
  );
  expect(String(created[0]?.body["idempotencyKey"])).not.toBe(keys[0]);
});

test("several paths publish one board with labels and frames placed side by side", async () => {
  const { service, created } = publishService();
  const { runtime, out } = runtimeFor(service);
  const dir = await tempDirectory();
  const files = await Promise.all(
    ["one.html", "two.html", "three.html"].map(async (name) => {
      const file = path.join(dir, name);
      await writeFile(file, `<h1>${name}</h1>`);
      return file;
    }),
  );
  const code = await artifactsCommand(
    "publish",
    [...files, "--label", "A,B", "--label", "C", "--viewport", "390x844"],
    runtime,
  );
  expect(code).toBe(0);
  expect(created.map((entry) => entry.body["title"])).toEqual([
    "A · one",
    "B · two",
    "C · three",
  ]);
  expect(new Set(created.map((entry) => entry.body["board"]))).toEqual(
    new Set(["monorepo-2026-11-26"]),
  );
  expect(created[0]?.body["placement"]).toEqual({ w: 390, h: 844 });
  expect(created[1]?.body["placement"]).toEqual({
    w: 390,
    h: 844,
    rightOf: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  });
  expect(created[2]?.body["viewport"]).toEqual({ width: 390, height: 844 });
  expect(out.join("")).toContain("(A · one v1)");
});

test("--note-file and an explicit --title reach the service", async () => {
  const { service, created } = publishService();
  const dir = await tempDirectory();
  const note = path.join(dir, "note.md");
  await writeFile(note, "Why this concept");
  await artifactsCommand(
    "publish",
    [
      await htmlFile(),
      "--board",
      "concepts",
      "--title",
      "Hero",
      "--note-file",
      note,
      "--kind",
      "markdown",
    ],
    runtimeFor(service).runtime,
  );
  expect(created[0]?.body).toMatchObject({
    title: "Hero",
    note: "Why this concept",
    kind: "markdown",
  });
});

test("--version-of builds on the current version and names the artifact's board", async () => {
  const { service, created } = publishService();
  const { runtime } = runtimeFor(service);
  const code = await artifactsCommand(
    "publish",
    [await htmlFile(), "--version-of", IDS.artifact],
    runtime,
  );
  expect(code).toBe(0);
  expect(created[0]?.body).toMatchObject({
    board: "concepts",
    title: "Concept B",
    artifactId: IDS.artifact,
    expectedCurrentVersionId: IDS.version,
  });
  expect(created[0]?.body["placement"]).toBeUndefined();
  // An existing artifact needs no board setup.
  expect(service.calls.some((call) => call.procedure === "boards.create")).toBe(
    false,
  );
});

test("a new version leaves the kind to the artifact: the service forbids changing it", async () => {
  const { service, created } = publishService();
  await artifactsCommand(
    "publish",
    [await htmlFile(), "--version-of", IDS.artifact],
    runtimeFor(service).runtime,
  );
  expect(created[0]?.body["kind"]).toBeUndefined();
});

test("republishing identical files as a new version creates nothing and says so", async () => {
  const file = await htmlFile("page.html", "<h1>same</h1>");
  const source = await buildSource(file);
  const { service, created } = publishService({ unchangedFiles: source.files });
  const { runtime, out } = runtimeFor(service);
  expect(
    await artifactsCommand(
      "publish",
      [file, "--version-of", IDS.artifact, "--json"],
      runtime,
    ),
  ).toBe(0);
  expect(created).toHaveLength(0);
  expect(JSON.parse(out.join(""))).toMatchObject({
    artifacts: [{ id: IDS.artifact, version: 1 }],
    deduplicated: true,
  });
  // A changed note is a real change: it publishes.
  const noted = publishService({ unchangedFiles: source.files });
  const dir = await tempDirectory();
  const note = path.join(dir, "note.md");
  await writeFile(note, "now with a note");
  await artifactsCommand(
    "publish",
    [file, "--version-of", IDS.artifact, "--note-file", note],
    runtimeFor(noted.service).runtime,
  );
  expect(noted.created).toHaveLength(1);
});

test("a human caller must name a board or artifact to wait", async () => {
  const { service } = waitService([claimWith([])]);
  const human = { ...ACTOR, key: "human:jerred", kind: "human" as const };
  const { runtime, err } = runtimeFor(service, {
    wait: FAST_WAIT,
    connect: () =>
      Promise.resolve(
        createArtifactsClient({
          baseUrl: BASE,
          actor: human,
          fetch: service.fetch,
        }),
      ),
  });
  expect(await artifactsCommand("wait", [], runtime)).toBe(2);
  expect(err.join("")).toContain("--board <slug> or --artifact <id>");
});

test("a stale --version-of exits 2 with the current version and the fix", async () => {
  const { service } = publishService({ conflict: true });
  const { runtime, out, err } = runtimeFor(service);
  const code = await artifactsCommand(
    "publish",
    [await htmlFile(), "--version-of", IDS.artifact],
    runtime,
  );
  expect(code).toBe(2);
  expect(out).toEqual([]);
  const message = err.join("\n");
  expect(message).toContain("99999999-9999-4999-8999-999999999999");
  expect(message).toContain(`toolkit artifacts show ${IDS.artifact}`);
  expect(message).toContain(`--version-of ${IDS.artifact}`);
});

test.each([
  [[], /Usage: toolkit artifacts publish/u],
  [["a.html", "b.html", "--title", "x"], /--title names one artifact/u],
  [["a.html", "b.html", "--label", "A"], /one label per path/u],
  [["a.html", "--viewport", "wide"], /--viewport must look like/u],
  [["a.html", "--board", "Bad Slug"], /--board must be a slug/u],
  [["a.html", "--version-of", "nope"], /--version-of must be an id/u],
  [["a.html", "b.html", "--version-of", IDS.artifact], /pass one path/u],
  [["a.html", "--idempotency-key", "short"], /--idempotency-key must be/u],
  [["a.html", "--bogus"], /Unknown option '--bogus'/u],
  [["/nonexistent/a.html"], /does not exist/u],
])("publish %j is a usage error (exit 2)", async (args, pattern) => {
  const { service } = publishService();
  const { runtime, err, out } = runtimeFor(service);
  expect(await artifactsCommand("publish", args, runtime)).toBe(2);
  expect(err.join("\n")).toMatch(pattern);
  expect(out).toEqual([]);
  expect(service.calls).toHaveLength(0);
});

test("artifacts commands never request platform credentials", () => {
  for (const command of ["publish", "wait", "reply", "list", "guide"])
    expect(requiredCredentialsFor("artifacts", command, {})).toEqual([]);
});

test("the stale-binary case: an unknown subcommand names install:local", async () => {
  const { runtime, err } = runtimeFor(fakeService());
  expect(await artifactsCommand("frobnicate", [], runtime)).toBe(2);
  expect(err.join("")).toContain("install:local");
});

test("no subcommand prints the help with the loop and exit codes", async () => {
  const { runtime, out } = runtimeFor(fakeService());
  expect(await artifactsCommand(undefined, [], runtime)).toBe(0);
  const text = out.join("");
  expect(text).toContain("publish <path...>");
  expect(text).toContain("6 wait timeout");
  expect(
    await artifactsCommand(
      "publish",
      ["--help"],
      runtimeFor(fakeService()).runtime,
    ),
  ).toBe(0);
});

test("service failures exit 2 with one line that names the fix and no secrets", async () => {
  const service = fakeService({
    http: () => new Response("forbidden", { status: 403 }),
  });
  const { runtime, err } = runtimeFor(service);
  const code = await artifactsCommand("guide", [], runtime);
  expect(code).toBe(2);
  expect(err.join("")).toContain("operatorLogins");
  expect(err.join("")).not.toMatch(/eyJ|Bearer|X-Artifacts-Actor/u);
});

// ── wait ────────────────────────────────────────────────────────────────────

const FAST_WAIT = {
  backoff: { baseMs: 5, maxMs: 20 },
  random: () => 1,
  connectGraceMs: 100,
  ackRetryMs: 1,
  pollMs: 10_000,
};

function waitService(claims: unknown[]) {
  const feed = controlledStream();
  const queue = [...claims];
  const service = fakeService({
    trpc: {
      "feedback.claim": () => {
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (next instanceof Error) throw next;
        return next;
      },
      "feedback.ack": () => ({ acked: 1 }),
    },
    http: (request) =>
      new URL(request.url).pathname === "/api/feedback/stream"
        ? sseResponse(feed.stream)
        : new Response("nope", { status: 404 }),
  });
  return { service, feed };
}

const claimWith = (items: unknown[]) => ({ items, nextDeliverableAt: null });

test("wait prints the digest, then acknowledges, then exits 0", async () => {
  const { service } = waitService([claimWith([feedbackItem()])]);
  const { runtime, out, events } = runtimeFor(service, { wait: FAST_WAIT });
  expect(await artifactsCommand("wait", [], runtime)).toBe(0);
  const text = out.join("");
  expect(text).toContain("### Concept B v1 (now v2)");
  expect(text.trimEnd().split("\n").at(-1)).toMatch(
    /^Next: hand each item to a subagent/u,
  );
  expect(
    service.calls.find((call) => call.procedure === "feedback.ack")?.input,
  ).toEqual({
    commentIds: [IDS.comment],
  });
  // Printed and flushed before it was acknowledged.
  expect(events).toEqual([
    "trpc:feedback.claim",
    "stdout",
    "trpc:feedback.ack",
  ]);
});

test("wait --json prints only {outcome, items} on stdout", async () => {
  const { service } = waitService([claimWith([feedbackItem()])]);
  const { runtime, out, err } = runtimeFor(service, { wait: FAST_WAIT });
  expect(await artifactsCommand("wait", ["--json"], runtime)).toBe(0);
  expect(out).toHaveLength(1);
  const report = z
    .looseObject({ outcome: z.string(), items: z.array(z.unknown()) })
    .parse(JSON.parse(out[0] ?? ""));
  expect(report.outcome).toBe("feedback");
  expect(report.items).toHaveLength(1);
  expect(err.join("")).toContain("Waiting for review feedback");
});

test("wait --timeout ends with exit 6 and says it is not a failure", async () => {
  const { service } = waitService([claimWith([])]);
  const { runtime, out } = runtimeFor(service, { wait: FAST_WAIT });
  expect(await artifactsCommand("wait", ["--timeout", "80ms"], runtime)).toBe(
    6,
  );
  expect(out.join("")).toMatch(/not a failure/u);
  const json = runtimeFor(waitService([claimWith([])]).service, {
    wait: FAST_WAIT,
  });
  expect(
    await artifactsCommand(
      "wait",
      ["--timeout", "80ms", "--json"],
      json.runtime,
    ),
  ).toBe(6);
  expect(JSON.parse(json.out.join(""))).toEqual({
    outcome: "timeout",
    items: [],
  });
});

test("wait exits 4 when the stream reports the scope gone", async () => {
  const { service, feed } = waitService([claimWith([])]);
  const { runtime, out } = runtimeFor(service, { wait: FAST_WAIT });
  const running = artifactsCommand("wait", ["--board", "old-board"], runtime);
  feed.send({ type: "gone" });
  expect(await running).toBe(4);
  expect(out.join("")).toMatch(/archived, expired, or deleted/u);
});

test("wait exits 4 when a named board no longer exists", async () => {
  const { service } = waitService([
    new TrpcFailure("NOT_FOUND", 404, "No such board"),
  ]);
  const { runtime } = runtimeFor(service, { wait: FAST_WAIT });
  expect(
    await artifactsCommand("wait", ["--board", "old-board", "--json"], runtime),
  ).toBe(4);
});

test("a bare wait claims the default scope; --board and --artifact narrow it", async () => {
  const bare = waitService([claimWith([feedbackItem()])]);
  await artifactsCommand(
    "wait",
    [],
    runtimeFor(bare.service, { wait: FAST_WAIT }).runtime,
  );
  expect(
    bare.service.calls.find((call) => call.procedure === "feedback.claim")
      ?.input,
  ).toEqual({});
  expect(
    bare.service.calls.find((call) =>
      call.path.startsWith("/api/feedback/stream"),
    )?.path,
  ).toBe("/api/feedback/stream");

  const board = waitService([claimWith([feedbackItem()])]);
  await artifactsCommand(
    "wait",
    ["--board", "concepts"],
    runtimeFor(board.service, { wait: FAST_WAIT }).runtime,
  );
  expect(
    board.service.calls.find((call) => call.procedure === "feedback.claim")
      ?.input,
  ).toEqual({
    scope: { type: "board", board: "concepts" },
  });
  expect(
    board.service.calls.some(
      (call) => call.path === "/api/feedback/stream?board=concepts",
    ),
  ).toBe(true);

  const artifact = waitService([claimWith([feedbackItem()])]);
  await artifactsCommand(
    "wait",
    ["--artifact", IDS.artifact],
    runtimeFor(artifact.service, { wait: FAST_WAIT }).runtime,
  );
  expect(
    artifact.service.calls.find((call) => call.procedure === "feedback.claim")
      ?.input,
  ).toEqual({
    scope: { type: "artifact", artifactId: IDS.artifact },
  });
});

test.each([
  [["--board", "a", "--artifact", IDS.artifact], /not both/u],
  [["--artifact", "nope"], /--artifact must be an id/u],
  [["--board", "Bad Slug"], /--board must be a board slug/u],
  [["--timeout", "soon"], /--timeout requires a duration/u],
  [["extra"], /takes no arguments/u],
])("wait %j is a usage error (exit 2)", async (args, pattern) => {
  const { runtime, err } = runtimeFor(waitService([claimWith([])]).service, {
    wait: FAST_WAIT,
  });
  expect(await artifactsCommand("wait", args, runtime)).toBe(2);
  expect(err.join("\n")).toMatch(pattern);
});

test("inside Claude Code, wait tells the agent how to hold it", async () => {
  const { service } = waitService([claimWith([feedbackItem()])]);
  const { runtime, err } = runtimeFor(service, {
    wait: FAST_WAIT,
    env: { CLAUDECODE: "1" },
  });
  await artifactsCommand("wait", [], runtime);
  expect(err.join("\n")).toContain("run_in_background");
});

test("SIGINT and SIGTERM end a wait with 130 and 143", async () => {
  for (const [code, expected] of [
    [130, 130],
    [143, 143],
  ] as const) {
    const { service } = waitService([claimWith([])]);
    const controller = new AbortController();
    const { runtime } = runtimeFor(service, {
      wait: FAST_WAIT,
      signal: controller.signal,
      interruptExit: () => code,
    });
    const running = artifactsCommand("wait", [], runtime);
    await new Promise((resolve) => setTimeout(resolve, 40));
    controller.abort();
    expect(await running).toBe(expected);
  }
});

test("an unreachable service at the start of a wait is exit 2 with the tailnet check", async () => {
  const { runtime, err, out } = runtimeFor(fakeService(), {
    wait: FAST_WAIT,
    connect: () =>
      Promise.resolve(
        createArtifactsClient({
          baseUrl: BASE,
          actor: ACTOR,
          fetch: () => Promise.reject(new TypeError("Unable to connect")),
        }),
      ),
  });
  expect(await artifactsCommand("wait", [], runtime)).toBe(2);
  expect(err.join("\n")).toContain("tailscale status");
  expect(out).toEqual([]);
});

// ── reply, resolve, reads ───────────────────────────────────────────────────

const thread = (state: "open" | "resolved") => ({
  id: IDS.thread,
  boardId: IDS.board,
  artifactId: IDS.artifact,
  versionId: IDS.version,
  versionNumber: 1,
  anchor: { type: "frame", x: 0.5, y: 0.5 },
  state,
  createdAt: "2026-11-26T09:00:00.000Z",
  resolvedAt: state === "resolved" ? "2026-11-26T11:00:00.000Z" : null,
  comments: [
    {
      id: IDS.comment,
      body: "Looks tight",
      author: { key: "human:jerred", kind: "human", name: "Jerred" },
      createdAt: "2026-11-26T09:00:00.000Z",
      updatedAt: "2026-11-26T09:00:00.000Z",
      delivery: {
        state: "delivered",
        actor: null,
        claimedAt: null,
        handledAt: null,
        attempts: 1,
      },
      editableUntil: null,
    },
  ],
});

test("reply sends the body and --resolve in one call", async () => {
  const service = fakeService({
    trpc: {
      "threads.reply": (input) => ({ ...thread("resolved"), echoed: input }),
    },
  });
  const dir = await tempDirectory();
  const body = path.join(dir, "reply.md");
  await writeFile(body, "  Fixed in v2.\n");
  const { runtime, out } = runtimeFor(service);
  expect(
    await artifactsCommand(
      "reply",
      [IDS.thread, "--body-file", body, "--resolve"],
      runtime,
    ),
  ).toBe(0);
  expect(service.calls[0]?.input).toEqual({
    threadId: IDS.thread,
    body: "Fixed in v2.",
    resolve: true,
  });
  expect(out.join("")).toBe(
    `Replied to thread ${IDS.thread} and resolved it.\n`,
  );
});

test("reply reads stdin for --body-file - and rejects empty or missing bodies", async () => {
  const service = fakeService({
    trpc: { "threads.reply": () => thread("open") },
  });
  const { runtime } = runtimeFor(service);
  expect(
    await artifactsCommand("reply", [IDS.thread, "--body-file", "-"], runtime),
  ).toBe(0);
  expect(service.calls[0]?.input).toMatchObject({
    body: "from stdin",
    resolve: false,
  });
  const empty = runtimeFor(service, { stdin: () => Promise.resolve("  \n") });
  expect(
    await artifactsCommand(
      "reply",
      [IDS.thread, "--body-file", "-"],
      empty.runtime,
    ),
  ).toBe(2);
  expect(empty.err.join("")).toContain("empty");
  const missing = runtimeFor(service);
  expect(await artifactsCommand("reply", [IDS.thread], missing.runtime)).toBe(
    2,
  );
  expect(
    await artifactsCommand(
      "reply",
      ["nope", "--body-file", "-"],
      missing.runtime,
    ),
  ).toBe(2);
  expect(
    await artifactsCommand(
      "reply",
      [IDS.thread, "--body-file", "/nonexistent"],
      missing.runtime,
    ),
  ).toBe(2);
});

test("resolve closes a thread", async () => {
  const service = fakeService({
    trpc: { "threads.resolve": () => thread("resolved") },
  });
  const { runtime, out } = runtimeFor(service);
  expect(await artifactsCommand("resolve", [IDS.thread], runtime)).toBe(0);
  expect(out.join("")).toBe(`Resolved thread ${IDS.thread}.\n`);
  expect(service.calls[0]?.input).toEqual({ threadId: IDS.thread });
});

const summary = {
  id: IDS.artifact,
  boardId: IDS.board,
  boardSlug: "concepts",
  title: "Concept B",
  kind: "html",
  ownerKey: "karpathy:/work/tree",
  createdAt: "2026-11-26T08:00:00.000Z",
  versionCount: 2,
  openThreadCount: 1,
  currentVersion: null,
};

test("list, boards, and show render tables, JSON, and redact content tokens", async () => {
  const token = "t0ken".repeat(5);
  const service = fakeService({
    trpc: {
      "artifacts.list": () => [summary],
      "boards.list": () => [
        {
          id: IDS.board,
          slug: "concepts",
          title: "Concepts",
          revision: 1,
          keep: false,
          createdAt: "2026-11-26T08:00:00.000Z",
          lastActivityAt: "2026-11-26T09:30:00.000Z",
          archivedAt: null,
          expiredAt: null,
          expiresAt: "2027-02-24T09:30:00.000Z",
          artifactCount: 2,
          totalBytes: 3 * 1024 * 1024,
        },
      ],
      "artifacts.get": () => ({
        ...summary,
        current: {
          id: IDS.version,
          contentUrl: `https://content.test/_t/${token}/`,
          files: [],
        },
      }),
      "artifacts.versions": () => [
        {
          id: IDS.version,
          artifactId: IDS.artifact,
          number: 1,
          entryPath: "index.html",
          totalBytes: 2048,
          fileCount: 2,
          note: "",
          viewport: null,
          createdAt: "2026-11-26T08:00:00.000Z",
          publisher: {
            key: "claude-code:s",
            kind: "agent",
            name: "claude-code",
          },
          purged: false,
        },
      ],
      "threads.list": () => [thread("open")],
      "boards.get": () => ({
        board: { slug: "concepts", title: "Concepts", revision: 4 },
        index: { notes: { n1: { type: "sticky", text: "hi" } } },
        artifacts: [],
      }),
    },
  });
  const list = runtimeFor(service);
  expect(
    await artifactsCommand("list", ["--board", "concepts"], list.runtime),
  ).toBe(0);
  expect(list.out.join("")).toMatch(/ID\s+BOARD\s+KIND[\s\S]*Concept B/u);
  expect(service.calls[0]?.input).toEqual({ board: "concepts", limit: 200 });

  const boards = runtimeFor(service);
  expect(await artifactsCommand("boards", [], boards.runtime)).toBe(0);
  expect(boards.out.join("")).toMatch(/concepts\s+2\s+3\.0 MiB/u);

  const show = runtimeFor(service);
  expect(await artifactsCommand("show", [IDS.artifact], show.runtime)).toBe(0);
  const text = show.out.join("");
  expect(text).toContain(`Review: ${BASE}/a/${IDS.artifact}`);
  expect(text).toContain("v1  2026-11-26 08:00  claude-code  2 files");
  expect(text).toContain(
    `[open] thread ${IDS.thread} on v1 · frame at 50% across, 50% down`,
  );
  expect(text).toContain("Jerred (2026-11-26 09:00) [delivered]:");

  const json = runtimeFor(service);
  expect(
    await artifactsCommand("show", [IDS.artifact, "--json"], json.runtime),
  ).toBe(0);
  const raw = json.out.join("");
  expect(raw).not.toContain(token);
  const parsed = z
    .looseObject({
      board: z.looseObject({ notes: z.unknown() }),
      threads: z.array(z.unknown()),
    })
    .parse(JSON.parse(raw));
  expect(parsed.board.notes).toEqual({ n1: { type: "sticky", text: "hi" } });
  expect(parsed.threads).toHaveLength(1);
  expect(raw).toContain("/_t/[redacted]/");
});

test("guide prints the skill or a named reference and explains a missing one", async () => {
  const service = fakeService({
    http: (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/agent/SKILL.md")
        return new Response("# Artifacts skill\n");
      return pathname === "/agent/reference/publishing.md"
        ? new Response("# Publishing\n")
        : new Response("", { status: 404 });
    },
  });
  const skill = runtimeFor(service);
  expect(await artifactsCommand("guide", [], skill.runtime)).toBe(0);
  expect(skill.out.join("")).toBe("# Artifacts skill\n");
  const reference = runtimeFor(service);
  expect(
    await artifactsCommand("guide", ["publishing.md"], reference.runtime),
  ).toBe(0);
  expect(reference.out.join("")).toBe("# Publishing\n");
  const missing = runtimeFor(service);
  expect(await artifactsCommand("guide", ["nope"], missing.runtime)).toBe(2);
  expect(missing.err.join("")).toContain("No guide named nope");
  const bad = runtimeFor(service);
  expect(await artifactsCommand("guide", ["../etc/passwd"], bad.runtime)).toBe(
    2,
  );
});
