import type { Prisma } from "#generated/prisma/client.ts";
import type { z } from "zod";
import type {
  BundleReportSchema,
  MigrationSelectionSchema,
} from "#shared/migration-handoff.ts";
import { MediaError } from "#application/errors.ts";

const conflict = (code: string) =>
  new MediaError(
    code,
    "Handoff selection requires a fresh explicit review",
    409,
  );

/** Explicit selected descendants may use an approved canonical series/season scope. */
export async function selectedHandoffEntries(
  tx: Prisma.TransactionClient,
  input: {
    report: z.infer<typeof BundleReportSchema>;
    approved: z.infer<typeof MigrationSelectionSchema>;
    selected: z.infer<typeof MigrationSelectionSchema>;
  },
) {
  const approvedMedia = new Set(
    input.report.entries
      .filter((entry) =>
        input.approved.some(
          (item) =>
            item.provenanceKey === entry.provenanceKey &&
            item.evidenceHash === entry.observationHash,
        ),
      )
      .flatMap((entry) => entry.mediaIds),
  );
  const selected = input.selected.map((selection) => {
    const entry = input.report.entries.find(
      (item) =>
        item.provenanceKey === selection.provenanceKey &&
        item.observationHash === selection.evidenceHash,
    );
    if (entry === undefined) throw conflict("handoff_selection_changed");
    return entry;
  });
  const ids = [...new Set(selected.flatMap((entry) => entry.mediaIds))];
  if (
    ids.length > 100 ||
    new Set(input.selected.map((item) => item.provenanceKey)).size !==
      selected.length
  )
    throw conflict("handoff_selection_exceeds_bound");
  const media = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: { parent: { include: { parent: true } } },
  });
  const authorized = new Set(
    media
      .filter((item) =>
        [item.id, item.parent?.id, item.parent?.parent?.id].some(
          (id) => id !== undefined && approvedMedia.has(id),
        ),
      )
      .map((item) => item.id),
  );
  for (const entry of selected) {
    if (
      entry.kind !== "torrent" &&
      (entry.confidence !== "exact" ||
        entry.mediaIds.length === 0 ||
        entry.mediaIds.some((id) => !authorized.has(id)))
    )
      throw conflict("handoff_scope_expansion_requires_review");
  }
  return selected;
}
