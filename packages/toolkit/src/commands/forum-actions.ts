import {
  AcceptForumReplySchema,
  ClaimForumNoticeSchema,
  DeleteForumReplySchema,
  ForumEmojiSchema,
  ForumIssueLinkSchema,
  HandoffForumNoticeSchema,
  MarkForumReadSchema,
  PinForumSchema,
  PromoteForumToIssueSchema,
  ReactForumSchema,
  SubscribeForumSchema,
  UpdateForumReplySchema,
  VoteForumSchema,
  type ActorEnvelope,
} from "@shepherdjerred/tracker/contract";
import { uploadAttachments } from "#lib/tracker/attachments.ts";
import type { TrackerCommandContext } from "./tracker/issues.ts";
import { clearable, integer, required, textInput } from "./tracker/options.ts";
import type { ForumOptions } from "./forum-options.ts";

export type SecondaryForumAction =
  | "edit-reply"
  | "delete-reply"
  | "pin"
  | "unpin"
  | "accept"
  | "unaccept"
  | "claim"
  | "handoff"
  | "vote"
  | "unvote"
  | "react"
  | "unreact"
  | "subscribe"
  | "unsubscribe"
  | "read"
  | "link"
  | "unlink"
  | "promote";

export async function attachmentIdsFor(
  url: string,
  files: readonly string[] | undefined,
  actor: ActorEnvelope,
): Promise<string[]> {
  if (files === undefined || files.length === 0) return [];
  const uploaded = await uploadAttachments(url, files, actor);
  return uploaded.map((item) => item.id);
}

export function resolveOwnerOrTargetKey(
  raw: string,
  actorKey: string,
): string | null {
  if (raw === "none") return null;
  return raw === "me" ? actorKey : raw;
}

async function editOrDeleteReply(
  context: TrackerCommandContext,
  action: "edit-reply" | "delete-reply",
  args: string[],
  options: ForumOptions,
) {
  const replyId = required(args[0], "Reply ID");
  if (action === "delete-reply") {
    const actor = await context.actor();
    return context.client.forum.deleteReply.mutate(
      DeleteForumReplySchema.parse({ actor, replyId }),
    );
  }
  const body = required(
    await textInput(options.body, options["body-file"]),
    "--body or --body-file",
  );
  const actor = await context.actor();
  const parsed = UpdateForumReplySchema.parse({ actor, replyId, body });
  const attachmentIds = await attachmentIdsFor(
    context.url,
    options.attach,
    actor,
  );
  return context.client.forum.updateReply.mutate({
    ...parsed,
    attachmentIds,
  });
}

async function claimOrHandoff(
  context: TrackerCommandContext,
  action: "claim" | "handoff",
  args: string[],
  options: ForumOptions,
) {
  const id = required(args[0], "Post ID");
  const note = await textInput(options.note, options["note-file"]);
  const actor = await context.actor();
  if (action === "claim") {
    return context.client.forum.claim.mutate(
      ClaimForumNoticeSchema.parse({
        actor,
        id,
        ...(note === undefined ? {} : { note }),
      }),
    );
  }
  const toRaw = required(options.to, "--to");
  return context.client.forum.handoff.mutate(
    HandoffForumNoticeSchema.parse({
      actor,
      id,
      toActorKey: resolveOwnerOrTargetKey(toRaw, actor.key),
      ...(note === undefined ? {} : { note }),
    }),
  );
}

async function voteOrReact(
  context: TrackerCommandContext,
  action: "vote" | "unvote" | "react" | "unreact",
  args: string[],
  options: ForumOptions,
) {
  const target = {
    ...(args[0] === undefined ? {} : { id: args[0] }),
    ...(options.reply === undefined ? {} : { replyId: options.reply }),
  };
  if (action === "vote" || action === "unvote") {
    const note = await textInput(options.note, options["note-file"]);
    if (action === "unvote" && note !== undefined)
      throw new Error("unvote does not take --note");
    const actor = await context.actor();
    return context.client.forum.vote.mutate(
      VoteForumSchema.parse({
        actor,
        ...target,
        ...(note === undefined ? {} : { note }),
        remove: action === "unvote",
      }),
    );
  }
  const emoji = ForumEmojiSchema.parse(required(options.emoji, "--emoji"));
  const actor = await context.actor();
  return context.client.forum.react.mutate(
    ReactForumSchema.parse({
      actor,
      ...target,
      emoji,
      remove: action === "unreact",
    }),
  );
}

