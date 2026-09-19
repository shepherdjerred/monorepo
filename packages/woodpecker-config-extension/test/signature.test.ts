import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { contentDigestMatches } from "#src/signature.ts";
import { resolveCiImages } from "#src/images.ts";

function digestHeader(body: string, alg: "sha-256" | "sha-512" = "sha-256") {
  const hash = createHash(alg === "sha-256" ? "sha256" : "sha512")
    .update(body)
    .digest("base64");
  return `${alg}=:${hash}:`;
}

describe("content digest", () => {
  test("accepts a digest that matches the body", () => {
    const body = '{"repo":{}}';
    expect(contentDigestMatches(digestHeader(body), body)).toBe(true);
  });

  /**
   * The signature covers the Content-Digest HEADER, not the body. Without this
   * check a captured header set could be replayed against a substituted body —
   * and the body is what becomes an executed pipeline.
   */
  test("rejects a digest that does not match the body", () => {
    expect(contentDigestMatches(digestHeader("original"), "substituted")).toBe(
      false,
    );
  });

  test("accepts sha-512", () => {
    const body = "payload";
    expect(contentDigestMatches(digestHeader(body, "sha-512"), body)).toBe(
      true,
    );
  });

  test("rejects a missing header", () => {
    expect(contentDigestMatches(undefined, "body")).toBe(false);
  });

  test("rejects an unparseable entry rather than skipping it", () => {
    expect(contentDigestMatches("md5=:abc:", "body")).toBe(false);
  });

  test("rejects when any entry in the dictionary mismatches", () => {
    const body = "payload";
    const header = `${digestHeader(body)}, sha-512=:wrong:`;
    expect(contentDigestMatches(header, body)).toBe(false);
  });
});

describe("ci image resolution", () => {
  const digest = "sha256:" + "b".repeat(64);

  test("pins both images by digest at the given commit", async () => {
    const seen: string[] = [];
    const images = await resolveCiImages("abc123", async (path, commit) => {
      seen.push(`${path}@${commit}`);
      return digest;
    });
    expect(images.base).toBe(`ghcr.io/shepherdjerred/ci-base@${digest}`);
    expect(images.playwright).toBe(
      `ghcr.io/shepherdjerred/ci-playwright@${digest}`,
    );
    expect(seen).toContain(".buildkite/ci-image/DIGEST@abc123");
  });

  /** A malformed digest would be interpolated straight into an image ref. */
  test("rejects a malformed digest", async () => {
    await expect(
      resolveCiImages("abc123", async () => "latest"),
    ).rejects.toThrow(/invalid CI image digest/u);
  });
});
