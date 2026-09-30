import { describe, expect, test } from "vitest";
import { isTransientStorageError } from "#shared/infra/s3.ts";

function s3Error(input: {
  name?: string;
  code?: string;
  message?: string;
  httpStatusCode?: number;
}): Error {
  const error = new Error(input.message ?? "S3 request failed");
  if (input.name !== undefined) {
    error.name = input.name;
  }
  const extra: {
    code?: string;
    $metadata?: { httpStatusCode: number };
  } = {};
  if (input.code !== undefined) {
    extra.code = input.code;
  }
  if (input.httpStatusCode !== undefined) {
    extra.$metadata = { httpStatusCode: input.httpStatusCode };
  }
  return Object.assign(error, extra);
}

describe("isTransientStorageError", () => {
  test("rejects S3 access denials so restoration fails fast", () => {
    expect(
      isTransientStorageError(
        s3Error({ name: "AccessDenied", httpStatusCode: 403 }),
      ),
    ).toBe(false);
    expect(
      isTransientStorageError(
        s3Error({ code: "AccessDenied", message: "Access Denied" }),
      ),
    ).toBe(false);
  });

  test("retries retryable statuses", () => {
    for (const httpStatusCode of [408, 429, 500, 503]) {
      expect(isTransientStorageError(s3Error({ httpStatusCode }))).toBe(true);
    }
  });

  test("retries transport failures by code", () => {
    expect(isTransientStorageError(s3Error({ code: "ECONNREFUSED" }))).toBe(
      true,
    );
  });

  test("finds a transient cause wrapped in a generic error", () => {
    const wrapped = new Error("request failed", {
      cause: s3Error({ code: "ECONNRESET" }),
    });
    expect(isTransientStorageError(wrapped)).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isTransientStorageError(new Error("boom"))).toBe(false);
    expect(isTransientStorageError(null)).toBe(false);
    expect(isTransientStorageError("ECONNREFUSED")).toBe(false);
  });
});
