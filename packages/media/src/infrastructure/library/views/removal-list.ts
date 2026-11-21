import type { MediaActor } from "#application/auth.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { repeatableRead } from "#infrastructure/locks.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import {
  assessVisibilityAccess,
  type VisibilitySections,
} from "#infrastructure/visibility/access.ts";
import { RemovalListSchema } from "#shared/api.ts";
import { rootReference } from "#infrastructure/library/views/artwork.ts";
import { leavingSoonDecisionWhere } from "#infrastructure/library/views/leaving.ts";

const LIMIT = 100;
const node = {
  id: true,
  parentId: true,
  title: true,
  posterPath: true,
  backdropPath: true,
  externalIds: true,
} as const;
/** What a row needs to name its root title, show its art and be checked against Plex access. */
const mediaSelect = {
  ...node,
  kind: true,
  version: true,
  parent: { select: { ...node, parent: { select: node } } },
} as const satisfies Prisma.MediaItemSelect;

type RemovalReadSettings = {
  serverMachineId?: string | undefined;
  sections?: Partial<VisibilitySections> | undefined;
};

/**
 * Removals still pending or recoverable.
 *
 * The owner sees every one. A member sees:
 *
 * - every title that is leaving soon (`warning_pending` or `grace_period`) and
 *   sits in a Plex library they may currently open, whoever asked for it; and
 * - their own titles, as before, in any state and whatever their Plex access:
 *   they already know about what they asked for.
 *
 * A quarantined title, whose files are already out of the library, stays
 * visible only to the owner and to the members following it: restoring it is
 * theirs to do. A member whose Plex access is stale sees only their own
 * titles, so nobody learns of a title outside their libraries.
 */
export function readRemovalList(
  db: Database,
  actor: MediaActor,
  settings: RemovalReadSettings,
) {
  return repeatableRead(db, async (tx) => {
    const decisions =
      actor.role === "owner"
        ? await readDecisions(tx, { actorId: actor.id, where: {}, after: null })
        : await memberDecisions(tx, actor, settings);
    return RemovalListSchema.parse(
      decisions.map((decision) => ({
        ...decision,
        ...rootReference(decision.media),
      })),
    );
  });
}

type After = { updatedAt: Date; id: string } | null;

function readDecisions(
  tx: Prisma.TransactionClient,
  page: {
    actorId: string;
    where: Prisma.RetentionDecisionWhereInput;
    after: After;
  },
) {
  const { after } = page;
  return tx.retentionDecision.findMany({
    where: {
      AND: [
        {
          edition: "default",
          state: { in: ["warning_pending", "grace_period", "quarantined"] },
        },
        page.where,
        after === null
          ? {}
          : {
              OR: [
                { updatedAt: { lt: after.updatedAt } },
                { updatedAt: after.updatedAt, id: { lt: after.id } },
              ],
            },
      ],
    },
    select: {
      id: true,
      mediaId: true,
      state: true,
      graceUntil: true,
      purgeAfter: true,
      updatedAt: true,
      media: {
        select: {
          ...mediaSelect,
          requests: {
            where: { userId: page.actorId, ...effectiveRequestWhere },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: LIMIT,
  });
}

/**
 * Plex visibility is decided per row from the title's library section, which
 * the query cannot express, so rows are read in batches until the list is full
 * or the removals run out; a member with one library never loses a visible row
 * to a batch of rows from another.
 */
async function memberDecisions(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  settings: RemovalReadSettings,
) {
  const { reader } = await assessVisibilityAccess(tx, actor, settings);
  const own = {
    media: {
      requests: { some: { userId: actor.id, ...effectiveRequestWhere } },
    },
  } satisfies Prisma.RetentionDecisionWhereInput;
  const where = reader === null ? own : { OR: [own, leavingSoonDecisionWhere] };
  const listed: Awaited<ReturnType<typeof readDecisions>> = [];
  let after: After = null;
  do {
    const batch = await readDecisions(tx, { actorId: actor.id, where, after });
    listed.push(
      ...batch.filter(
        (decision) =>
          decision.media.requests.length > 0 ||
          reader?.visible(decision.media) === true,
      ),
    );
    const last = batch.at(-1);
    after =
      last === undefined || batch.length < LIMIT || listed.length >= LIMIT
        ? null
        : { updatedAt: last.updatedAt, id: last.id };
  } while (after !== null);
  return listed.slice(0, LIMIT);
}
