import { describe, expect, test } from "vitest";
import { isTransientBackupStorageError } from "./seaweedfs-backup.ts";

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

describe("isTransientBackupStorageError", () => {
  test("rejects S3 access denials so restoration fails fast", () => {
    expect(
      isTransientBackupStorageError(
        s3Error({ name: "AccessDenied", httpStatusCode: 403 }),
      ),
    ).toBe(false);
    expect(
      isTransientBackupStorageError(
        s3Error({ code: "AccessDenied", message: "Access Denied" }),
      ),
    ).toBe(false);
  });

  test("retries retryable statuses", () => {
    for (const httpStatusCode of [408, 429, 500, 503]) {
      expect(isTransientBackupStorageError(s3Error({ httpStatusCode }))).toBe(
        true,
      );
    }
  });

  test("retries transport failures by code", () => {
    expect(
      isTransientBackupStorageError(s3Error({ code: "ECONNREFUSED" })),
    ).toBe(true);
  });

  test("finds a transient cause wrapped in a generic error", () => {
    const wrapped = new Error("request failed", {
      cause: s3Error({ code: "ECONNRESET" }),
    });
    expect(isTransientBackupStorageError(wrapped)).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isTransientBackupStorageError(new Error("boom"))).toBe(false);
    expect(isTransientBackupStorageError(null)).toBe(false);
    expect(isTransientBackupStorageError("ECONNREFUSED")).toBe(false);
  });
});
