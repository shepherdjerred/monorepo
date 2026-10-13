import { S3Client } from "@aws-sdk/client-s3";
import { expect, test } from "vitest";
import { computeSha256Digest } from "#src/storage/object-integrity.ts";
import { putRawObservation } from "./object-store.ts";

test.each([false, true])(
  "real SDK writes immutable raw objects, including uncertain puts: %s",
  async (initialUncertain) => {
    let stored: Uint8Array | undefined;
    let writes = 0;
    let conditional: string | null = null;
    let uncertain = initialUncertain;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (request.method === "PUT") {
          conditional = request.headers.get("If-None-Match");
          if (stored !== undefined)
            return new Response(
              "<Error><Code>PreconditionFailed</Code></Error>",
              { status: 412, headers: { "Content-Type": "application/xml" } },
            );
          stored = new Uint8Array(await request.arrayBuffer());
          writes += 1;
          if (uncertain) {
            uncertain = false;
            return new Response("<Error><Code>InternalError</Code></Error>", {
              status: 500,
            });
          }
          return new Response(null, {
            headers: {
              ETag: new Bun.CryptoHasher("md5").update(stored).digest("hex"),
            },
          });
        }
        return stored === undefined
          ? new Response(null, { status: 404 })
          : new Response(stored, {
              headers: { "Content-Length": stored.length.toString() },
            });
      },
    });
    const client = new S3Client({
      endpoint: server.url.toString(),
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
      maxAttempts: 1,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    const bytes = new TextEncoder().encode(
      JSON.stringify({ unknown: { nested: [0, null, "preserved"] } }),
    );
    const object = {
      key: "scout-client/observations/fixture.json",
      bytes,
      digest: computeSha256Digest(bytes),
    };
    try {
      if (initialUncertain)
        await expect(
          putRawObservation(client, "fixture", object),
        ).rejects.toThrow();
      await putRawObservation(client, "fixture", object);
      await putRawObservation(client, "fixture", object);
      expect(writes).toBe(1);
      expect(conditional).toBe("*");
      expect(stored).toEqual(bytes);
      const changed = new TextEncoder().encode("different bytes");
      await expect(
        putRawObservation(client, "fixture", {
          ...object,
          bytes: changed,
          digest: computeSha256Digest(changed),
        }),
      ).rejects.toThrow("integrity verification");
      expect(stored).toEqual(bytes);
    } finally {
      client.destroy();
      await server.stop(true);
    }
  },
);
