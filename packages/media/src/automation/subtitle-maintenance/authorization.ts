import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";

/** An automatic policy authorization is distinctly journaled. It does not set
 * human approvedBy/approvedAt fields or manufacture an acknowledgement. */
export async function assertAutomaticSubtitleAuthorizationV1(
  tx: Prisma.TransactionClient,
  context: FileContext,
  input: {
    replacementId: string;
    snapshotHash: string;
    observationHash: string;
  },
) {
  if (
    context.enabled.subtitleMaintenance === undefined ||
    !(await context.enabled.subtitleMaintenance())
  )
    throw new FileGuardError("subtitle_maintenance_disabled");
  const event = await tx.applicationEvent.findUnique({
    where: {
      dedupeKey: `subtitle-automatic-authorization:${input.replacementId}`,
    },
  });
  if (event === null)
    throw new FileGuardError("subtitle_replacement_approval_expired");
  const body = z
    .object({
      replacementId: z.literal(input.replacementId),
      snapshotHash: z.literal(input.snapshotHash),
      observationHash: z.literal(input.observationHash),
      operationId: z.uuid(),
      expiresAt: z.iso.datetime(),
      policy: z.literal("bazarr-personal-v1"),
    })
    .parse(event.payload);
  const replacement = await tx.subtitleReplacement.findUniqueOrThrow({
    where: { id: input.replacementId },
  });
  const owner = await tx.mediaUser.findUniqueOrThrow({
    where: { id: replacement.ownerId },
  });
  context.movieManagement?.budget.consume(3);
  if (
    event.kind !== "subtitle_automatic_upgrade_authorized_v1" ||
    event.actorId !== owner.id ||
    owner.role !== "owner" ||
    owner.restricted ||
    Date.parse(body.expiresAt) <= Date.now() ||
    replacement.state !== "applying" ||
    !replacement.reservationActive
  )
    throw new FileGuardError("subtitle_automatic_authorization_changed");
  const proof =
    await tx.$queryRaw`SELECT media_subtitle_automatic_authorization_valid_v1(r,v) AS valid FROM "SubtitleReplacement" r JOIN "SubtitleReplacementReview" v ON v."replacementId"=r.id WHERE r.id=${input.replacementId}`;
  context.movieManagement?.budget.consume(3);
  if (
    z
      .array(z.object({ valid: z.boolean() }))
      .length(1)
      .parse(proof)[0]?.valid !== true
  )
    throw new FileGuardError("subtitle_automatic_candidate_parent_changed");
}
