import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { requireEnv } from "@shepherdjerred/root-scripts/lib/run.ts";
import { SEAWEEDFS_ENDPOINT } from "@shepherdjerred/root-scripts/lib/seaweedfs.ts";
import { createS3Client } from "#src/storage/s3-client.ts";

export function createReplayPublicationClient() {
  return createS3Client({
    endpoint: SEAWEEDFS_ENDPOINT,
    region: "us-east-1",
    credentials: {
      accessKeyId: requireEnv("SEAWEEDFS_SITES_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("SEAWEEDFS_SITES_SECRET_ACCESS_KEY"),
    },
  });
}

export async function withReplayPublicationScratch<T>(
  run: (directory: string) => Promise<T>,
): Promise<T> {
  const root = await realpath(tmpdir());
  const directory = await mkdtemp(path.join(root, "scout-replay-publication-"));
  try {
    return await run(directory);
  } finally {
    await removeScratch(directory, root);
  }
}

async function removeScratch(directory: string, root: string) {
  if (path.dirname(await realpath(directory)) !== root)
    throw new Error("Replay publication scratch directory escaped its root");
  await rm(directory, { recursive: true, force: true });
}
