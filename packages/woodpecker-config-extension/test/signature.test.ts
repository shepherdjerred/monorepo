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

  const catalog = JSON.stringify({
    entries: [
      { name: "aquasec/trivy", value: "0.72.0" },
      { name: "semgrep/semgrep", value: "1.170.0" },
      { name: "texlive/texlive", value: "TL2024-historic" },
      { name: "trmnl/trmnlp", value: "v0.11.0" },
      { name: "grafana/tempo", value: "3.0.3" },
      { name: "mikefarah/yq", value: "latest" },
      { name: "minio/mc", value: "RELEASE" },
      { name: "minio/minio", value: "RELEASE" },
    ],
  });

  function fetchFixture(path: string): string {
    return path.endsWith("catalog.json") ? catalog : digest;
  }

  test("pins every toolchain image by digest at the given commit", async () => {
    const seen: string[] = [];
    const images = await resolveCiImages("abc123", async (path, commit) => {
      seen.push(`${path}@${commit}`);
      return fetchFixture(path);
    });
    expect(images.base).toBe(`ghcr.io/shepherdjerred/ci-base@${digest}`);
    expect(images.playwright).toBe(
      `ghcr.io/shepherdjerred/ci-playwright@${digest}`,
    );
    expect(images.windowsCrossCompilerWinui).toBe(
      `ghcr.io/shepherdjerred/windows-cross-compiler-winui@${digest}`,
    );
    expect(seen).toContain("ci/ci-image/DIGEST@abc123");
    expect(seen).toContain(
      "packages/windows-cross-compiler/images/windows-cross-compiler-winui/DIGEST@abc123",
    );
  });

  test("reads scanner versions from the catalog at that commit", async () => {
    const images = await resolveCiImages("abc123", async (path) =>
      fetchFixture(path),
    );
    expect(images.catalog["aquasec/trivy"]).toBe("aquasec/trivy:0.72.0");
    expect(images.catalog["semgrep/semgrep"]).toBe("semgrep/semgrep:1.170.0");
  });

  /** A malformed digest would be interpolated straight into an image ref. */
  test("rejects a malformed digest", async () => {
    await expect(
      resolveCiImages("abc123", async (path) =>
        path.endsWith("catalog.json") ? catalog : "latest",
      ),
    ).rejects.toThrow(/invalid CI image digest/u);
  });

  /** A missing entry must fail, not silently fall back to an unpinned tag. */
  test("rejects a catalog with no entry for a scanner", async () => {
    await expect(
      resolveCiImages("abc123", async (path) =>
        path.endsWith("catalog.json")
          ? JSON.stringify({ entries: [] })
          : digest,
      ),
    ).rejects.toThrow(/no entry named aquasec\/trivy/u);
  });
});
