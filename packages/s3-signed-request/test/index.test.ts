import { describe, expect, test } from "vitest";
import {
  createSignedS3Request,
  type SignedS3RequestConfig,
} from "@shepherdjerred/s3-signed-request";

const signingTime = new Date("2026-05-19T15:30:00.000Z");
const config: SignedS3RequestConfig = {
  accessKeyId: "example-access-key",
  secretAccessKey: "example-secret-key",
  endpoint: "https://s3.example.com/api/",
  bucket: "archive-bucket",
  region: "us-west-2",
  forcePathStyle: true,
};

describe("createSignedS3Request", () => {
  test("creates a deterministic path-style GET signature and encodes each key segment", () => {
    const request = createSignedS3Request(config, {
      method: "GET",
      key: "folder/space + snowman ☃.json",
      signingTime,
    });

    expect(request.url).toBe(
      "https://s3.example.com/api/archive-bucket/folder/space%20%2B%20snowman%20%E2%98%83.json",
    );
    expect(request.method).toBe("GET");
    expect(request.headers.get("x-amz-date")).toBe("20260519T153000Z");
    expect(request.headers.get("x-amz-content-sha256")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(request.headers.get("authorization")).toBe(
      "AWS4-HMAC-SHA256 Credential=example-access-key/20260519/us-west-2/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=9e8ea204b0ccfdb181df4574352bedf74a099270e3eab536616c01ee2fd2c6a1",
    );
    expect(request.headers.get("content-type")).toBeNull();
    expect(request.body).toBeNull();
  });

  test("supports virtual-host addressing and HEAD requests", () => {
    const request = createSignedS3Request(
      { ...config, forcePathStyle: false },
      { method: "HEAD", key: "health/check", signingTime },
    );

    expect(request.url).toBe(
      "https://archive-bucket.s3.example.com/api/health/check",
    );
    expect(request.method).toBe("HEAD");
    expect(request.body).toBeNull();
  });

  test("signs session credentials", () => {
    const request = createSignedS3Request(
      { ...config, sessionToken: "temporary-session-token" },
      { method: "GET", key: "object.json", signingTime },
    );

    expect(request.headers.get("x-amz-security-token")).toBe(
      "temporary-session-token",
    );
    expect(request.headers.get("authorization")).toContain(
      "SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token",
    );
  });

  test("includes PUT bodies and content types in the request", async () => {
    const request = createSignedS3Request(config, {
      method: "PUT",
      key: "archive.json.gz",
      body: "compressed-content",
      contentType: "application/gzip",
      signingTime,
    });

    expect(request.method).toBe("PUT");
    expect(request.headers.get("content-type")).toBe("application/gzip");
    expect(request.headers.get("x-amz-content-sha256")).toBe(
      "ea6a59ec73d91dcb6daa77b067775b713751cd7991a63e8bbb36ffbccdf17841",
    );
    expect(await request.text()).toBe("compressed-content");
  });

  test("retains the caller-owned abort signal", () => {
    const controller = new AbortController();
    const request = createSignedS3Request(config, {
      method: "GET",
      key: "object.json",
      signingTime,
      signal: controller.signal,
    });

    expect(request.signal.aborted).toBe(false);
    controller.abort();
    expect(request.signal.aborted).toBe(true);
  });
});
