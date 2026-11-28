import { Readable } from "node:stream";
import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { describe, expect, test } from "vitest";
import { createLifecycleS3, lifecycleS3FromSender } from "./client.ts";

type Handler = Extract<
  NonNullable<S3ClientConfig["requestHandler"]>,
  { handle: unknown }
>;
type Reply = { status: number; xml: string };
type Seen = { method: string; path: string; query: string; body: string };

/**
 * A real S3 client over a canned HTTP handler, so the adapter is exercised
 * through the SDK's own request building and XML parsing.
 */
function s3Over(respond: (seen: Seen) => Reply) {
  const requests: Seen[] = [];
  const client = new S3Client({
    endpoint: "http://seaweedfs.test:8333",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "id", secretAccessKey: "secret" },
    maxAttempts: 1,
    requestHandler: {
      async handle(request: Parameters<Handler["handle"]>[0]) {
        const chunks: Buffer[] = [];
        if (
          request.body instanceof Uint8Array ||
          typeof request.body === "string"
        ) {
          chunks.push(Buffer.from(request.body));
        }
        const seen: Seen = {
          method: request.method,
          path: request.path,
          query: new URLSearchParams(
            Object.entries(request.query ?? {}).flatMap(
              ([key, value]): [string, string][] =>
                typeof value === "string" ? [[key, value]] : [],
            ),
          ).toString(),
          body: Buffer.concat(chunks).toString(),
        };
        requests.push(seen);
        const reply = respond(seen);
        return {
          response: {
            statusCode: reply.status,
            headers: { "content-type": "application/xml" },
            body: Readable.from([reply.xml]),
          },
        };
      },
      destroy() {
        // Nothing to release: the handler holds no connections.
      },
      updateHttpClientConfig() {
        // The canned handler has no client configuration to update.
      },
      httpHandlerConfigs() {
        return {};
      },
    },
  });
  return { requests, s3: lifecycleS3FromSender(client) };
}

const errorXml = (code: string) =>
  `<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`;

describe("lifecycleS3FromSender", () => {
  test("lists bucket names", async () => {
    const { s3 } = s3Over(() => ({
      status: 200,
      xml: "<ListAllMyBucketsResult><Buckets><Bucket><Name>a</Name></Bucket><Bucket><Name>b</Name></Bucket></Buckets></ListAllMyBucketsResult>",
    }));
    expect(await s3.listBuckets()).toEqual(["a", "b"]);
  });

  test("parses the lifecycle rules SeaweedFS stores", async () => {
    const { s3, requests } = s3Over(() => ({
      status: 200,
      xml: `<LifecycleConfiguration>
        <Rule><ID>expire-ci-handoff</ID><Filter><Prefix></Prefix></Filter><Status>Enabled</Status><Expiration><Days>30</Days></Expiration></Rule>
        <Rule><ID>hashed</ID><Filter><Prefix>_astro/</Prefix></Filter><Status>Enabled</Status><Expiration><Days>90</Days></Expiration></Rule>
      </LifecycleConfiguration>`,
    }));
    const rules = await s3.getLifecycleRules("ci-handoff");
    expect(
      rules?.map((rule) => [
        rule.ID,
        rule.Filter?.Prefix,
        rule.Expiration?.Days,
      ]),
    ).toEqual([
      ["expire-ci-handoff", "", 30],
      ["hashed", "_astro/", 90],
    ]);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.path).toContain("ci-handoff");
    expect(requests[0]?.query).toContain("lifecycle");
  });

  test("maps only NoSuchLifecycleConfiguration to no configuration", async () => {
    const missing = s3Over(() => ({
      status: 404,
      xml: errorXml("NoSuchLifecycleConfiguration"),
    }));
    expect(await missing.s3.getLifecycleRules("a")).toBeUndefined();
    for (const [status, code] of [
      [404, "NoSuchBucket"],
      [500, "InternalError"],
      [403, "AccessDenied"],
    ] as const) {
      const failing = s3Over(() => ({ status, xml: errorXml(code) }));
      await expect(failing.s3.getLifecycleRules("a")).rejects.toThrow();
    }
  });

  test("lists a page of objects and its continuation", async () => {
    const { s3, requests } = s3Over(() => ({
      status: 200,
      xml: `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next</NextContinuationToken>
        <Contents><Key>k</Key><Size>7</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>`,
    }));
    const page = await s3.listObjects({
      bucket: "a",
      prefix: "x/",
      token: "t",
      maxKeys: 500,
    });
    expect(page).toEqual({
      objects: [
        { key: "k", size: 7, lastModified: new Date("2026-01-01T00:00:00Z") },
      ],
      nextToken: "next",
    });
    const query = new URLSearchParams(requests[0]?.query);
    expect(query.get("prefix")).toBe("x/");
    expect(query.get("continuation-token")).toBe("t");
    expect(query.get("max-keys")).toBe("500");
  });

  test("omits an empty prefix and ends an untruncated listing", async () => {
    const { s3, requests } = s3Over(() => ({
      status: 200,
      xml: "<ListBucketResult><IsTruncated>false</IsTruncated><NextContinuationToken>stale</NextContinuationToken></ListBucketResult>",
    }));
    const page = await s3.listObjects({
      bucket: "a",
      prefix: "",
      token: undefined,
      maxKeys: 1000,
    });
    expect(page).toEqual({ objects: [], nextToken: undefined });
    expect(new URLSearchParams(requests[0]?.query).has("prefix")).toBe(false);
  });

  test("deletes quietly and returns only per-key failures", async () => {
    const { s3, requests } = s3Over(() => ({
      status: 200,
      xml: "<DeleteResult><Error><Key>b</Key><Code>AccessDenied</Code><Message>no</Message></Error></DeleteResult>",
    }));
    const failures = await s3.deleteObjects({ bucket: "a", keys: ["a", "b"] });
    expect(failures).toEqual([
      { key: "b", code: "AccessDenied", message: "no" },
    ]);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.body).toContain("<Quiet>true</Quiet>");
    expect(requests[0]?.body).toContain("<Key>a</Key>");
  });
});

describe("createLifecycleS3", () => {
  test.each(["S3_ENDPOINT", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"])(
    "requires %s",
    (name) => {
      const env = new Map([
        ["S3_ENDPOINT", "http://seaweedfs-s3.seaweedfs:8333"],
        ["AWS_ACCESS_KEY_ID", "id"],
        ["AWS_SECRET_ACCESS_KEY", "secret"],
      ]);
      env.delete(name);
      expect(() => createLifecycleS3(Object.fromEntries(env))).toThrow(name);
    },
  );

  test("builds a client from the worker's shared SeaweedFS identity", () => {
    expect(() =>
      createLifecycleS3({
        S3_ENDPOINT: "http://seaweedfs-s3.seaweedfs:8333",
        AWS_ACCESS_KEY_ID: "id",
        AWS_SECRET_ACCESS_KEY: "secret",
      }),
    ).not.toThrow();
  });
});
