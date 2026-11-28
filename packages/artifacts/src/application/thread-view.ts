import type { Prisma } from "#generated/prisma/client.ts";
import { AnchorSchema } from "#shared/contract.ts";
import type {
  DeliveryStatus,
  ThreadComment,
  ThreadView,
} from "#shared/procedures.ts";
import { deliverableAt } from "#domain/claim.ts";
import { iso } from "./views.ts";

export const THREAD_INCLUDE = {
  version: { select: { number: true } },
  comments: {
    orderBy: { createdAt: "asc" },
    include: { author: true, delivery: { include: { actor: true } } },
  },
} as const satisfies Prisma.ThreadInclude;

type ThreadRow = Prisma.ThreadGetPayload<{ include: typeof THREAD_INCLUDE }>;
type CommentRow = ThreadRow["comments"][number];

function deliveryOf(comment: CommentRow): DeliveryStatus | null {
  if (comment.author.kind !== "human") return null;
  const delivery = comment.delivery;
  if (delivery === null)
    return {
      state: "queued",
      actor: null,
      claimedAt: null,
      handledAt: null,
      attempts: 0,
    };
  return {
    state:
      delivery.handledAt === null
        ? delivery.ackedAt === null
          ? "claimed"
          : "delivered"
        : "handled",
    actor: {
      key: delivery.actor.key,
      kind: delivery.actor.kind,
      name: delivery.actor.name,
    },
    claimedAt: iso(delivery.claimedAt),
    handledAt: delivery.handledAt === null ? null : iso(delivery.handledAt),
    attempts: delivery.attempts,
  };
}

/** Whether a human comment can still be edited or deleted by its author. */
function editableUntil(
  comment: CommentRow,
  settleSeconds: number,
): Date | null {
  return comment.author.kind === "human" && comment.delivery === null
    ? deliverableAt(comment.updatedAt, settleSeconds)
    : null;
}

export function presentThread(
  row: ThreadRow,
  settleSeconds: number,
  now: Date,
): ThreadView {
  return {
    id: row.id,
    boardId: row.boardId,
    artifactId: row.artifactId,
    versionId: row.versionId,
    versionNumber: row.version?.number ?? null,
    anchor: AnchorSchema.parse(row.anchor),
    state: row.state,
    createdAt: iso(row.createdAt),
    resolvedAt: row.resolvedAt === null ? null : iso(row.resolvedAt),
    comments: row.comments.map((comment): ThreadComment => {
      const until = editableUntil(comment, settleSeconds);
      return {
        id: comment.id,
        body: comment.body,
        author: {
          key: comment.author.key,
          kind: comment.author.kind,
          name: comment.author.name,
        },
        createdAt: iso(comment.createdAt),
        updatedAt: iso(comment.updatedAt),
        delivery: deliveryOf(comment),
        editableUntil: until !== null && until > now ? iso(until) : null,
      };
    }),
  };
}
