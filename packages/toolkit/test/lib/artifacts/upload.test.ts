import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { ArtifactsCliError } from "#lib/artifacts/errors.ts";
import { buildSource } from "#lib/artifacts/manifest.ts";
import {
  idempotencyKey,
  PublishConflictError,
  uploadVersion,
  type UploadParams,
} from "#lib/artifacts/upload.ts";
import {
  BASE,
  fakeService,
  IDS,
  tempDirectory,
} from "#test/support/artifacts.ts";

const params = (overrides: Partial<UploadParams> = {}): UploadParams => ({
  board: "concepts",
  title: "Concept A",
  kind: "html",
  expectedCurrentVersionId: null,
  idempotencyKey: "a".repeat(64),
  ...overrides,
});

const committed = {
  artifactId: IDS.artifact,
  versionId: IDS.version,
  number: 1,
  reviewUrl: `${BASE}/a/${IDS.artifact}?v=1`,
  boardUrl: `${BASE}/b/concepts`,
};

async function site() {
  const dir = await tempDirectory();
  await writeFile(path.join(dir, "index.html"), "<h1>hello</h1>");
  await writeFile(path.join(dir, "app.js"), "console.log(1)");
  return buildSource(dir);
}

test("the idempotency key is stable and sensitive to each input", () => {
  const base = {
    workspaceKey: "karpathy:/work/tree",
    board: "concepts",
    target: "new:Concept A",
    digest: "d".repeat(64),
  };
  expect(idempotencyKey(base)).toBe(idempotencyKey({ ...base }));
  expect(idempotencyKey(base)).toMatch(/^[\w-]{16,128}$/u);
  for (const change of [
    { workspaceKey: "macbook:/work/tree" },
    { board: "other" },
    { target: IDS.artifact },
    { digest: "e".repeat(64) },
  ])
    expect(idempotencyKey({ ...base, ...change })).not.toBe(
      idempotencyKey(base),
    );
  // Field boundaries cannot be forged by moving text between fields.
  expect(idempotencyKey({ ...base, board: "ab", target: "c" })).not.toBe(
    idempotencyKey({ ...base, board: "a", target: "bc" }),
  );
});

test("only the blobs the service lacks are sent, then the upload is committed", async () => {
  const source = await site();
  const wanted = source.files.find((file) => file.path === "app.js");
  const puts: { path: string; length: string | null; body: string }[] = [];
  const service = fakeService({
    http: async (request) => {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/api/uploads") {
        const body = z
          .looseObject({ files: z.array(z.unknown()), entryPath: z.string() })
          .parse(await request.json());
        expect(body.entryPath).toBe("index.html");
        expect(body.files).toHaveLength(2);
        return Response.json({
          uploadId: IDS.upload,
          missing: [wanted?.sha256],
          expiresAt: "2026-11-27T00:00:00.000Z",
        });
      }
      if (request.method === "PUT") {
        puts.push({
          path: url.pathname,
          length: request.headers.get("content-length"),
          body: await request.text(),
        });
        return new Response(null, { status: 204 });
      }
      return url.pathname === `/api/uploads/${IDS.upload}/commit`
        ? Response.json(committed)
        : new Response("nope", { status: 404 });
    },
  });
  const result = await uploadVersion(service.client(), source, params());
  expect(result).toEqual({ ...committed, deduplicated: false });
  expect(puts).toEqual([
    {
      path: `/api/uploads/${IDS.upload}/blobs/${wanted?.sha256 ?? ""}`,
      length: String(wanted?.size),
      body: "console.log(1)",
    },
  ]);
  // Every call carries the actor header, never a bearer token.
  for (const call of service.calls) {
    expect(call.headers.get("x-artifacts-actor")).not.toBeNull();
    expect(call.headers.get("authorization")).toBeNull();
  }
});

test("a replayed commit reports deduplicated and sends nothing", async () => {
  const source = await site();
  const service = fakeService({
    http: (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/uploads")
        return Response.json({
          uploadId: IDS.upload,
          missing: [],
          expiresAt: "2026-11-27T00:00:00.000Z",
        });
      return Response.json({ ...committed, deduplicated: true });
    },
  });
  const result = await uploadVersion(service.client(), source, params());
  expect(result.deduplicated).toBe(true);
  expect(service.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
});

test("a commit that still misses blobs re-sends them and commits again", async () => {
  const source = await site();
  const entry = source.files.find((file) => file.path === "index.html");
  let commits = 0;
  const puts: string[] = [];
  const service = fakeService({
    http: (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/uploads")
        return Response.json({
          uploadId: IDS.upload,
          missing: [],
          expiresAt: "2026-11-27T00:00:00.000Z",
        });
      if (request.method === "PUT") {
        puts.push(url.pathname);
        return new Response(null, { status: 204 });
      }
      commits += 1;
      return commits === 1
        ? Response.json(
            { error: "missing blobs", missing: [entry?.sha256] },
            { status: 409 },
          )
        : Response.json(committed);
    },
  });
  await uploadVersion(service.client(), source, params());
  expect(commits).toBe(2);
  expect(puts).toEqual([
    `/api/uploads/${IDS.upload}/blobs/${entry?.sha256 ?? ""}`,
  ]);
});

test("a stale expectedCurrentVersionId becomes a conflict naming the current version", async () => {
  const source = await site();
  const service = fakeService({
    http: (request) =>
      new URL(request.url).pathname === "/api/uploads"
        ? Response.json(
            { error: "stale", currentVersionId: IDS.version },
            { status: 409 },
          )
        : new Response("unexpected", { status: 500 }),
  });
  const failure = await uploadVersion(service.client(), source, params()).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(PublishConflictError);
  expect(failure).toMatchObject({ currentVersionId: IDS.version, exitCode: 2 });
  expect(failure instanceof Error ? failure.message : "").toContain(
    IDS.version,
  );
});

test("transient failures are retried and permanent ones are not", async () => {
  const source = await site();
  let creates = 0;
  const flaky = fakeService({
    http: (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/uploads") {
        creates += 1;
        return creates < 3
          ? new Response("bad gateway", { status: 502 })
          : Response.json({
              uploadId: IDS.upload,
              missing: [],
              expiresAt: "2026-11-27T00:00:00.000Z",
            });
      }
      return Response.json(committed);
    },
  });
  await uploadVersion(flaky.client(), source, params(), {
    sleep: () => Promise.resolve(),
  });
  expect(creates).toBe(3);

  const refused = fakeService({
    http: () => new Response("forbidden", { status: 403 }),
  });
  await expect(
    uploadVersion(refused.client(), source, params(), {
      sleep: () => Promise.resolve(),
    }),
  ).rejects.toThrow(/operatorLogins/u);
  expect(refused.calls).toHaveLength(1);
});

test("an invalid request is a usage error before any network call", async () => {
  const source = await site();
  const service = fakeService();
  await expect(
    uploadVersion(service.client(), source, params({ board: "Not A Slug" })),
  ).rejects.toThrow(ArtifactsCliError);
  expect(service.calls).toHaveLength(0);
});

test("an unreachable service names the tailnet check", async () => {
  const source = await site();
  const { createArtifactsClient } = await import("#lib/artifacts/client.ts");
  const client = createArtifactsClient({
    baseUrl: BASE,
    actor: null,
    fetch: () => Promise.reject(new TypeError("Unable to connect")),
  });
  await expect(
    uploadVersion(client, source, params(), { attempts: 1 }),
  ).rejects.toThrow(/tailscale status/u);
});
