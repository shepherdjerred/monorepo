import { createHash } from "node:crypto";
import { createTarDecoder } from "modern-tar";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const MIRROR = "https://chartmuseum.sjer.red";
const MAX_BYTES = 16 * 1024 * 1024;
const VERSION = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
const CHART_NAME = z.string().regex(/^[a-z0-9][a-z0-9.-]*$/u);
const EntrySchema = z.object({
  name: z.string(),
  version: z.string(),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  urls: z.array(z.string().min(1)).length(1),
});
export type ChartTransport = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response>;
export type UpstreamChartIntent = {
  name: string;
  version: string;
  /** Helm repository URL from the version catalog; normalised to a trailing slash. */
  repository: string;
};
export type UpstreamChartOptions = {
  /** Copy the archive into ChartMuseum and point the artifact at the copy. */
  mirror: boolean;
  credentials: () => { username: string; password: string };
  transport?: ChartTransport;
};

/** Helm repository URLs resolve `index.yaml` and relative archive URLs against a trailing slash. */
export function helmRepositoryUrl(registryUrl: string): string {
  const url = new URL(registryUrl);
  if (url.protocol !== "https:")
    throw new Error("Upstream Helm repository must be served over HTTPS");
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

async function boundedBytes(response: Response): Promise<Uint8Array> {
  if (!response.ok || response.body === null)
    throw new Error(`Upstream chart read failed (${String(response.status)})`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const value of response.body) {
    const chunk = z.instanceof(Uint8Array).parse(value);
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("Upstream chart exceeds size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Inspect metadata in memory; never execute or extract upstream archive paths. */
async function verifyChart(
  bytes: Uint8Array,
  intent: Pick<UpstreamChartIntent, "name" | "version">,
) {
  const body = new Response(bytes).body;
  if (body === null) throw new Error("Empty upstream chart");
  let found = false;
  let unpacked = 0;
  for await (const entry of body
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(createTarDecoder({ strict: true }))) {
    unpacked += entry.header.size;
    if (unpacked > MAX_BYTES)
      throw new Error("Expanded chart exceeds size limit");
    if (entry.header.name !== `${intent.name}/Chart.yaml`) {
      await entry.body.cancel();
      continue;
    }
    if (
      found ||
      (entry.header.type ?? "file") !== "file" ||
      entry.header.size > 64 * 1024
    )
      throw new Error("Invalid upstream Chart.yaml entry");
    z.object({
      name: z.literal(intent.name),
      version: z.literal(intent.version),
    }).parse(parseYaml(await new Response(entry.body).text()));
    found = true;
  }
  if (!found) throw new Error("Upstream archive has no Chart.yaml");
}

/** Upload once; a racing identical publisher may win, so the exact archive is always read back. */
async function mirrorChart(
  intent: UpstreamChartIntent,
  archive: { bytes: Uint8Array; digest: string },
  options: UpstreamChartOptions,
  transport: ChartTransport,
) {
  const { bytes, digest } = archive;
  const archiveUrl = `${MIRROR}/charts/${intent.name}-${intent.version}.tgz`;
  const existing = await transport(archiveUrl, {
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  if (existing.status === 404) {
    const credentials = options.credentials();
    const uploaded = await transport(`${MIRROR}/api/charts`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: {
        "Content-Type": "application/octet-stream",
        Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
      },
      body: bytes,
    });
    if (!uploaded.ok && uploaded.status !== 409)
      throw new Error(
        `Chart mirror upload failed (${String(uploaded.status)})`,
      );
    const mirrored = await boundedBytes(
      await transport(archiveUrl, {
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      }),
    );
    if (createHash("sha256").update(mirrored).digest("hex") !== digest)
      throw new Error("Uploaded chart mirror checksum mismatch");
  } else {
    const mirrored = await boundedBytes(existing);
    if (createHash("sha256").update(mirrored).digest("hex") !== digest)
      throw new Error("Immutable chart mirror conflicts with upstream bytes");
  }
  return archiveUrl;
}

/**
 * Verify the exact pinned chart against its Helm repository index and return
 * the artifact identity Delivery acquires. The upstream archive URL is the
 * artifact URI (X11) unless the chart is still mirrored into ChartMuseum.
 */
export async function acquireUpstreamChart(
  intent: UpstreamChartIntent,
  options: UpstreamChartOptions,
) {
  const name = CHART_NAME.parse(intent.name);
  const version = VERSION.parse(intent.version);
  const repository = helmRepositoryUrl(intent.repository);
  const transport = options.transport ?? fetch;
  const request = (url: string | URL) =>
    transport(url, { signal: AbortSignal.timeout(60_000), redirect: "follow" });
  const rawIndex = await boundedBytes(
    await request(new URL("index.yaml", repository)),
  );
  const index = z
    .object({ entries: z.record(z.string(), z.array(EntrySchema)) })
    .parse(parseYaml(new TextDecoder().decode(rawIndex)));
  const matches = (index.entries[name] ?? []).filter(
    (entry) => entry.version === version,
  );
  if (matches.length !== 1)
    throw new Error("Pinned upstream chart version must occur exactly once");
  const selected = EntrySchema.extend({ name: z.literal(name) }).parse(
    matches[0],
  );
  const archive = new URL(selected.urls[0] ?? "", repository);
  if (archive.protocol !== "https:")
    throw new Error("Upstream chart archive must be served over HTTPS");
  const bytes = await boundedBytes(await request(archive));
  if (createHash("sha256").update(bytes).digest("hex") !== selected.digest)
    throw new Error("Upstream chart checksum mismatch");
  await verifyChart(bytes, { name, version });
  const uri = options.mirror
    ? await mirrorChart(
        { name, version, repository },
        { bytes, digest: selected.digest },
        options,
        transport,
      )
    : archive.href;
  return {
    name,
    revision: version,
    uri,
    digest: `sha256:${selected.digest}`,
    origin: {
      kind: "upstream" as const,
      repository,
      name,
      version,
      checksum: `sha256:${selected.digest}`,
    },
  };
}
