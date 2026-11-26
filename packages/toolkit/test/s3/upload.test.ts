import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { contentTypeForFile } from "#lib/s3/assets.ts";
import type { ObjectStore } from "#lib/s3/object-store.ts";
import {
  IMMUTABLE_CACHE_CONTROL,
  MULTIPART_THRESHOLD_BYTES,
  planDirectoryObjects,
  planFileObjects,
  type PlannedUpload,
  uploadObject,
  walkDirectoryFiles,
} from "#lib/s3/upload.ts";

type Sent = { name: string; input: Record<string, unknown> };

/** Records every call; `failOnPart` makes that part number reject. */
function fakeStore(failOnPart?: number): { store: ObjectStore; sent: Sent[] } {
  const sent: Sent[] = [];
  const store: ObjectStore = {
    put: (params) => {
      sent.push({ name: "put", input: params });
      return Promise.resolve();
    },
    createMultipart: (params) => {
      sent.push({ name: "create", input: params });
      return Promise.resolve("upload-1");
    },
    uploadPart: (params) => {
      sent.push({ name: "part", input: params });
      return params.partNumber === failOnPart
        ? Promise.reject(new Error("part failed"))
        : Promise.resolve(`etag-${String(params.partNumber)}`);
    },
    completeMultipart: (params) => {
      sent.push({ name: "complete", input: params });
      return Promise.resolve();
    },
    abortMultipart: (params) => {
      sent.push({ name: "abort", input: params });
      return Promise.resolve();
    },
  };
  return { store, sent };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "upload-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("content types", () => {
  test.each([
    ["clip.webm", "video/webm"],
    ["clip.mov", "video/quicktime"],
    ["module.wasm", "application/wasm"],
    ["font.woff2", "font/woff2"],
    ["bundle.mjs", "text/javascript; charset=utf-8"],
    ["bundle.js.map", "application/json"],
    ["photo.avif", "image/avif"],
    ["demo.cast", "application/x-asciicast"],
    ["notes.md", "text/markdown; charset=utf-8"],
    ["data.csv", "text/csv; charset=utf-8"],
    ["UPPER.PNG", "image/png"],
    ["mystery.bin", "application/octet-stream"],
  ])("%s is %s", (name, expected) => {
    expect(contentTypeForFile(name)).toBe(expected);
  });
});

describe("walkDirectoryFiles", () => {
  test("lists nested files sorted and skips dotfiles", async () => {
    await mkdir(path.join(dir, "a", ".hidden"), { recursive: true });
    await writeFile(path.join(dir, "b.txt"), "b");
    await writeFile(path.join(dir, "a", "z.txt"), "z");
    await writeFile(path.join(dir, ".DS_Store"), "x");
    await writeFile(path.join(dir, "a", ".hidden", "secret.txt"), "x");
    expect(await walkDirectoryFiles(dir)).toEqual(["a/z.txt", "b.txt"]);
  });
});

describe("planning", () => {
  test("a cast plans the recording, player page, and GIF under the stored name", () => {
    const planned = planFileObjects(
      "/rec/demo.cast",
      "p/x/renamed.cast",
      "/g/0.gif",
    );
    expect(planned.uploads.map((upload) => upload.key)).toEqual([
      "p/x/renamed.cast",
      "p/x/renamed.cast.html",
      "p/x/renamed.cast.gif",
    ]);
    expect(planned.primaryKey).toBe("p/x/renamed.cast.html");
    expect(planned.gifKey).toBe("p/x/renamed.cast.gif");
    expect(planned.gifRenders).toEqual([
      { castPath: "/rec/demo.cast", gifPath: "/g/0.gif" },
    ]);
  });

  test("the player page fetches the recording by its stored name", async () => {
    const planned = planFileObjects(
      "/rec/demo.cast",
      "p/x/renamed.cast",
      "/g/0.gif",
    );
    const html = new TextDecoder().decode(await planned.uploads[1]?.body());
    expect(html).toContain('"./renamed.cast"');
  });

  test("a plain file plans one object", () => {
    const planned = planFileObjects("/a/b.png", "p/x/b.png", "/g/0.gif");
    expect(planned.uploads).toHaveLength(1);
    expect(planned.uploads[0]).toMatchObject({
      key: "p/x/b.png",
      contentType: "image/png",
      localPath: "/a/b.png",
    });
    expect(planned.primaryKey).toBe("p/x/b.png");
    expect(planned.gifKey).toBeUndefined();
  });

  test("a directory plans one object per file", () => {
    const uploads = planDirectoryObjects(
      "/site",
      ["a.html", "css/s.css"],
      (r) => `k/${r}`,
    );
    expect(
      uploads.map(({ key, contentType }) => ({ key, contentType })),
    ).toEqual([
      { key: "k/a.html", contentType: "text/html; charset=utf-8" },
      { key: "k/css/s.css", contentType: "text/css; charset=utf-8" },
    ]);
  });
});

