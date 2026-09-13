/**
 * Walking both raw prefixes of a bucket with bounded concurrency.
 *
 * Shared by the inventory pass and the rewrite pass, which differ only in what
 * they do with each object. Both read the whole corpus — 77k objects and 61 GiB
 * on prod — so the traversal is worth having in one place with one set of
 * progress reporting and one failure policy.
 */

import type { S3Client } from "@aws-sdk/client-s3";
import {
  classifyRawObjectKey,
  enumerateRawObjects,
  MATCH_PREFIX,
  PREMATCH_PREFIX,
  type RawObjectKind,
  readRawObjectText,
} from "@scout-for-lol/backend/report-store/s3-raw-source.ts";

export type RawObject = {
  key: string;
  kind: Exclude<RawObjectKind, "ignored">;
  lastModified: Date | undefined;
};

/** Every match, timeline and prematch object in a bucket. */
export async function listRawObjects(
  client: S3Client,
  bucket: string,
): Promise<RawObject[]> {
  const objects: RawObject[] = [];
  for (const prefix of [MATCH_PREFIX, PREMATCH_PREFIX]) {
    for await (const ref of enumerateRawObjects(client, bucket, prefix)) {
      const kind = classifyRawObjectKey(ref.key);
      if (kind !== "ignored") {
        objects.push({ key: ref.key, kind, lastModified: ref.lastModified });
      }
    }
  }
  return objects;
}

export type ScanReport = {
  read: number;
  skipped: number;
  failed: number;
};

/**
 * Run `visit` over every object, `concurrency` at a time.
 *
 * A visitor returning false counts as skipped rather than read, which is how
 * the rewrite reports the objects it left untouched.
 *
 * One object failing does not stop the pass. A corpus-wide job that aborts on a
 * single unreadable key would have to be restarted from the beginning, and both
 * passes are built to be re-run — so failures are counted, named, and
 * surfaced at the end, where a non-zero count is the caller's signal to look.
 */
export async function scanObjects(
  client: S3Client,
  objects: readonly RawObject[],
  visit: (object: RawObject, body: string) => Promise<boolean> | boolean,
  options: { bucket: string; label: string; concurrency?: number | undefined },
): Promise<ScanReport> {
  const report: ScanReport = { read: 0, skipped: 0, failed: 0 };
  const failures: string[] = [];
  let index = 0;
  let done = 0;
  const started = Date.now();

  const worker = async (): Promise<void> => {
    for (;;) {
      const at = index++;
      const object = objects[at];
      if (object === undefined) {
        return;
      }
      try {
        const body = await readRawObjectText(
          client,
          options.bucket,
          object.key,
        );
        if (await visit(object, body)) {
          report.read++;
        } else {
          report.skipped++;
        }
      } catch (error) {
        report.failed++;
        if (failures.length < 20) {
          failures.push(`${object.key} (${String(error)})`);
        }
      }
      done++;
      if (done % 5000 === 0) {
        const rate = done / ((Date.now() - started) / 1000);
        const remaining = Math.round(
          (objects.length - done) / Math.max(rate, 0.001),
        );
        console.log(
          `  ${options.label}: ${done.toString()}/${objects.length.toString()} ` +
            `(${rate.toFixed(0)}/s, ~${Math.ceil(remaining / 60).toString()} min left)`,
        );
      }
    }
  };

  await Promise.all(
    Array.from({ length: options.concurrency ?? 24 }, () => worker()),
  );

  if (failures.length > 0) {
    console.error(
      `  ${report.failed.toString()} objects could not be read:\n` +
        failures.map((f) => `    ${f}`).join("\n"),
    );
  }
  return report;
}
