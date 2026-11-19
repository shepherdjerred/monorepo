import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import { lockCommandActor } from "#infrastructure/editions/command-actor.ts";
import {
  ImportedPersonalClaimSchema,
  ImportedPersonalClaimsSchema,
} from "#shared/personal-migration/contract.ts";

/** Imported source consent stays visible while native interest/choice changes
 * remain authoritative. Members receive only their own genuine request rows. */
export async function importedPersonalClaims(db: Database, actor: MediaActor) {
  return db.$transaction(
    async (tx) => {
      const current = await lockCommandActor(tx, actor);
      const requests = await tx.mediaRequest.findMany({
        where:
          current.role === "owner" && !current.restricted
            ? {}
            : { userId: current.id },
        select: {
          id: true,
          userId: true,
          movieEditionChoiceId: true,
          active: true,
          mediaId: true,
          edition: true,
        },
        take: 50_001,
      });
      if (requests.length > 50_000)
        throw new MediaError(
          "migration_limit",
          "Imported request view exceeds its bounded household inventory",
          422,
        );
      const receipts = await tx.applicationEvent.findMany({
        where: { kind: "personal_state_imported" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1001,
      });
      if (receipts.length > 1000)
        throw new MediaError(
          "migration_limit",
          "Imported source history exceeds its bounded review limit",
          422,
        );
      const requestIds = new Map(requests.map((row) => [row.id, row]));
      const selected = new Map<
        string,
        z.infer<typeof ImportedPersonalClaimSchema> & {
          sourceKind: string;
          sourceFulfilled: boolean;
        }
      >();
      for (const receipt of receipts) {
        const payload = z
          .object({
            imports: z.array(ImportedPersonalClaimSchema).max(1000),
            captures: z
              .array(z.object({ id: z.uuid(), sourceKind: z.string() }))
              .max(20),
          })
          .parse(receipt.payload);
        for (const imported of payload.imports) {
          const request = requestIds.get(imported.requestId);
          if (
            request?.userId !== imported.userId ||
            request.mediaId !== imported.mediaId ||
            request.edition !== imported.edition ||
            selected.has(imported.requestId)
          )
            continue;
          const source = payload.captures.find(
            (row) => row.id === imported.captureId,
          );
          if (source === undefined)
            throw new Error("Imported claim lost its immutable source capture");
          selected.set(imported.requestId, {
            ...imported,
            sourceKind: source.sourceKind,
            sourceFulfilled: imported.sourceStatus === 5,
            needsAcquisitionChoice:
              imported.needsAcquisitionChoice &&
              request.active &&
              request.movieEditionChoiceId === null,
          });
        }
      }
      return ImportedPersonalClaimsSchema.parse([...selected.values()]);
    },
    { isolationLevel: "RepeatableRead" },
  );
}
