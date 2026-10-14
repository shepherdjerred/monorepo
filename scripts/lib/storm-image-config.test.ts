import { createHash } from "node:crypto";
import { packTar, type TarEntry } from "modern-tar";
import { describe, expect, test } from "vitest";
import {
  readStormImageConfig,
  dockerHubReaderFetch,
  snapshotStormImageConfig,
  type RegistryFetch,
} from "./storm-image-config.ts";

const config = "modules:\n  economy: true\n  rwfbots: false\n";
const file = "plugins/TheStorm/config.yml";

test("reader authentication is sent only to the Docker Hub token service", async () => {
  const auth = Buffer.from("shepherdjerred:reader-fixture").toString("base64");
  const environment = {
    DOCKERHUB_READ_CONFIG_JSON: JSON.stringify({
      auths: { "https://index.docker.io/v1/": { auth } },
    }),
  };
  const seen: { url: string; authorization: string | null }[] = [];
  const fetcher = dockerHubReaderFetch(environment, async (url, init) => {
    seen.push({
      url: String(url),
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    return Response.json({});
  });
  await fetcher("https://auth.docker.io/token");
  await fetcher("https://registry-1.docker.io/v2/blob", {
    headers: { Authorization: "Bearer scoped-fixture" },
  });
  await fetcher("https://github.com/shepherdjerred/monorepo");
  expect(seen.map((request) => request.authorization)).toEqual([
    `Basic ${auth}`,
    "Bearer scoped-fixture",
    null,
  ]);
});
const sha = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const json = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

type FixtureEntry = { header: Omit<TarEntry["header"], "size">; body?: string };

async function registry(layers: FixtureEntry[][], indexed = false) {
  const bodies = new Map<string, Uint8Array>();
  const descriptors = [];
  for (const entries of layers) {
    const bytes = Bun.gzipSync(
      await packTar(
        entries.map((entry) => ({
          ...entry,
          header: {
            ...entry.header,
            size:
              typeof entry.body === "string"
                ? Buffer.byteLength(entry.body)
                : 0,
          },
        })),
      ),
    );
    const digest = sha(bytes);
    bodies.set(`/blobs/${digest}`, bytes);
    descriptors.push({
      digest,
      mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
    });
  }
  let manifest = json({ layers: descriptors });
  bodies.set(`/manifests/${sha(manifest)}`, manifest);
  if (indexed) {
    manifest = json({
      manifests: [
        {
          digest: sha(manifest),
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          platform: { os: "linux", architecture: "amd64" },
        },
      ],
    });
    bodies.set(`/manifests/${sha(manifest)}`, manifest);
  }
  const requested: string[] = [];
  const fetcher: RegistryFetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/token")
      return Response.json({ token: "fixture-anonymous-pull" });
    const key = pathname.slice("/v2/shepherdjerred/the-storm-server".length);
    requested.push(key);
    const bytes = bodies.get(key);
    return bytes === undefined
      ? new Response(null, { status: 404 })
      : new Response(bytes);
  };
  return { digest: sha(manifest), fetcher, bodies, requested };
}

describe("exact Storm image configuration", () => {
  test.each([false, true])(
    "reads verified layers (image index: %s) and stops before older blobs",
    async (indexed) => {
      const image = await registry(
        [
          [{ header: { name: file }, body: "modules:\n  retired: true\n" }],
          [{ header: { name: `./${file}` }, body: config }],
          [{ header: { name: "bundle/remove.list" }, body: "obsolete.jar" }],
        ],
        indexed,
      );
      expect(
        new TextDecoder().decode(
          await readStormImageConfig(image.digest, image.fetcher),
        ),
      ).toBe(config);
      expect(
        image.requested.filter((url) => url.startsWith("/blobs/")),
      ).toHaveLength(2);
    },
  );

  test("rejects a corrupted manifest before reading any layer", async () => {
    const image = await registry([[{ header: { name: file }, body: config }]]);
    image.bodies.set(`/manifests/${image.digest}`, json({ layers: [] }));
    await expect(
      readStormImageConfig(image.digest, image.fetcher),
    ).rejects.toThrow(/digest mismatch/u);
  });

  test("rejects a corrupted layer", async () => {
    const image = await registry([[{ header: { name: file }, body: config }]]);
    const blob = [...image.bodies.keys()].find((key) =>
      key.startsWith("/blobs/"),
    );
    if (blob === undefined) throw new Error("fixture has no layer");
    image.bodies.set(blob, new Uint8Array([1]));
    await expect(
      readStormImageConfig(image.digest, image.fetcher),
    ).rejects.toThrow(/digest mismatch/u);
  });

  test.each([
    "plugins/TheStorm/.wh.config.yml",
    "plugins/.wh.TheStorm",
    "plugins/TheStorm/.wh..wh..opq",
  ])("honors overlay deletion %s", async (name) => {
    const image = await registry([
      [{ header: { name: file }, body: config }],
      [{ header: { name }, body: "" }],
    ]);
    await expect(
      readStormImageConfig(image.digest, image.fetcher),
    ).rejects.toThrow(/removed/u);
  });

  test("accepts a replacement config in an opaque directory", async () => {
    const image = await registry([
      [
        { header: { name: "plugins/TheStorm/.wh..wh..opq" }, body: "" },
        { header: { name: file }, body: config },
      ],
    ]);
    expect(
      new TextDecoder().decode(
        await readStormImageConfig(image.digest, image.fetcher),
      ),
    ).toBe(config);
  });

  test("fails on a missing config or registry error", async () => {
    const image = await registry([]);
    await expect(
      readStormImageConfig(image.digest, image.fetcher),
    ).rejects.toThrow(/has no/u);
    await expect(
      readStormImageConfig(
        image.digest,
        async () => new Response(null, { status: 503 }),
      ),
    ).rejects.toThrow(/HTTP 503/u);
  });

  test("rejects symlinked and oversized config files", async () => {
    for (const entry of [
      {
        header: {
          name: file,
          type: "symlink" as const,
          linkname: "/etc/passwd",
        },
      },
      { header: { name: file }, body: "a".repeat(65 * 1024) },
    ]) {
      const image = await registry([[entry]]);
      await expect(
        readStormImageConfig(image.digest, image.fetcher),
      ).rejects.toThrow(/regular file|64 KiB/u);
    }
  });

  test("snapshots validated module keys and exact config bytes", () => {
    const bytes = new TextEncoder().encode(config);
    expect(snapshotStormImageConfig(bytes)).toEqual({
      configSha256: sha(bytes).slice(7),
      moduleKeys: ["economy", "rwfbots"],
    });
    for (const invalid of [
      "modules: {}",
      "modules:\n  economy: yes",
      "modules:\n  economy: true\nextra: true",
    ])
      expect(() =>
        snapshotStormImageConfig(new TextEncoder().encode(invalid)),
      ).toThrow();
  });
});
