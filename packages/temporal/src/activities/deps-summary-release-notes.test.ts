import { afterEach, describe, expect, test } from "vitest";
import type { DependencyChange } from "./deps-summary.ts";
import { ociManifestAttempt } from "./deps-summary-oci.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function imageChange(): DependencyChange {
  return {
    name: "owner/image",
    category: "upstream",
    artifactType: "image",
    datasource: "docker",
    registryUrl: "https://docker.io",
    packageName: undefined,
    oldValue: `1.0.0@sha256:${"a".repeat(64)}`,
    newValue: `2.0.0@sha256:${"b".repeat(64)}`,
    oldVersion: "1.0.0",
    newVersion: "2.0.0",
    kind: "upstream-upgrade",
    commitSha: "c".repeat(40),
    commitSubject: "chore(deps): update owner/image",
    releaseNotesOverride: undefined,
  };
}

describe("dependency OCI release-note metadata", () => {
  test("authenticates to Docker Hub and reads OCI config labels", async () => {
    const requested: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        requested.push(url);
        if (url.startsWith("https://auth.docker.io/token")) {
          return Response.json({ token: "registry-token" });
        }
        if (url.endsWith("/manifests/2.0.0")) {
          const headers = new Headers(init?.headers);
          if (!headers.has("Authorization")) {
            return new Response("", {
              status: 401,
              headers: {
                "WWW-Authenticate":
                  'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:owner/image:pull"',
              },
            });
          }
          return Response.json({
            config: { digest: `sha256:${"d".repeat(64)}` },
          });
        }
        if (url.includes("/blobs/sha256:")) {
          return Response.json({
            config: {
              Labels: {
                "org.opencontainers.image.description":
                  "This image release includes a substantive and testable upstream change summary.",
                "org.opencontainers.image.source":
                  "https://github.com/owner/image",
              },
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      { preconnect: originalFetch.preconnect },
    );

    const result = await ociManifestAttempt(imageChange());

    expect(result.attempt).toMatchObject({
      source: "oci-manifest",
      outcome: "found",
      url: "https://github.com/owner/image",
    });
    expect(result.note?.notes).toContain("substantive");
    const manifestRequest = requested[0];
    if (manifestRequest === undefined) {
      throw new Error("Expected an OCI manifest request");
    }
    expect(
      manifestRequest.startsWith(
        "https://registry-1.docker.io/v2/owner/image/manifests/2.0.0",
      ),
    ).toBe(true);
    expect(
      requested.some((url) => url.startsWith("https://auth.docker.io/token")),
    ).toBe(true);
  });
});
