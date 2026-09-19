import { expect, test } from "vitest";
import {
  CI_HANDOFF_BUCKET,
  CI_HANDOFF_REGION,
  handoffObjectKey,
  readOptionalHandoff,
  readRequiredHandoff,
  writeJsonHandoff,
  type CiHandoffConfig,
} from "./ci-handoff.ts";
import { parseHandoffPayload } from "../../ci/write-ci-handoff.ts";

const CONFIG: CiHandoffConfig = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  endpoint: "https://seaweedfs-s3.example.com",
  bucket: CI_HANDOFF_BUCKET,
  region: CI_HANDOFF_REGION,
  pipelineNumber: "4218",
};

test("scopes a handoff object to its pipeline", () => {
  expect(handoffObjectKey("4218", "image-digests")).toBe(
    "4218/image-digests.json",
  );
});

test("rejects a key that would escape its pipeline prefix", () => {
  expect(() => handoffObjectKey("4218", "../4217/image-digests")).toThrow(
    /invalid CI handoff key/u,
  );
});

test("rejects a non-numeric pipeline number", () => {
  expect(() => handoffObjectKey("main", "image-digests")).toThrow(
    /invalid CI handoff pipeline number/u,
  );
});

type RecordedRequest = {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly body: string;
};

test("publishes a handoff as a signed PUT with a trailing newline", async () => {
  const seen: RecordedRequest[] = [];
  await writeJsonHandoff(
    "image-digests",
    { scout: "sha256:abc" },
    CONFIG,
    async (request) => {
      seen.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      });
      return new Response("", { status: 200 });
    },
  );
  const [recorded] = seen;
  expect(recorded).toBeDefined();
  if (recorded === undefined) return;
  expect(recorded.method).toBe("PUT");
  expect(recorded.url).toBe(
    "https://seaweedfs-s3.example.com/ci-handoff/4218/image-digests.json",
  );
  expect(recorded.authorization).toContain("AWS4-HMAC-SHA256");
  expect(recorded.body).toBe('{"scout":"sha256:abc"}\n');
});

test("returns the stored body verbatim", async () => {
  const body = await readRequiredHandoff(
    "version-catalog",
    CONFIG,
    async () => new Response('{"a":1}\n', { status: 200 }),
  );
  expect(body).toBe('{"a":1}\n');
});

/**
 * The load-bearing contract: an absent handoff must fail the build rather than
 * read as "the producer had nothing to hand off", which would deploy nothing
 * and go green.
 */
test("fails loudly when the producing step never published", async () => {
  await expect(
    readRequiredHandoff(
      "image-digests",
      CONFIG,
      async () => new Response("", { status: 404 }),
    ),
  ).rejects.toThrow(/required CI handoff image-digests is missing \(404\)/u);
});

test("fails loudly when publishing is rejected", async () => {
  await expect(
    writeJsonHandoff(
      "image-digests",
      {},
      CONFIG,
      async () => new Response("denied", { status: 403 }),
    ),
  ).rejects.toThrow(/could not publish CI handoff image-digests \(403\)/u);
});

test("rejects an empty payload rather than publishing nothing", () => {
  expect(() => parseHandoffPayload("  \n", "image-digests")).toThrow(
    /refusing to publish an empty CI handoff for image-digests/u,
  );
});

test("rejects malformed JSON in the producing step", () => {
  expect(() => parseHandoffPayload("{not json", "pin-candidates")).toThrow(
    /CI handoff pin-candidates is not valid JSON/u,
  );
});

test("accepts a well-formed document", () => {
  expect(parseHandoffPayload('{"a":1}\n', "version-catalog")).toEqual({ a: 1 });
});

test("an optional read returns undefined when nothing was published", async () => {
  const value = await readOptionalHandoff(
    "scout-release-state",
    CONFIG,
    async () => new Response("", { status: 404 }),
  );
  expect(value).toBeUndefined();
});

/** A credential problem must never read as "nothing to do". */
test("an optional read still fails on a non-404 error", async () => {
  await expect(
    readOptionalHandoff(
      "scout-release-state",
      CONFIG,
      async () => new Response("denied", { status: 403 }),
    ),
  ).rejects.toThrow(/could not read CI handoff scout-release-state \(403\)/u);
});
