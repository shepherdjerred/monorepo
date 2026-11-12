import { z } from "zod";

/** Which editor a sent draft came from, and so how to tell it was saved. */
export const PendingKindSchema = z.enum([
  "comment",
  "comment-edit",
  "description",
  "new-issue-title",
  "new-issue-description",
]);
export type PendingKind = z.infer<typeof PendingKindSchema>;

/**
 * A draft that was sent and has not been answered. If the page unloads before
 * the answer, this is all that is known: the text may be saved or may not.
 */
export const PendingSchema = z.object({
  kind: PendingKindSchema,
  /**
   * What the text belongs to: the issue identifier for a comment or a
   * description, the comment id for a comment edit, and for a new issue's
   * description the title it was sent with.
   */
  subject: z.string(),
  text: z.string(),
  attachments: z.array(z.string()),
  /** When it was sent, by this device's clock. */
  sentAt: z.number(),
  /** The `X-Tracker-Request-Id` of the request that carried it, once sent. */
  requestId: z.string().optional(),
});
export type Pending = z.infer<typeof PendingSchema>;

/** How far this device's clock may run ahead of the server's. */
const clockSkewMs = 60_000;
/** How long the server gets to finish a request the unload cut off. */
export const settleMs = 3000;

const sentAfter = (pending: Pending, createdAt: string) =>
  Date.parse(createdAt) >= pending.sentAt - clockSkewMs;

/**
 * A comment was saved when this actor has one with the same body from the
 * time of sending on, or when the issue's history names the request itself.
 */
export function commentWasSaved(
  pending: Pending,
  issue: {
    actorKey: string;
    comments: { author: { key: string }; body: string; createdAt: string }[];
    events: { requestId: string }[];
  },
) {
  return (
    issue.events.some(({ requestId }) => requestId === pending.requestId) ||
    issue.comments.some(
      (comment) =>
        comment.author.key === issue.actorKey &&
        // The server trims a comment before storing it.
        comment.body === pending.text.trim() &&
        sentAfter(pending, comment.createdAt),
    )
  );
}

/** An edit was saved when the server now holds exactly the text sent. */
export function textWasSaved(pending: Pending, current: string) {
  return pending.kind === "comment-edit"
    ? current === pending.text.trim()
    : current === pending.text;
}

/**
 * A new issue was created when this actor has one with the same title from
 * the time of sending on. Its description follows the title it was sent with.
 */
export function issueWasCreated(
  pending: Pending,
  recent: {
    actorKey: string;
    issues: { creator: { key: string }; title: string; createdAt: string }[];
  },
) {
  const title =
    pending.kind === "new-issue-description" ? pending.subject : pending.text;
  return recent.issues.some(
    (issue) =>
      issue.creator.key === recent.actorKey &&
      issue.title === title.trim() &&
      sentAfter(pending, issue.createdAt),
  );
}

/** Whether the server may still be finishing the request that carried it. */
export function mayStillLand(pending: Pending, now: number) {
  return now - pending.sentAt < settleMs;
}

/**
 * What to do with a pending draft when its editor opens again. `saved` is
 * undefined until the server's copy has loaded; `waiting` is true while a
 * very recent send is given time to land and be fetched again.
 */
export function settlePending(saved: boolean | undefined, waiting: boolean) {
  if (saved === true) {
    return "drop";
  }
  return saved === undefined || waiting ? "wait" : "restore";
}

const paths: Record<PendingKind, string> = {
  comment: "comments.create",
  "comment-edit": "comments.update",
  description: "issues.update",
  "new-issue-title": "issues.create",
  "new-issue-description": "issues.create",
};
const SentInputSchema = z.object({
  identifier: z.string().optional(),
  id: z.string().optional(),
  body: z.string().optional(),
  description: z.string().optional(),
  title: z.string().optional(),
});

/** Whether an outgoing tRPC call is the one carrying this pending draft. */
export function carries(
  pending: Pending,
  call: { path: string; input: unknown },
) {
  const parsed = SentInputSchema.safeParse(call.input);
  if (call.path !== paths[pending.kind] || !parsed.success) {
    return false;
  }
  const input = parsed.data;
  switch (pending.kind) {
    case "comment": {
      return (
        input.identifier === pending.subject && input.body === pending.text
      );
    }
    case "comment-edit": {
      return input.id === pending.subject && input.body === pending.text;
    }
    case "description": {
      return (
        input.identifier === pending.subject &&
        input.description === pending.text
      );
    }
    case "new-issue-title": {
      return input.title === pending.text;
    }
    case "new-issue-description": {
      return (
        input.title === pending.subject && input.description === pending.text
      );
    }
  }
}
