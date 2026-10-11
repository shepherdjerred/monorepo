import path from "node:path";
import { z } from "zod";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("report-lake-build-manifest");

/**
 * A published build's `manifest.json`, read back by the compactor.
 *
 * Only the fields a later run actually consults are declared; the manifest also
 * carries row counts and `builtAt` for operators, which nothing reads back.
 */
const BuildManifestSchema = z.looseObject({
  schemaFingerprint: z.string().min(1).optional(),
});

/**
 * The lake column fingerprint a published build was written at, or undefined
 * when that cannot be established.
 *
 * Undefined is a real answer rather than an error being swallowed. Builds
 * published before the fingerprint existed carry no such field, and `Bun.write`
 * is not atomic, so a crash mid-write can leave a truncated file. Both mean the
 * same thing — we cannot prove the published parquet matches the current schema
 * — and the caller's response is a full rebuild, which is the safe and
 * self-correcting direction. Reporting a fingerprint we did not actually read
 * would be the dangerous failure.
 */
export async function readBuildFingerprint(
  buildDir: string,
): Promise<string | undefined> {
  const file = Bun.file(path.join(buildDir, "manifest.json"));
  if (!(await file.exists())) {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = await file.json();
  } catch (error) {
    logger.warn(
      `Published build manifest at ${buildDir} could not be parsed; treating its lake schema as unknown`,
      error,
    );
    return undefined;
  }
  const parsed = BuildManifestSchema.safeParse(raw);
  return parsed.success ? parsed.data.schemaFingerprint : undefined;
}
