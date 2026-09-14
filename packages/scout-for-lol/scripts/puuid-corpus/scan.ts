/**
 * Walking both raw prefixes of a bucket with bounded concurrency.
 *
 * Shared by the inventory pass and the rewrite pass, which differ only in what
 * they do with each object. Both read the whole corpus — 77k objects and 61 GiB
 * on prod — so the traversal is worth having in one place with one set of
 * progress reporting and one failure policy.
 */

import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  classifyRawObjectKey,
  enumerateRawObjects,
} from "@scout-for-lol/backend/report-store/s3-raw-source.ts";

/**
 * `other` is the important one. `classifyRawObjectKey` answers a narrower
 * question than this pass asks — it names the objects the report lake rebuilds
 * from, not the objects that contain identities. Auditing the buckets by
 * content found five shapes it ignores that hold PUUIDs anyway:
 * `failed-validations/**\/match.json` in both environments, and beta's
 * `ai-pipeline` match and timeline summaries and `prediction-observation.json`
 * — roughly 6,900 objects. Trusting the classifier would have stranded every
 * identity that appears only in those.
 */
export type RawObject = {
  key: string;
  kind: "match" | "timeline" | "prematch" | "other";
  lastModified: Date | undefined;
};

/**
 * Extensions that cannot carry an identity, and are expensive to prove innocent.
 *
 * Report renders embed base64 PNG data, which matches a PUUID's shape closely
 * enough to fool a regex — sampled SVGs hit on shape every time and contained a
 * real mapped identity zero times out of eight. They are also 26 GiB of the prod
 * bucket, so reading them to reach that conclusion object by object would
 * dominate the run.
 */
const BINARY_SUFFIXES = [".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif"];

function isBinary(key: string): boolean {
  const lower = key.toLocaleLowerCase("en-US");
  return BINARY_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * Every object in a bucket that could hold an identity.
 *
 * Deliberately the WHOLE bucket rather than the two prefixes the lake rebuilds
 * from. Identities turn up under `failed-validations/` and in AI pipeline
 * output, and a pass that enumerates by expected prefix silently leaves them in
 * the old domain — which is unrecoverable once the old key is retired.
 *
 * Narrowing to a prefix scopes a run to part of the archive — a single month, a
 * single game — which is how a failed slice gets retried without re-reading the
 * whole corpus, and how a change gets proven against real objects before it is
 * pointed at 35 GiB of them.
 */
export async function listRawObjects(
  client: S3Client,
  bucket: string,
  prefix?: string,
): Promise<RawObject[]> {
  const objects: RawObject[] = [];
  for await (const ref of enumerateRawObjects(client, bucket, prefix ?? "")) {
    if (isBinary(ref.key)) {
      continue;
    }
    const classified = classifyRawObjectKey(ref.key);
    objects.push({
      key: ref.key,
      kind: classified === "ignored" ? "other" : classified,
      lastModified: ref.lastModified,
    });
  }
  return objects;
}

/** An object's body together with the user metadata stored beside it. */
export type FetchedObject = {
  body: string;
  metadata: Record<string, string>;
};

/**
 * Read a body AND the metadata stored with it, in one request.
 *
 * The metadata is what lets a re-run tell an object this migration already
 * rewrote from one it has never touched. Without it a re-run cannot repair its
 * own interrupted work: a rewritten object carries no old identifier, so by
 * content it is indistinguishable from one that never needed changing.
 */
export async function fetchObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<FetchedObject> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const body = await (response.Body === undefined
    ? Promise.resolve("")
    : response.Body.transformToString());
  return { body, metadata: response.Metadata ?? {} };
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
  visit: (
    object: RawObject,
    fetched: FetchedObject,
  ) => Promise<boolean> | boolean,
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
        const fetched = await fetchObject(client, options.bucket, object.key);
        if (await visit(object, fetched)) {
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