function uploadAt(file: string, key: string, index = 0): PlannedUpload {
  const upload = planFileObjects(file, key, "/unused.gif").uploads[index];
  if (upload === undefined) throw new Error("no planned upload");
  return upload;
}

describe("uploadObject", () => {
  test("the multipart threshold is 16 MiB", () => {
    expect(MULTIPART_THRESHOLD_BYTES).toBe(16 * 1024 * 1024);
  });

  test("a small file is one put carrying Cache-Control", async () => {
    const file = path.join(dir, "a.txt");
    await writeFile(file, "hello");
    const { store, sent } = fakeStore();
    const bytes = await uploadObject(
      store,
      "bucket",
      uploadAt(file, "k/a.txt"),
      {
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      },
    );
    expect(bytes).toBe(5);
    expect(sent.map((s) => s.name)).toEqual(["put"]);
    expect(sent[0]?.input).toMatchObject({
      bucket: "bucket",
      key: "k/a.txt",
      contentType: "text/plain; charset=utf-8",
      cacheControl: "public, max-age=31536000, immutable",
    });
  });

  test("no Cache-Control is sent unless requested", async () => {
    const file = path.join(dir, "a.txt");
    await writeFile(file, "hello");
    const { store, sent } = fakeStore();
    await uploadObject(store, "bucket", uploadAt(file, "k/a.txt"));
    expect(sent[0]?.input["cacheControl"]).toBeUndefined();
  });

  test("a file at exactly the threshold is still one put", async () => {
    const file = path.join(dir, "edge.bin");
    await writeFile(file, new Uint8Array(8));
    const { store, sent } = fakeStore();
    await uploadObject(store, "b", uploadAt(file, "k/edge.bin"), {
      multipartThresholdBytes: 8,
    });
    expect(sent.map((s) => s.name)).toEqual(["put"]);
  });

  test("a file above the threshold uploads in parts and completes in order", async () => {
    const file = path.join(dir, "big.bin");
    await writeFile(file, new Uint8Array(20));
    const { store, sent } = fakeStore();
    const bytes = await uploadObject(
      store,
      "bucket",
      uploadAt(file, "k/big.bin"),
      {
        multipartThresholdBytes: 8,
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      },
    );
    expect(bytes).toBe(20);
    expect(sent.map((s) => s.name)).toEqual([
      "create",
      "part",
      "part",
      "part",
      "complete",
    ]);
    expect(sent[0]?.input).toMatchObject({
      key: "k/big.bin",
      contentType: "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
    });
    const bodies = sent
      .filter((s) => s.name === "part")
      .map((s) => s.input["body"]);
    expect(
      bodies.map((body) => (body instanceof Uint8Array ? body.byteLength : -1)),
    ).toEqual([8, 8, 4]);
    expect(sent[4]?.input["parts"]).toEqual([
      { etag: "etag-1", partNumber: 1 },
      { etag: "etag-2", partNumber: 2 },
      { etag: "etag-3", partNumber: 3 },
    ]);
  });

  test("a failed part aborts the multipart upload and rethrows", async () => {
    const file = path.join(dir, "big.bin");
    await writeFile(file, new Uint8Array(20));
    const { store, sent } = fakeStore(2);
    await expect(
      uploadObject(store, "bucket", uploadAt(file, "k/big.bin"), {
        multipartThresholdBytes: 8,
      }),
    ).rejects.toThrow("part failed");
    expect(sent.at(-1)?.name).toBe("abort");
    expect(sent.at(-1)?.input).toMatchObject({ uploadId: "upload-1" });
    expect(sent.map((s) => s.name)).not.toContain("complete");
  });

  test("generated objects without a local file are a single put", async () => {
    const { store, sent } = fakeStore();
    await uploadObject(
      store,
      "bucket",
      uploadAt("/rec/demo.cast", "k/demo.cast", 1),
      {
        multipartThresholdBytes: 1,
      },
    );
    expect(sent.map((s) => s.name)).toEqual(["put"]);
  });
});
