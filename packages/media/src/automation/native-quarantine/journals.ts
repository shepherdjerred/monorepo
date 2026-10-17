import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import type { JournalProof } from "#automation/handoff/journals.ts";
import type { NativeQuarantineScope } from "#shared/native-recovery/quarantine.ts";
import type { Database } from "#infrastructure/database.ts";
import type { QuarantineParticipant } from "./paths.ts";

/** Full selected inventory was captured before this exact completed-effect binding is selected. */
export async function originalQuarantineOperation(input: {
  db: Database;
  scope: NativeQuarantineScope;
  journal: JournalProof;
  participant: QuarantineParticipant;
  canonical: string;
  quarantined: string;
}) {
  const matches = [];
  for (const file of input.journal.files) {
    const manifest = ManifestSchema.parse(
      JSON.parse(await readFile(file.target, "utf8")),
    );
    if (
      manifest.kind === "quarantine" &&
      manifest.source === input.canonical &&
      manifest.target === input.quarantined &&
      manifest.sha256 === input.participant.checksum &&
      manifest.previousSha256 === null &&
      manifest.phase === "complete"
    )
      matches.push(manifest);
  }
  const match = matches[0];
  if (match === undefined || matches.length !== 1)
    throw new Error(
      "Quarantine participant lacks one exact completed move journal",
    );
  const suffix = `-quarantine-${input.participant.quarantineId}`;
  if (!match.operationId.endsWith(suffix))
    throw new Error(
      "Quarantine journal is not an application removal operation",
    );
  const operationId = z
    .uuid()
    .parse(match.operationId.slice(0, -suffix.length));
  const operation = await input.db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const payload = z
    .object({ mediaId: z.uuid(), generation: z.int().nonnegative() })
    .parse(operation.payload);
  const group = input.scope.groups.find((item) =>
    item.assetIds.includes(input.participant.assetId),
  );
  if (
    operation.kind !== "retain_media" ||
    group?.decisions.some(
      (decision) =>
        decision.mediaId === payload.mediaId &&
        decision.generation === payload.generation,
    ) !== true
  )
    throw new Error(
      "Quarantine journal does not belong to the committed decision group",
    );
  return match.operationId;
}
