import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  archiveObjectExists,
  buildArchiveKey,
  readArchiveObject,
  uploadArchive,
  type ArchiveConfig,
} from "#src/archive-uploader.ts";

const config: ArchiveConfig = {
  bucket: "llm-archive",
  prefix: "llm",
  region: "us-east-1",
  endpoint: "http://localhost:9000",
  accessKeyId: "key",
  secretAccessKey: "secret",
  sessionToken: undefined,
  forcePathStyle: true,
};

test("buildArchiveKey produces a deterministic, date-prefixed path", () => {
  const key = buildArchiveKey(config, {
    service: "temporal",
    provider: "anthropic",
    traceId: "0123456789abcdef0123456789abcdef",
    spanId: "fedcba9876543210",
    date: new Date("2026-05-19T15:30:00.000Z"),
  });
  expect(key).toBe(
    "llm/temporal/anthropic/2026/05/19/0123456789abcdef0123456789abcdef-fedcba9876543210.json.gz",
  );
});

test("buildArchiveKey honours the configured prefix", () => {
  const key = buildArchiveKey(
    { ...config, prefix: "custom/path" },
    {
      service: "birmel",
      provider: "claude_code_sdk",
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      spanId: "bbbbbbbbbbbbbbbb",
      date: new Date("2026-01-02T00:00:00.000Z"),
    },
  );
  expect(key).toBe(
    "custom/path/birmel/claude_code_sdk/2026/01/02/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb.json.gz",
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requireRequest(input: unknown): Request {
  if (!(input instanceof Request)) {
    throw new TypeError("Expected fetch to receive a Request");
  }
  return input;
}

describe("archive S3 wrappers", () => {
  test("uploads a gzip body and retains best-effort failure semantics", async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        requests.push(requireRequest(input));
        return new Response("storage unavailable", { status: 503 });
      }),
    );

    const result = await uploadArchive(
      config,
      "archive/object.json.gz",
      '{"ok":true}',
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("S3 upload failed (503): storage unavailable");
    const request = requests[0];
    if (request === undefined) throw new Error("Expected one S3 request");
    expect(request.method).toBe("PUT");
    expect(request.headers.get("content-type")).toBe("application/gzip");
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(
      gunzipSync(Buffer.from(await request.arrayBuffer())).toString(),
    ).toBe('{"ok":true}');
  });

  test.each([
    { status: 200, expected: true },
    { status: 404, expected: false },
  ])("maps HEAD status $status to $expected", async ({ status, expected }) => {
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        requests.push(requireRequest(input));
        return new Response(undefined, { status });
      }),
    );

    await expect(
      archiveObjectExists(config, "archive/object.json.gz"),
    ).resolves.toBe(expected);
    expect(requests[0]?.method).toBe("HEAD");
  });

  test("rejects HEAD storage failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(undefined, { status: 500, statusText: "Server Error" }),
      ),
    );

    await expect(
      archiveObjectExists(config, "archive/object.json.gz"),
    ).rejects.toThrow("S3 archive existence check failed (500): Server Error");
  });

  test("downloads and decompresses archive objects", async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        requests.push(requireRequest(input));
        return new Response(gzipSync('{"stored":true}'), { status: 200 });
      }),
    );

    await expect(
      readArchiveObject(config, "archive/object.json.gz"),
    ).resolves.toBe('{"stored":true}');
    expect(requests[0]?.method).toBe("GET");
  });

  test("returns undefined for missing archive objects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(undefined, { status: 404 })),
    );

    await expect(
      readArchiveObject(config, "missing.json.gz"),
    ).resolves.toBeUndefined();
  });
});
