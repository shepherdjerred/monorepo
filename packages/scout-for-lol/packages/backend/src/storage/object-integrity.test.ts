import { describe, expect, test } from "vitest";
import { Sha256DigestSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  SHA256_METADATA_KEY,
  assertPutIntegrity,
  computeSha256Digest,
  verifyPutEtag,
} from "#src/storage/object-integrity.ts";

const BODY = new TextEncoder().encode("the exact bytes we uploaded");
// RFC 1321 test vector, so the ETag comparison is pinned against a value that
// does not come from the same implementation it is checking.
const EMPTY_MD5 = "d41d8cd98f00b204e9800998ecf8427e";

describe("content addressing", () => {
  test("computes a digest that parses through the domain brand", () => {
    const digest = computeSha256Digest(BODY);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Sha256DigestSchema.parse(digest)).toBe(digest);
  });

  test("is the published SHA-256 of the empty input", () => {
    expect(computeSha256Digest(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("distinguishes bodies that differ by one byte", () => {
    const other = new TextEncoder().encode("the exact bytes we uploaded!");

    expect(computeSha256Digest(BODY)).not.toBe(computeSha256Digest(other));
  });

  test("names the metadata key S3 carries the digest under", () => {
    expect(SHA256_METADATA_KEY).toBe("sha256");
  });
});

describe("ETag verification", () => {
  test("verifies a quoted single-part ETag that matches the body", () => {
    expect(
      verifyPutEtag({ body: new Uint8Array(), etag: `"${EMPTY_MD5}"` }),
    ).toEqual({ outcome: "verified" });
  });

  test("verifies an unquoted single-part ETag", () => {
    expect(verifyPutEtag({ body: new Uint8Array(), etag: EMPTY_MD5 })).toEqual({
      outcome: "verified",
    });
  });

  test("reports a mismatch when the server stored different bytes", () => {
    const verification = verifyPutEtag({ body: BODY, etag: EMPTY_MD5 });

    expect(verification.outcome).toBe("mismatch");
  });

  test("skips when the server returned no ETag", () => {
    expect(verifyPutEtag({ body: BODY, etag: undefined })).toEqual({
      outcome: "skipped",
      reason: "no-etag",
    });
  });

  test("skips a multipart ETag instead of failing it", () => {
    expect(verifyPutEtag({ body: BODY, etag: `"${EMPTY_MD5}-4"` })).toEqual({
      outcome: "skipped",
      reason: "multipart-etag",
    });
  });
});

describe("put integrity assertion", () => {
  test("throws on a mismatch, naming the key", () => {
    expect(() =>
      assertPutIntegrity({
        body: BODY,
        etag: EMPTY_MD5,
        errorContext: "match",
        key: "games/2026/09/12/NA1_1/match.json",
      }),
    ).toThrow("games/2026/09/12/NA1_1/match.json");
  });

  test("accepts a skipped check, because a skip is not evidence of corruption", () => {
    expect(() =>
      assertPutIntegrity({
        body: BODY,
        etag: undefined,
        errorContext: "match",
        key: "games/2026/09/12/NA1_1/match.json",
      }),
    ).not.toThrow();
  });
});
