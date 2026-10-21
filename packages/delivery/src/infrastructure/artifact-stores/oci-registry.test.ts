import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { registryLocation, resolveManifestDigest } from "./oci-registry.ts";

const manifest = new TextEncoder().encode(
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { digest: `sha256:${"d".repeat(64)}` },
  }),
);
const manifestDigest = `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
const challenge =
  'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/postgres:pull"';
const location = {
  origin: "https://registry-1.docker.io",
  repository: "library/postgres",
};
const manifestUrl = `${location.origin}/v2/${location.repository}/manifests/17.2`;

type Recorded = { url: string; headers: Headers; redirect: string | undefined };
function registry(
  options: {
    body?: Uint8Array<ArrayBuffer>;
    declared?: string | null;
    realm?: string;
    token?: Response;
    manifestStatus?: number;
    challenge?: string | null;
  } = {},
) {
  const requests: Recorded[] = [];
  const body = options.body ?? manifest;
  const declared =
    options.declared === undefined
      ? `sha256:${createHash("sha256").update(body).digest("hex")}`
      : options.declared;
  const transport = async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const href = url.toString();
    requests.push({ url: href, headers, redirect: init?.redirect });
    if (href.startsWith("https://auth.docker.io/token?"))
      return options.token ?? Response.json({ token: "anonymous-pull" });
    if (href !== manifestUrl) throw new Error(`Unexpected request ${href}`);
    if (headers.get("authorization") !== "Bearer anonymous-pull")
      return new Response(null, {
        status: 401,
        ...(options.challenge === null
          ? {}
          : {
              headers: {
                "WWW-Authenticate": (options.challenge ?? challenge).replace(
                  "https://auth.docker.io/token",
                  options.realm ?? "https://auth.docker.io/token",
                ),
              },
            }),
      });
    return new Response(body, {
      status: options.manifestStatus ?? 200,
      headers: {
        "Content-Type": "application/vnd.oci.image.manifest.v1+json",
        ...(declared === null ? {} : { "Docker-Content-Digest": declared }),
      },
    });
  };
  return { requests, transport };
}

describe("registryLocation", () => {
  test("maps Docker Hub names to the registry API, official images to the library namespace", () => {
    expect(registryLocation("https://docker.io", "postgres")).toEqual({
      origin: "https://registry-1.docker.io",
      repository: "library/postgres",
      uri: "docker.io/postgres",
    });
    expect(registryLocation("https://docker.io", "pinchtab/pinchtab")).toEqual({
      origin: "https://registry-1.docker.io",
      repository: "pinchtab/pinchtab",
      uri: "docker.io/pinchtab/pinchtab",
    });
  });
  test("keeps other registries verbatim, including a path prefix", () => {
    expect(registryLocation("https://ghcr.io", "owner/image")).toEqual({
      origin: "https://ghcr.io",
      repository: "owner/image",
      uri: "ghcr.io/owner/image",
    });
    expect(
      registryLocation("https://registry.k8s.io/prefix/", "image"),
    ).toEqual({
      origin: "https://registry.k8s.io",
      repository: "prefix/image",
      uri: "registry.k8s.io/prefix/image",
    });
    expect(() => registryLocation("http://registry.local", "image")).toThrow(
      /https/,
    );
  });
});

describe("resolveManifestDigest", () => {
  test("answers the bearer challenge anonymously and hashes the manifest as served", async () => {
    const { requests, transport } = registry();
    await expect(
      resolveManifestDigest(location, "17.2", transport),
    ).resolves.toBe(manifestDigest);
    expect(requests.map((request) => request.url)).toEqual([
      manifestUrl,
      "https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Fpostgres%3Apull",
      manifestUrl,
    ]);
    const [first, token, second] = requests;
    expect(first?.headers.get("accept")).toContain(
      "application/vnd.oci.image.index.v1+json",
    );
    expect(first?.headers.get("accept")).toContain(
      "application/vnd.docker.distribution.manifest.v2+json",
    );
    expect(first?.headers.has("authorization")).toBe(false);
    expect(token?.headers.has("authorization")).toBe(false);
    expect(second?.headers.get("authorization")).toBe("Bearer anonymous-pull");
    expect(requests.every((request) => request.redirect === "manual")).toBe(
      true,
    );
  });
  test("accepts access_token responses and a scope-less challenge with the pull scope filled in", async () => {
    const { requests, transport } = registry({
      challenge: 'Bearer realm="https://auth.docker.io/token"',
      token: Response.json({ access_token: "anonymous-pull" }),
    });
    await expect(
      resolveManifestDigest(location, "17.2", transport),
    ).resolves.toBe(manifestDigest);
    expect(requests[1]?.url).toBe(
      "https://auth.docker.io/token?scope=repository%3Alibrary%2Fpostgres%3Apull",
    );
  });
  test("refuses a manifest whose declared content digest disagrees with its bytes", async () => {
    const { transport } = registry({ declared: `sha256:${"f".repeat(64)}` });
    await expect(
      resolveManifestDigest(location, "17.2", transport),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
  test("hashes the bytes when the registry declares no content digest", async () => {
    const { transport } = registry({ declared: null });
    await expect(
      resolveManifestDigest(location, "17.2", transport),
    ).resolves.toBe(manifestDigest);
  });
  test("never contacts a token realm that is not https", async () => {
    const { requests, transport } = registry({
      realm: "http://auth.docker.io/token",
    });
    await expect(
      resolveManifestDigest(location, "17.2", transport),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(requests).toHaveLength(1);
  });
  test("reports registry and token outages as pending rather than invalid", async () => {
    await expect(
      resolveManifestDigest(
        location,
        "17.2",
        registry({ challenge: null }).transport,
      ),
    ).rejects.toMatchObject({ code: "PAUSED" });
    await expect(
      resolveManifestDigest(
        location,
        "17.2",
        registry({ token: new Response(null, { status: 503 }) }).transport,
      ),
    ).rejects.toMatchObject({ code: "PAUSED" });
    await expect(
      resolveManifestDigest(
        location,
        "17.2",
        registry({ token: Response.json({}) }).transport,
      ),
    ).rejects.toMatchObject({ code: "PAUSED" });
    await expect(
      resolveManifestDigest(
        location,
        "17.2",
        registry({ manifestStatus: 404 }).transport,
      ),
    ).rejects.toMatchObject({ code: "PAUSED" });
  });
  test("refuses redirects and oversized manifests", async () => {
    await expect(
      resolveManifestDigest(
        location,
        "17.2",
        async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "https://elsewhere.example/manifest" },
          }),
      ),
    ).rejects.toMatchObject({ code: "INVALID" });
    const { transport } = registry({
      body: new Uint8Array(4 * 1024 * 1024 + 1),
      declared: null,
    });
    await expect(
      resolveManifestDigest(location, "17.2", transport),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});
