import { createHash } from "node:crypto";
import { S3Client } from "bun";
import {
  parseTrmnlPluginBundle,
  validateTrmnlPluginSettings,
  MAX_TRMNL_PLUGIN_BYTES,
} from "@shepherdjerred/ops-model/trmnl/plugin-policy.ts";
import { parseTrmnlSettings, type createTrmnlPluginClient } from "./trmnl.ts";

export type TrmnlArchiveDescriptor = {
  uri: string;
  digest: string;
  sourceRevision: string;
};
export type TrmnlArchiveReader = (
  artifact: TrmnlArchiveDescriptor,
) => Promise<Uint8Array>;
export function createTrmnlArchiveReader(
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  },
  cancellation?: AbortSignal,
): TrmnlArchiveReader {
  const client = new S3Client({
    ...credentials,
    bucket: "delivery-artifacts",
    region: "us-east-1",
    endpoint: "https://seaweedfs-s3.tailnet-1a49.ts.net",
  });
  return async (artifact) => {
    const key = archiveKey(artifact);
    const reader = client.file(key).stream().getReader();
    const signal =
      cancellation === undefined
        ? AbortSignal.timeout(30_000)
        : AbortSignal.any([cancellation, AbortSignal.timeout(30_000)]);
    const cancel = async () => {
      try {
        await reader.cancel(signal.reason);
      } catch {
        /* The read loop reports the aborted operation; cancellation is cleanup. */
      }
    };
    const abort = () => {
      void cancel();
    };
    signal.addEventListener("abort", abort, { once: true });
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const next = await reader.read();
        signal.throwIfAborted();
        if (next.done) break;
        total += next.value.length;
        if (total > MAX_TRMNL_PLUGIN_BYTES)
          throw new Error("TRMNL immutable bundle exceeds its byte bound");
        chunks.push(next.value);
      }
    } finally {
      signal.removeEventListener("abort", abort);
      await reader.cancel();
    }
    return new Uint8Array(Buffer.concat(chunks));
  };
}
function archiveKey(artifact: TrmnlArchiveDescriptor) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(artifact.digest))
    throw new Error("Invalid TRMNL immutable bundle digest");
  const key = `trmnl-plugins/${artifact.digest.slice(7)}.json`;
  if (artifact.uri !== `s3://delivery-artifacts/${key}`)
    throw new Error("TRMNL archive escaped its fixed content-addressed prefix");
  return key;
}
export async function readTrmnlArchive(
  artifact: TrmnlArchiveDescriptor,
  read: TrmnlArchiveReader,
) {
  archiveKey(artifact);
  const bytes = await read(artifact);
  if (
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
    artifact.digest
  )
    throw new Error(
      "TRMNL selected archive bytes differ from their qualified original digest",
    );
  const bundle = parseTrmnlPluginBundle(bytes);
  if (bundle.sourceRevision !== artifact.sourceRevision)
    throw new Error(
      "TRMNL bundle source differs from its original qualified publication",
    );
  validateTrmnlPluginSettings(bundle, parseTrmnlSettings);
  return bundle;
}

/** Independent GET-only verification shared by API recovery and normal release acceptance. */
export async function inspectTrmnlArchive(
  artifact: TrmnlArchiveDescriptor,
  options: {
    readArchive: TrmnlArchiveReader;
    client: Pick<ReturnType<typeof createTrmnlPluginClient>, "matches">;
  },
) {
  const bundle = await readTrmnlArchive(artifact, options.readArchive);
  for (const plugin of bundle.plugins)
    if (!(await options.client.matches(plugin)))
      throw new Error(
        "Remote TRMNL plugin configuration differs from the exact frozen archive",
      );
  return {
    archiveDigest: artifact.digest,
    sourceRevision: artifact.sourceRevision,
    pluginCount: 3 as const,
  };
}
