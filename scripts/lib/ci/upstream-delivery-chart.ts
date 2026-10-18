import { createHash } from "node:crypto";
import { createTarDecoder } from "modern-tar";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const UPSTREAM = "https://itzg.github.io/minecraft-server-charts/";
const MIRROR = "https://chartmuseum.sjer.red";
const MAX_BYTES = 16 * 1024 * 1024;
const EntrySchema = z.object({
  name: z.literal("minecraft"),
  version: z.string(),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  urls: z.array(z.url()).length(1),
});
type Transport = (url: string | URL, init?: RequestInit) => Promise<Response>;

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
async function verifyChart(bytes: Uint8Array, version: string) {
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
    if (entry.header.name !== "minecraft/Chart.yaml") {
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
      name: z.literal("minecraft"),
      version: z.literal(version),
    }).parse(parseYaml(await new Response(entry.body).text()));
    found = true;
  }
  if (!found) throw new Error("Upstream archive has no Chart.yaml");
}

/** Mirror the exact pinned upstream chart, refusing an existing version with different bytes. */
export async function mirrorMinecraftChart(
  version: string,
  credentials: { username: string; password: string },
  transport: Transport = fetch,
) {
  z.string()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
    .parse(version);
  const request = (url: string | URL) =>
    transport(url, { signal: AbortSignal.timeout(60_000), redirect: "follow" });
  const rawIndex = await boundedBytes(
    await request(new URL("index.yaml", UPSTREAM)),
  );
  const index = z
    .object({ entries: z.object({ minecraft: z.array(EntrySchema) }) })
    .parse(parseYaml(new TextDecoder().decode(rawIndex)));
  const matches = index.entries.minecraft.filter(
    (entry) => entry.version === version,
  );
  if (matches.length !== 1)
    throw new Error("Pinned upstream chart version must occur exactly once");
  const selected = EntrySchema.parse(matches[0]);
  const source = `https://github.com/itzg/minecraft-server-charts/releases/download/minecraft-${version}/minecraft-${version}.tgz`;
  if (selected.urls[0] !== source)
    throw new Error(
      "Upstream archive URL differs from the reviewed release location",
    );
  const bytes = await boundedBytes(await request(source));
  if (createHash("sha256").update(bytes).digest("hex") !== selected.digest)
    throw new Error("Upstream chart checksum mismatch");
  await verifyChart(bytes, version);

  const archiveUrl = `${MIRROR}/charts/minecraft-${version}.tgz`;
  const existing = await transport(archiveUrl, {
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  if (existing.status === 404) {
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
    // A racing identical publisher may win; always verify the exact archive.
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
    if (createHash("sha256").update(mirrored).digest("hex") !== selected.digest)
      throw new Error("Uploaded chart mirror checksum mismatch");
  } else {
    const mirrored = await boundedBytes(existing);
    if (createHash("sha256").update(mirrored).digest("hex") !== selected.digest)
      throw new Error("Immutable chart mirror conflicts with upstream bytes");
  }
  return {
    name: "minecraft" as const,
    revision: version,
    uri: archiveUrl,
    digest: `sha256:${selected.digest}`,
    origin: {
      kind: "upstream" as const,
      repository: UPSTREAM,
      name: "minecraft",
      version,
      checksum: `sha256:${selected.digest}`,
    },
  };
}
