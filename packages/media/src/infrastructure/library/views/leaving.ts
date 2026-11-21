import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";

/**
 * The retention states in which a removal can still be stopped: the files are
 * untouched until the decision reaches `quarantined`. A title in either state
 * is "leaving soon" for the whole household, not only for those who asked for
 * it.
 */
const LEAVING_SOON_STATES = ["warning_pending", "grace_period"] as const;
const LeavingStateSchema = z.enum(LEAVING_SOON_STATES);

/** An open removal of the title's default edition. */
export const leavingSoonDecisionWhere = {
  edition: "default",
  state: { in: [...LEAVING_SOON_STATES] },
} satisfies Prisma.RetentionDecisionWhereInput;

const leaving = {
  retention: { some: leavingSoonDecisionWhere },
} satisfies Prisma.MediaItemWhereInput;

/** A movie or series with an open removal on itself or anywhere beneath it. */
export const leavingSoonWhere = {
  OR: [
    leaving,
    { children: { some: leaving } },
    { children: { some: { children: { some: leaving } } } },
  ],
} satisfies Prisma.MediaItemWhereInput;

export type LeavingSoon = {
  state: z.infer<typeof LeavingStateSchema>;
  graceUntil: Date | null;
};

/**
 * The soonest open removal under each of a page of movies and series, in one
 * query. A removal is decided per movie or per episode, so a series can have
 * many. One with a date outranks one still waiting for its notice to be
 * received, and of those with a date the earliest is reported: it is the first
 * moment anything of the title leaves. Callers pass only root titles the reader
 * may see.
 */
export async function readLeavingSoon(
  tx: Prisma.TransactionClient,
  rootIds: readonly string[],
): Promise<(rootId: string) => LeavingSoon | null> {
  const requested = new Set(rootIds);
  const ids = [...requested];
  const decisions =
    ids.length === 0
      ? []
      : await tx.retentionDecision.findMany({
          where: {
            ...leavingSoonDecisionWhere,
            media: {
              OR: [
                { id: { in: ids } },
                { parentId: { in: ids } },
                { parent: { parentId: { in: ids } } },
              ],
            },
          },
          select: {
            state: true,
            graceUntil: true,
            media: {
              select: {
                id: true,
                parentId: true,
                parent: { select: { parentId: true } },
              },
            },
          },
        });
  const soonest = new Map<string, LeavingSoon>();
  for (const decision of decisions) {
    const { media } = decision;
    const rootId = media.parent?.parentId ?? media.parentId ?? media.id;
    if (!requested.has(rootId))
      throw new Error("A removal was read for a title that is not a root");
    const candidate = {
      state: LeavingStateSchema.parse(decision.state),
      graceUntil: decision.graceUntil,
    };
    const current = soonest.get(rootId);
    if (current === undefined || sooner(candidate, current))
      soonest.set(rootId, candidate);
  }
  return (rootId) => {
    if (!requested.has(rootId))
      throw new Error("Removals were not read for this title");
    return soonest.get(rootId) ?? null;
  };
}

function sooner(candidate: LeavingSoon, current: LeavingSoon): boolean {
  return candidate.state === current.state
    ? candidate.graceUntil !== null &&
        (current.graceUntil === null ||
          candidate.graceUntil < current.graceUntil)
    : candidate.state === "grace_period";
}
