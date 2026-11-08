import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { command } from "./process.ts";
import type { BlobStore } from "./store.ts";
import { digest } from "./store.ts";

/** AWS's configured profile owns credential resolution; credentials never enter manifests. */
async function workspace<T>(action: (file: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mc-capture-store-"));
  try {
    return await action(path.join(dir, "blob"));
  } finally {
    await rm(dir, { recursive: true });
  }
}
export function awsStore(bucket: string, profile = "seaweedfs"): BlobStore {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket))
    throw new Error("Invalid fixture bucket");
  const base = ["aws", "--profile", profile, "s3api"];
  const read = (key: string) =>
    workspace(async (file) => {
      await command([
        ...base,
        "get-object",
        "--bucket",
        bucket,
        "--key",
        key,
        file,
      ]);
      return new Uint8Array(await Bun.file(file).arrayBuffer());
    });
  return {
    read,
    write: (key, bytes) =>
      workspace(async (file) => {
        await Bun.write(file, bytes);
        try {
          await command([
            ...base,
            "put-object",
            "--bucket",
            bucket,
            "--key",
            key,
            "--body",
            file,
            "--if-none-match",
            "*",
          ]);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/PreconditionFailed|\(412\)/u.test(error.message)
          )
            throw error;
          if (digest(await read(key)) !== digest(bytes))
            throw new Error("Immutable fixture key collision", {
              cause: error,
            });
        }
      }),
  };
}
