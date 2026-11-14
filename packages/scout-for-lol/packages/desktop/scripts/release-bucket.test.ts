import { describe, expect, test } from "vitest";
import {
  IMMUTABLE_CACHE_CONTROL,
  MANIFEST_CACHE_CONTROL,
  RELEASE_BUCKET,
  publicReadback,
  putChannelManifest,
  putImmutable,
  readObject,
  type Bucket,
} from "./release-bucket.ts";

type Stored = { body: Uint8Array; etag: string; cacheControl: string | null };

/** An in-memory bucket that honours If-None-Match and If-Match like S3. */
function fakeBucket() {
  const objects = new Map<string, Stored>();
  const puts: string[] = [];
  let version = 0;
  const bucket: Bucket = {
    config: {
      endpoint: "https://s3.example.test",
      bucket: RELEASE_BUCKET,
      region: "us-east-1",
      forcePathStyle: true,
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    fetcher: async (request) => {
      const key = decodeURIComponent(
        new URL(request.url).pathname.slice(`/${RELEASE_BUCKET}/`.length),
      );
      const found = objects.get(key);
      if (request.method === "GET") {
        if (found === undefined) return new Response(null, { status: 404 });
        return new Response(Buffer.from(found.body), {
          status: 200,
          headers: { etag: found.etag },
        });
      }
      if (request.method !== "PUT") return new Response(null, { status: 405 });
      const ifNoneMatch = request.headers.get("If-None-Match");
      const ifMatch = request.headers.get("If-Match");
      if (
        (ifNoneMatch === "*" && found !== undefined) ||
        (ifMatch !== null && found?.etag !== ifMatch)
      ) {
        return new Response(null, { status: 412 });
      }
      version += 1;
      puts.push(key);
      objects.set(key, {
        body: new Uint8Array(await request.arrayBuffer()),
        etag: `"v${String(version)}"`,
        cacheControl: request.headers.get("Cache-Control"),
      });
      return new Response(null, { status: 200 });
    },
  };
  return { bucket, objects, puts };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("immutable release objects", () => {
  test("uploads once with the immutable cache policy and reads it back", async () => {
    const { bucket, objects } = fakeBucket();
    const key = "releases/0.2.0/scout-desktop-stable_0.2.0_x64-setup.exe";
    expect(
      await putImmutable(bucket, {
        key,
        body: bytes("installer"),
        contentType: "application/octet-stream",
      }),
    ).toBe("uploaded");
    expect(objects.get(key)?.cacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  test("a retry with identical bytes is a no-op", async () => {
    const { bucket, puts } = fakeBucket();
    const object = {
      key: "releases/0.2.0/a.exe",
      body: bytes("installer"),
      contentType: "application/octet-stream",
    };
    await putImmutable(bucket, object);
    expect(await putImmutable(bucket, object)).toBe("already published");
    expect(puts).toHaveLength(1);
  });

  test("different bytes under a published key are refused", async () => {
    const { bucket, objects } = fakeBucket();
    const key = "releases/0.2.0/a.exe";
    await putImmutable(bucket, {
      key,
      body: bytes("installer"),
      contentType: "application/octet-stream",
    });
    await expect(
      putImmutable(bucket, {
        key,
        body: bytes("another installer"),
        contentType: "application/octet-stream",
      }),
    ).rejects.toThrow(/Bump the version/);
    expect(objects.get(key)?.body).toEqual(bytes("installer"));
  });
});

describe("channel manifest concurrency", () => {
  const key = "stable.json";

  test("the first publication needs a channel with no manifest", async () => {
    const { bucket, objects } = fakeBucket();
    await putChannelManifest(bucket, {
      key,
      body: bytes("{}"),
      expectedETag: null,
    });
    expect(objects.get(key)?.cacheControl).toBe(MANIFEST_CACHE_CONTROL);
    await expect(
      putChannelManifest(bucket, {
        key,
        body: bytes("{ }"),
        expectedETag: null,
      }),
    ).rejects.toThrow(/changed during publication/);
  });

  test("replaces the manifest it read, and no other", async () => {
    const { bucket } = fakeBucket();
    await putChannelManifest(bucket, {
      key,
      body: bytes("one"),
      expectedETag: null,
    });
    const first = await readObject(bucket, key);
    await putChannelManifest(bucket, {
      key,
      body: bytes("two"),
      expectedETag: first?.etag ?? null,
    });
    // A second operator still holding the first ETag loses.
    await expect(
      putChannelManifest(bucket, {
        key,
        body: bytes("three"),
        expectedETag: first?.etag ?? null,
      }),
    ).rejects.toThrow(/changed during publication/);
    expect((await readObject(bucket, key))?.body).toEqual(bytes("two"));
  });

  test("the bucket itself refuses a stale precondition", async () => {
    const { bucket, objects } = fakeBucket();
    await putChannelManifest(bucket, {
      key,
      body: bytes("one"),
      expectedETag: null,
    });
    const stale = (await readObject(bucket, key))?.etag ?? null;
    // Another publisher lands between our check and our write.
    const inner = bucket.fetcher;
    let raced = false;
    const racing: Bucket = {
      ...bucket,
      fetcher: async (request) => {
        if (request.method === "PUT" && !raced) {
          raced = true;
          objects.set(key, {
            body: bytes("raced"),
            etag: '"raced"',
            cacheControl: null,
          });
        }
        return inner(request);
      },
    };
    await expect(
      putChannelManifest(racing, {
        key,
        body: bytes("two"),
        expectedETag: stale,
      }),
    ).rejects.toThrow(/changed during publication/);
    expect(objects.get(key)?.body).toEqual(bytes("raced"));
  });
});

describe("public readback", () => {
  test("passes only for exactly the published bytes", async () => {
    const body = bytes("installer");
    const serving =
      (answer: Uint8Array, status = 200) =>
      () =>
        Promise.resolve(new Response(Buffer.from(answer), { status }));
    await expect(
      publicReadback("https://download.example.test/x", body, serving(body)),
    ).resolves.toBeUndefined();
    await expect(
      publicReadback(
        "https://download.example.test/x",
        body,
        serving(bytes("other")),
      ),
    ).rejects.toThrow(/verification failed/);
    await expect(
      publicReadback(
        "https://download.example.test/x",
        body,
        serving(body, 404),
      ),
    ).rejects.toThrow(/verification failed/);
  });
});