async function threadStateCommand(
  context: TrackerCommandContext,
  action: "subscribe" | "unsubscribe" | "read",
  args: string[],
  options: ForumOptions,
) {
  const id = required(args[0], "Post ID");
  if (action === "read") {
    return context.client.forum.markRead.mutate(
      MarkForumReadSchema.parse({
        actor: await context.actor(),
        id,
        readAt: options.unread ? null : new Date().toISOString(),
      }),
    );
  }
  if (action === "unsubscribe" && options.mute)
    throw new Error("--mute is only valid with subscribe");
  const mode =
    action === "unsubscribe" ? null : options.mute ? "muted" : "subscribed";
  return context.client.forum.subscribe.mutate(
    SubscribeForumSchema.parse({ actor: await context.actor(), id, mode }),
  );
}

async function issueRelationCommand(
  context: TrackerCommandContext,
  action: "link" | "unlink" | "promote",
  args: string[],
  options: ForumOptions,
) {
  const id = required(args[0], "Post ID");
  if (action === "promote") {
    const description = await textInput(options.body, options["body-file"]);
    const actor = await context.actor();
    return context.client.forum.promoteToIssue.mutate(
      PromoteForumToIssueSchema.parse({
        actor,
        id,
        ...(options.reply === undefined ? {} : { replyId: options.reply }),
        teamKey: (options.team ?? "AI").trim().toUpperCase(),
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(description === undefined ? {} : { description }),
        ...(options.priority === undefined
          ? {}
          : { priority: integer(options.priority) }),
        ...(options.project === undefined
          ? {}
          : { projectSlug: clearable(options.project) }),
      }),
    );
  }
  if (action === "unlink" && options.reply !== undefined)
    throw new Error("unlink does not take --reply");
  const issueIdentifier = required(args[1], "Issue identifier")
    .trim()
    .toUpperCase();
  const input = ForumIssueLinkSchema.parse({
    actor: await context.actor(),
    id,
    issueIdentifier,
    ...(options.reply === undefined ? {} : { sourceReplyId: options.reply }),
  });
  return action === "link"
    ? context.client.forum.linkIssue.mutate(input)
    : context.client.forum.unlinkIssue.mutate(input);
}

export async function secondaryForumCommand(
  context: TrackerCommandContext,
  action: SecondaryForumAction,
  args: string[],
  options: ForumOptions,
): Promise<unknown> {
  if (action === "edit-reply" || action === "delete-reply")
    return editOrDeleteReply(context, action, args, options);
  if (action === "pin" || action === "unpin") {
    const id = required(args[0], "Post ID");
    return context.client.forum.pin.mutate(
      PinForumSchema.parse({
        actor: await context.actor(),
        id,
        pinned: action === "pin",
      }),
    );
  }
  if (action === "accept" || action === "unaccept") {
    const id = required(args[0], "Post ID");
    const replyId = action === "accept" ? required(args[1], "Reply ID") : null;
    return context.client.forum.acceptReply.mutate(
      AcceptForumReplySchema.parse({
        actor: await context.actor(),
        id,
        replyId,
      }),
    );
  }
  if (action === "claim" || action === "handoff")
    return claimOrHandoff(context, action, args, options);
  if (
    action === "vote" ||
    action === "unvote" ||
    action === "react" ||
    action === "unreact"
  )
    return voteOrReact(context, action, args, options);
  return action === "subscribe" || action === "unsubscribe" || action === "read"
    ? threadStateCommand(context, action, args, options)
    : issueRelationCommand(context, action, args, options);
}
