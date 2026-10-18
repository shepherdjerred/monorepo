import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyPublicStaticEntrypoint } from "./static-site-public.ts";

let scratch: string;
let expectedFile: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "static-public-proof-"));
  expectedFile = path.join(scratch, "index.html");
  await Bun.write(expectedFile, "<html>selected release</html>");
});
afterAll(async () => {
  await rm(scratch, { recursive: true });
});

function verify(body: string) {
  return verifyPublicStaticEntrypoint({
    response: new Response(body),
    expectedFile,
    expectedStatus: 200,
    signal: new AbortController().signal,
  });
}

test("accepts exact public bytes, and rejects stale HTML even with HTTP 200", async () => {
  await expect(
    verify("<html>selected release</html>"),
  ).resolves.toBeUndefined();
  await expect(verify("<html>outdated release</html>")).rejects.toThrow(
    "differs from selected archive",
  );
});

test("fails cancellation and cancels the public response stream", async () => {
  const controller = new AbortController();
  controller.abort();
  let canceled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        canceled = true;
      },
    }),
  );
  await expect(
    verifyPublicStaticEntrypoint({
      response,
      expectedFile,
      expectedStatus: 200,
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(canceled).toBe(true);
});
