import { afterEach, describe, expect, test, vi } from "vitest";
import { putS3Object, type S3PutObjectConfig } from "./s3.ts";

const config: S3PutObjectConfig = {
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
  sessionToken: "session-token",
  endpoint: "https://s3.example.com",
  bucket: "archive",
  key: "matches/one.json",
  region: "us-east-1",
  forcePathStyle: true,
  contentType: "application/json",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("putS3Object", () => {
  test("uploads a signed request with the configured content type", async () => {
    const fetchMock = vi.fn(
      async (_input: Request) => new Response(undefined, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await putS3Object(config, '{"match":1}');

    expect(fetchMock).toHaveBeenCalledOnce();
    const input = fetchMock.mock.calls[0]?.[0];
    if (!(input instanceof Request)) {
      throw new TypeError("Expected fetch to receive a Request");
    }
    expect(input.url).toBe("https://s3.example.com/archive/matches/one.json");
    expect(input.method).toBe("PUT");
    expect(input.headers.get("content-type")).toBe("application/json");
    expect(input.headers.get("x-amz-security-token")).toBe("session-token");
    expect(await input.text()).toBe('{"match":1}');
  });

  test("preserves the response body in upload failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("storage unavailable", {
            status: 503,
            statusText: "Service Unavailable",
          }),
      ),
    );

    await expect(putS3Object(config, "payload")).rejects.toThrow(
      "S3 upload failed (503): storage unavailable",
    );
  });
});
