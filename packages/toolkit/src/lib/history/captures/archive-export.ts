import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { sha256Hex, type Sealer } from "#lib/brim/sync/crypto.ts";
import { MACHINE_ID_PATTERN } from "#lib/brim/sync/manifest.ts";
import type { ObjectStore } from "#lib/brim/sync/object-store.ts";
import { redactCaptures } from "./redact.ts";
import { CaptureStore } from "./store.ts";

export const CAPTURE_ARCHIVE_PREFIX = "captures/v1/";
export const CAPTURE_ARCHIVE_RETENTION_DAYS = 30;
export const CAPTURE_ARCHIVE_MAX_BYTES = 256 * 1024 ** 2;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
export const CaptureArchiveManifest = z.strictObject({
  version: z.literal(1),
  digest: z.string().regex(/^[a-f\d]{64}$/u),
});

export function captureCutoff(
  now: Date,
  retentionDays = CAPTURE_ARCHIVE_RETENTION_DAYS,
): string {
  return new Date(
    now.getTime() - retentionDays * DAY_MILLISECONDS,
  ).toISOString();
}

export function capturePrefix(machineId: string): string {
  if (!MACHINE_ID_PATTERN.test(machineId)) {
    throw new Error("Invalid Brim capture archive machine id");
  }
  return `${CAPTURE_ARCHIVE_PREFIX}${machineId}/`;
}

export function captureManifestKey(prefix: string): string {
  return `${prefix}manifest.json.age`;
}

export function captureSnapshotKey(prefix: string, digest: string): string {
  return `${prefix}${digest}.sqlite.age`;
}

type ProjectionOptions = {
  readonly sourcePath: string;
  readonly directory: string;
  readonly cutoff: string;
};

async function projectSnapshot(
  options: ProjectionOptions,
): Promise<Uint8Array> {
  const projectedPath = path.join(options.directory, "projected.sqlite");
  const compactPath = path.join(options.directory, "compact.sqlite");
  const source = pathToFileURL(options.sourcePath);
  source.searchParams.set("mode", "ro");
  const projected = await CaptureStore.open(projectedPath);
  try {
    projected.run("ATTACH DATABASE ? AS live", source.href);
    projected.transaction(() => {
      projected.run(
        "INSERT INTO captures SELECT * FROM live.captures WHERE started_at >= ?",
        options.cutoff,
      );
      projected.run(`INSERT INTO capture_blocks
        SELECT blocks.* FROM live.capture_blocks blocks JOIN captures capture
          ON capture.id = blocks.capture_id`);
      projected.run(`INSERT INTO blobs
        SELECT * FROM live.blobs WHERE hash IN (
          SELECT hash FROM capture_blocks
          UNION SELECT envelope_hash FROM captures WHERE envelope_hash IS NOT NULL
          UNION SELECT response_hash FROM captures WHERE response_hash IS NOT NULL
          UNION SELECT raw_request_hash FROM captures WHERE raw_request_hash IS NOT NULL
          UNION SELECT raw_response_hash FROM captures WHERE raw_response_hash IS NOT NULL
        )`);
    });
    projected.run("DETACH DATABASE live");
    await redactCaptures({
      store: projected,
      spoolDir: path.join(options.directory, "unused-spool"),
      dryRun: false,
    });
    // A compact copy drops the freed pages of any blobs replaced during redaction.
    projected.run("VACUUM INTO ?", compactPath);
  } finally {
    projected.close();
  }
  const compact = Bun.file(compactPath);
  if (compact.size > CAPTURE_ARCHIVE_MAX_BYTES) {
    throw new Error("Brim capture snapshot exceeds the 256 MiB archive limit");
  }
  return await compact.bytes();
}

export async function pushCaptureArchive(options: {
  readonly store: ObjectStore;
  readonly seal: Sealer;
  readonly machineId: string;
  readonly sourcePath: string;
  readonly retentionDays: number;
  readonly now?: Date;
}): Promise<number> {
  if (!(await Bun.file(options.sourcePath).exists())) return 0;
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "brim-capture-archive-"),
  );
  try {
    const bytes = await projectSnapshot({
      sourcePath: options.sourcePath,
      directory,
      cutoff: captureCutoff(
        options.now ?? new Date(),
        Math.min(CAPTURE_ARCHIVE_RETENTION_DAYS, options.retentionDays),
      ),
    });
    const prefix = capturePrefix(options.machineId);
    const digest = sha256Hex(bytes);
    const key = captureSnapshotKey(prefix, digest);
    const keys = await options.store.listKeys(prefix);
    let uploadedBytes = 0;
    if (!keys.includes(key)) {
      const sealed = await options.seal(bytes);
      await options.store.put(key, sealed);
      uploadedBytes = sealed.byteLength;
    }
    const manifest = JSON.stringify({ version: 1, digest });
    const manifestKey = captureManifestKey(prefix);
    // Write the commit pointer last. If an earlier run crashed after writing
    // the object, this still publishes it. Superseded blobs are never reachable
    // after this commit and are cleaned even if the snapshot was unchanged.
    await options.store.put(
      manifestKey,
      await options.seal(new TextEncoder().encode(manifest)),
    );
    for (const old of keys) {
      if (old !== key && old.endsWith(".sqlite.age"))
        await options.store.delete(old);
    }
    return uploadedBytes;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
