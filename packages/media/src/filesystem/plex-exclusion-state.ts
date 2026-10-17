import { createHash } from "node:crypto";
import { constants, open, rename, unlink } from "node:fs/promises";
import { z } from "zod";
import { exists, safePath, syncDirectory } from "./operations-io.ts";
import type { PlexExclusionPlan } from "#shared/plex-exclusion.ts";

const IdentitySchema = z.object({
  dev: z.string(),
  ino: z.string(),
  mtimeNs: z.string(),
  ctimeNs: z.string(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const ProbeJournalSchema = z.object({
  videoBase64: z.string().max(4 * 1024 * 1024),
  probeSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  markersCompleted: z.boolean(),
  positiveIntent: z.boolean(),
  negativeIntent: z.boolean(),
  positive: IdentitySchema.nullable(),
  negative: IdentitySchema.nullable(),
  stagedAt: z.iso.datetime().nullable(),
  cleanedAt: z.iso.datetime().nullable(),
  positiveRemoved: z.boolean(),
  negativeRemoved: z.boolean(),
});
export type ProbeJournal = z.infer<typeof ProbeJournalSchema>;
export type ProbeFileIdentity = z.infer<typeof IdentitySchema>;
const DurableSchema = z.object({
  planDigest: z.string(),
  journal: ProbeJournalSchema,
});
function planDigest(plan: PlexExclusionPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

/** Called only under the shared exclusion flock. Local evidence survives PG rollback. */
export async function readProbeJournal(
  plan: PlexExclusionPlan,
  fallback: ProbeJournal,
): Promise<ProbeJournal> {
  const path = await safePath(
    plan.controlRoot,
    `exclusion-${plan.runId}.json`,
    false,
  );
  if (!(await exists(path))) return fallback;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024)
      throw new Error("Unsafe exclusion journal");
    const result = DurableSchema.parse(
      JSON.parse(await handle.readFile("utf8")),
    );
    if (
      result.planDigest !== planDigest(plan) ||
      result.journal.probeSha256 !== fallback.probeSha256
    )
      throw new Error("Exclusion journal belongs to another plan");
    return result.journal;
  } finally {
    await handle.close();
  }
}

export async function saveProbeJournal(
  plan: PlexExclusionPlan,
  journal: ProbeJournal,
): Promise<void> {
  const path = await safePath(
    plan.controlRoot,
    `exclusion-${plan.runId}.json`,
    false,
  );
  const temporary = `${path}.pending`;
  if (await exists(temporary)) {
    await safePath(
      plan.controlRoot,
      `exclusion-${plan.runId}.json.pending`,
      false,
    );
    await unlink(temporary);
  }
  const handle = await open(
    temporary,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(
      JSON.stringify({ planDigest: planDigest(plan), journal }),
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  await syncDirectory(plan.controlRoot);
}
