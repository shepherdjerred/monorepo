import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createS3Client } from "#src/storage/s3-client.ts";
import { publishReplayObject } from "./storage.ts";

test.each([
  { name: "new object", put: 200 },
  { name: "matching existing object", put: 412 },
  { name: "gzip-encoded public object", put: 200, gzip: true },
  {
    name: "corrupt stored object",
    put: 200,
    storage: "wrong",
    error: "Stored replay object",
  },
  {
    name: "missing object after uncertain write",
    put: 500,
    storage: null,
    error: "missing",
  },
  {
    name: "oversized served object",
    put: 200,
    publicBody: "larger",
    error: "exceeds its expected length",
  },
  {
    name: "non-JavaScript served object",
    put: 200,
    mime: "text/html",
    error: "invalid immutable cache or MIME",
  },
  {
    name: "mutable serving response",
    put: 200,
    cache: "public, max-age=31536000, immutable, no-cache",
    error: "invalid immutable cache or MIME",
  },
  {
    name: "same-length public corruption",
    put: 200,
    publicBody: "wrong",
    error: "Public replay object length or SHA-256",
  },
  {
    name: "redirected public object",
    put: 200,
    redirect: true,
    error: "fetch()",
  },
])(
  "verifies replay object publication and readback for $name",
  async (scenario) => {
    const key = "replay-assets/16.21.829.8620/fixture/engine.mjs";
    const source = "hello";
    const directory = await mkdtemp(
      path.join(tmpdir(), "scout-replay-publication-"),
    );
    const inputPath = path.join(directory, "engine.mjs");
    await writeFile(inputPath, source);
    const seen: string[] = [];
    const served = scenario.publicBody ?? source;
    const gzip = scenario.gzip === true;
    const responseBody = gzip ? Bun.gzipSync(served) : served;
    const responseHeaders = {
      ...(gzip ? { "Content-Encoding": "gzip" } : {}),
      "Cache-Control": scenario.cache ?? "public, max-age=31536000, immutable",
      "Content-Type": scenario.mime ?? "text/javascript; charset=utf-8",
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === `/fixture/${key}`) {
          if (request.method === "PUT") {
            seen.push(
              `put:${request.headers.get("If-None-Match") ?? "missing"}`,
            );
            expect(await request.text()).toBe(source);
            return scenario.put === 200
              ? new Response(null)
              : new Response(
                  `<Error><Code>${scenario.put === 412 ? "PreconditionFailed" : "InternalError"}</Code></Error>`,
                  {
                    status: scenario.put,
                    headers: { "Content-Type": "application/xml" },
                  },
                );
          }
          seen.push("stored");
          return scenario.storage === null
            ? new Response(
                "<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>",
                { status: 404 },
              )
            : new Response(scenario.storage ?? source);
        }
        if (pathname !== `/${key}`) return new Response(null, { status: 404 });
        seen.push("public");
        return scenario.redirect === true
          ? Response.redirect(new URL("/redirect", request.url).toString())
          : new Response(responseBody, { headers: responseHeaders });
      },
    });
    const client = createS3Client({
      endpoint: server.url.toString(),
      region: "us-east-1",
      credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
    });
    try {
      const publication = publishReplayObject({
        client,
        bucket: "fixture",
        origin: server.url,
        object: {
          key,
          path: inputPath,
          bytes: source.length,
          sha256: new Bun.CryptoHasher("sha256").update(source).digest("hex"),
          contentType: "application/javascript",
        },
      });
      if (scenario.error === undefined) {
        await publication;
        expect(seen).toEqual(["put:*", "stored", "public"]);
      } else {
        await expect(publication).rejects.toThrow(scenario.error);
        expect(seen[0]).toBe("put:*");
        if (scenario.storage !== undefined)
          expect(seen).not.toContain("public");
      }
    } finally {
      client.destroy();
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
