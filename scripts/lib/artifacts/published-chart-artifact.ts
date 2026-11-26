import { createHash } from "node:crypto";
import { z } from "zod";
import {
  registryLocation,
  resolveManifestDigest,
} from "@shepherdjerred/delivery/oci-registry";

export type ChartFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function downloadChartArtifact(
  name: string,
  version: string,
  options: { origin: string; fetch?: ChartFetch },
) {
  const transport = options.fetch ?? fetch;
  const response = await transport(
    new URL(
      `/api/charts/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      options.origin,
    ),
    { signal: AbortSignal.timeout(30_000), redirect: "error" },
  );
  if (!response.ok)
    throw new Error(
      `Chart metadata unavailable for ${name}@${version} (${String(response.status)})`,
    );
  const raw: unknown = await response.json();
  const metadata = z
    .object({
      name: z.literal(name),
      version: z.literal(version),
      digest: z.string().regex(/^[a-f\d]{64}$/u),
      urls: z.array(z.string()).min(1),
    })
    .parse(raw);
  const uri = new URL(`/charts/${name}-${version}.tgz`, options.origin);
  if (
    !metadata.urls.some(
      (entry) => new URL(entry, `${options.origin}/`).href === uri.href,
    )
  )
    throw new Error(
      `Chart archive URL differs from the selected immutable version: ${name}@${version}`,
    );
  const archive = await transport(uri, {
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  if (!archive.ok)
    throw new Error(
      `Chart archive unavailable for ${name}@${version} (${String(archive.status)})`,
    );
  const digest = createHash("sha256")
    .update(new Uint8Array(await archive.arrayBuffer()))
    .digest("hex");
  if (digest !== metadata.digest)
    throw new Error(`Chart archive checksum mismatch for ${name}@${version}`);
  return { uri: uri.href, digest: `sha256:${digest}` };
}

export async function resolvePublishedChartArtifact(
  name: string,
  version: string,
  options: { origin?: string; fetch?: ChartFetch } = {},
) {
  const transport = options.fetch ?? fetch;
  if (name === "charts-bootstrap") {
    const digest = await resolveManifestDigest(
      registryLocation(
        "https://registry-1.docker.io",
        "shepherdjerred/charts-bootstrap",
      ),
      version,
      transport,
    );
    return {
      uri: "oci://registry-1.docker.io/shepherdjerred/charts-bootstrap",
      digest,
    };
  }
  return downloadChartArtifact(name, version, {
    origin: options.origin ?? "https://charts.tailnet-1a49.ts.net",
    fetch: transport,
  });
}
