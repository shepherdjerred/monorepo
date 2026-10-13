import { createHash } from "node:crypto";
import { createTarDecoder, type ParsedTarEntry } from "modern-tar";
import { z } from "zod";

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const DescriptorSchema = z.object({
  digest: DigestSchema,
  mediaType: z.string(),
});
const configPath = "plugins/TheStorm/config.yml";
const whiteouts = new Set([
  ".wh.plugins",
  ".wh..wh..opq",
  "plugins/.wh.TheStorm",
  "plugins/.wh..wh..opq",
  "plugins/TheStorm/.wh.config.yml",
  "plugins/TheStorm/.wh..wh..opq",
]);
const manifestTypes = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export type RegistryFetch = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response>;

async function checkedResponse(
  fetcher: RegistryFetch,
  url: URL,
  headers: Record<string, string> = {},
): Promise<Response> {
  const response = await fetcher(url, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(
      `Storm image ${url.pathname} returned HTTP ${response.status.toString()}`,
    );
  return response;
}

function verifyDigest(bytes: Uint8Array, digest: string): void {
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== digest)
    throw new Error(`Storm image digest mismatch: ${digest}`);
}

/** Read only the exact image's file; never execute image code or extract a tar to disk. */
async function imageLayers(
  digest: string,
  readVerified: (
    kind: "manifests" | "blobs",
    sha: string,
  ) => Promise<Uint8Array>,
): Promise<z.infer<typeof DescriptorSchema>[]> {
  let manifest: unknown = JSON.parse(
    new TextDecoder().decode(await readVerified("manifests", digest)),
  );
  const index = z
    .object({
      manifests: z.array(
        DescriptorSchema.extend({
          platform: z
            .object({ os: z.string(), architecture: z.string() })
            .optional(),
        }),
      ),
    })
    .safeParse(manifest);
  if (index.success) {
    const matches = index.data.manifests.filter(
      (entry) =>
        entry.platform?.os === "linux" &&
        entry.platform.architecture === "amd64",
    );
    if (matches.length !== 1 || matches[0] === undefined)
      throw new Error(
        "Storm image must contain exactly one linux/amd64 manifest",
      );
    manifest = JSON.parse(
      new TextDecoder().decode(
        await readVerified("manifests", matches[0].digest),
      ),
    );
  }
  return z.object({ layers: z.array(DescriptorSchema) }).parse(manifest).layers;
}

function layerBody(
  bytes: Uint8Array,
  mediaType: string,
): ReadableStream<Uint8Array> {
  const body = new Response(bytes).body;
  if (body === null) throw new Error("Storm image layer has no body");
  if (
    mediaType === "application/vnd.oci.image.layer.v1.tar+gzip" ||
    mediaType === "application/vnd.docker.image.rootfs.diff.tar.gzip"
  )
    return body.pipeThrough(new DecompressionStream("gzip"));
  if (mediaType !== "application/vnd.oci.image.layer.v1.tar")
    throw new Error(`Unsupported Storm image layer type: ${mediaType}`);
  return body;
}

async function readConfigEntry(entry: ParsedTarEntry): Promise<Uint8Array> {
  if ((entry.header.type ?? "file") !== "file")
    throw new Error("Storm image module config must be a regular file");
  if (entry.header.size > 64 * 1024)
    throw new Error("Storm image module config exceeds 64 KiB");
  return new Uint8Array(await new Response(entry.body).arrayBuffer());
}

function removesConfig(
  name: string,
  type: ParsedTarEntry["header"]["type"],
): boolean {
  return (
    whiteouts.has(name) ||
    ((name === "plugins" || name === "plugins/TheStorm") &&
      type !== "directory")
  );
}

async function configFromLayer(
  bytes: Uint8Array,
  mediaType: string,
): Promise<Uint8Array | undefined> {
  let config: Uint8Array | undefined;
  let removed = false;
  for await (const entry of layerBody(bytes, mediaType).pipeThrough(
    createTarDecoder({ strict: true }),
  )) {
    const name = entry.header.name
      .replace(/^(?:\.\/)+/u, "")
      .replace(/\/$/u, "");
    if (name === configPath) {
      config = await readConfigEntry(entry);
    } else {
      removed = removed || removesConfig(name, entry.header.type);
      await entry.body.cancel();
    }
  }
  // An opaque directory may carry its replacement config in this same layer.
  if (config === undefined && removed)
    throw new Error("Storm image module config was removed by a layer");
  return config;
}

export async function readStormImageConfig(
  digest: string,
  fetcher: RegistryFetch = fetch,
): Promise<Uint8Array> {
  DigestSchema.parse(digest);
  const base = new URL("https://ghcr.io/v2/shepherdjerred/the-storm-server/");
  const tokenUrl = new URL("https://ghcr.io/token");
  tokenUrl.searchParams.set("service", "ghcr.io");
  tokenUrl.searchParams.set(
    "scope",
    "repository:shepherdjerred/the-storm-server:pull",
  );
  const tokenResponse = await checkedResponse(fetcher, tokenUrl);
  const { token } = z
    .object({ token: z.string().min(1) })
    .parse(await tokenResponse.json());
  const headers = { Authorization: `Bearer ${token}`, Accept: manifestTypes };
  const readVerified = async (kind: "manifests" | "blobs", sha: string) => {
    const response = await checkedResponse(
      fetcher,
      new URL(`${kind}/${sha}`, base),
      headers,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    verifyDigest(bytes, sha);
    return bytes;
  };
  const layers = await imageLayers(digest, readVerified);
  for (const layer of layers.toReversed()) {
    const config = await configFromLayer(
      await readVerified("blobs", layer.digest),
      layer.mediaType,
    );
    if (config !== undefined) return config;
  }
  throw new Error("Storm image has no /plugins/TheStorm/config.yml");
}

export function snapshotStormImageConfig(bytes: Uint8Array): {
  configSha256: string;
  moduleKeys: string[];
} {
  const config = z
    .object({ modules: z.record(z.string().min(1), z.boolean()) })
    .strict()
    .parse(
      Bun.YAML.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  const moduleKeys = Object.keys(config.modules);
  if (moduleKeys.length === 0)
    throw new Error("Storm image module config is empty");
  return {
    configSha256: createHash("sha256").update(bytes).digest("hex"),
    moduleKeys,
  };
}
