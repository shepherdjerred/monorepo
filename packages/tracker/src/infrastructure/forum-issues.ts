import type { MutationContext } from "#application/unit-of-work.ts";
import { TrackerError } from "#domain/error.ts";
import { identifier, transitionTimestamps } from "#domain/issue.ts";
import type {
  ForumIssueLinkInput,
  PromoteForumToIssueInput,
} from "#shared/forum.ts";
import {
  forumIdentifier,
  lockPost,
  postSummaryInclude,
  presentPostSummary,
  touchActorReadAt,
} from "./forum-repository.ts";
import {
  addLabels,
  audit,
  findIssue,
  presentIssue,
  resolveAssignee,
  resolveProject,
  resolveState,
} from "./issue-repository.ts";

export async function linkForumIssue(
  ctx: MutationContext,
  input: ForumIssueLinkInput,
) {
  const post = await lockPost(ctx.db, input.id, undefined, input.actor.key);
  const issue = await findIssue(ctx.db, input.issueIdentifier);
  if (input.sourceReplyId !== undefined) {
    const sourceReply = await ctx.db.forumReply.findFirst({
      where: { id: input.sourceReplyId, postId: post.id },
    });
    if (sourceReply === null)
      throw new TrackerError(
        "BAD_REQUEST",
        "Source reply does not belong to this thread",
      );
  }
  await ctx.db.forumIssueLink.upsert({
    where: { postId_issueId: { postId: post.id, issueId: issue.id } },
    create: {
      postId: post.id,
      issueId: issue.id,
      sourceReplyId: input.sourceReplyId ?? null,
      createdById: ctx.actor.id,
    },
    update:
      input.sourceReplyId === undefined
        ? {}
        : { sourceReplyId: input.sourceReplyId },
  });
  const now = new Date();
  await ctx.db.forumPost.update({
    where: { id: post.id },
    data: { lastActivityAt: now },
  });
  await touchActorReadAt(ctx.db, post.id, ctx.actor.id, now);
  const issueIdent = identifier(issue.team.key, issue.number);
  await audit(ctx, {
    entityType: "forum-issue-link",
    entityId: post.id,
    issueId: issue.id,
    issueIdentifier: issueIdent,
    action: "linked",
    after: {
      postId: post.id,
      postIdentifier: forumIdentifier(post.number),
      issueId: issue.id,
      issueIdentifier: issueIdent,
      sourceReplyId: input.sourceReplyId ?? null,
    },
  });
  const refreshed = await ctx.db.forumPost.findUniqueOrThrow({
    where: { id: post.id },
    include: postSummaryInclude(input.actor.key),
  });
  return presentPostSummary(refreshed, {
    now,
    viewerActorKey: input.actor.key,
  });
}

export async function unlinkForumIssue(
  ctx: MutationContext,
  input: ForumIssueLinkInput,
) {
  const post = await lockPost(ctx.db, input.id, undefined, input.actor.key);
  const issue = await findIssue(ctx.db, input.issueIdentifier);
  await ctx.db.forumIssueLink.deleteMany({
    where: { postId: post.id, issueId: issue.id },
  });
  const issueIdent = identifier(issue.team.key, issue.number);
  await audit(ctx, {
    entityType: "forum-issue-link",
    entityId: post.id,
    issueId: issue.id,
    issueIdentifier: issueIdent,
    action: "unlinked",
    before: {
      postId: post.id,
      postIdentifier: forumIdentifier(post.number),
      issueId: issue.id,
      issueIdentifier: issueIdent,
    },
  });
  const refreshed = await ctx.db.forumPost.findUniqueOrThrow({
    where: { id: post.id },
    include: postSummaryInclude(input.actor.key),
  });
  return presentPostSummary(refreshed, { viewerActorKey: input.actor.key });
}

function promotedDescription(
  postIdent: string,
  sourceBody: string,
  isReply: boolean,
  customDescription?: string,
): string {
  const footer = `Promoted from ${postIdent}${isReply ? " (reply)" : ""}`;
  if (customDescription !== undefined) {
    if (customDescription.includes(postIdent)) return customDescription;
    return customDescription.trim() === ""
      ? footer
      : `${customDescription.trimEnd()}\n\n---\n${footer}`;
  }
  const quoted = sourceBody
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${quoted}\n\n---\n${footer}`;
}

async function resolvePromotionReply(
  ctx: MutationContext,
  postId: string,
  replyId?: string,
) {
  if (replyId === undefined) return null;
  const reply = await ctx.db.forumReply.findUnique({ where: { id: replyId } });
  if (reply?.postId !== postId)
    throw new TrackerError("NOT_FOUND", "Reply not found on this thread");
  if (reply.deletedAt !== null)
    throw new TrackerError("BAD_REQUEST", "Cannot promote a deleted reply");
  return reply;
}

async function allocateTeamIssueSlot(
  ctx: MutationContext,
  input: PromoteForumToIssueInput,
) {
  const teams = await ctx.db.$queryRaw<{ id: string; issueCounter: number }[]>`
    UPDATE "Team" SET "issueCounter" = "issueCounter" + 1
    WHERE "key" = ${input.teamKey}
    RETURNING "id", "issueCounter"`;
  const team = teams[0];
  if (team === undefined)
    throw new TrackerError("BAD_REQUEST", `Unknown team ${input.teamKey}`);
  const state = await resolveState(ctx.db, team.id, {
    stateName: input.stateName,
    stateType:
      input.stateType ?? (input.stateName === undefined ? "triage" : undefined),
  });
  await ctx.db
    .$queryRaw`SELECT "id" FROM "WorkflowState" WHERE "id" = ${state.id} FOR UPDATE`;
  const tail = await ctx.db.issue.aggregate({
    where: { stateId: state.id },
    _max: { boardOrder: true },
  });
  return { team, state, boardOrder: (tail._max.boardOrder ?? 0) + 1024 };
}

export async function promoteForumToIssue(
  ctx: MutationContext,
  input: PromoteForumToIssueInput,
) {
  const post = await lockPost(ctx.db, input.id, undefined, input.actor.key);
  const reply = await resolvePromotionReply(ctx, post.id, input.replyId);
  const postIdent = forumIdentifier(post.number);
  const rawTitle =
    input.title ??
    (reply === null
      ? post.title
      : `Follow up from ${postIdent}: ${post.title}`);
  const title = rawTitle.length > 500 ? `${rawTitle.slice(0, 499)}…` : rawTitle;
  const description = promotedDescription(
    postIdent,
    reply === null ? post.body : reply.body,
    reply !== null,
    input.description,
  );
  const { team, state, boardOrder } = await allocateTeamIssueSlot(ctx, input);
  const projectId =
    input.projectSlug === undefined
      ? post.projectId
      : ((await resolveProject(ctx.db, input.projectSlug)) ?? null);
  const assigneeId = (await resolveAssignee(ctx.db, input.assigneeKey)) ?? null;
  const now = new Date();
  const created = await ctx.db.issue.create({
    data: {
      teamId: team.id,
      number: team.issueCounter,
      creatorId: ctx.actor.id,
      title,
      description,
      priority: input.priority,
      stateId: state.id,
      projectId,
      assigneeId,
      boardOrder,
      ...transitionTimestamps(
        state.type,
        { startedAt: null, completedAt: null, canceledAt: null },
        now,
      ),
    },
  });
  await addLabels(ctx.db, created.id, team.id, input.labels);
  const issue = presentIssue(
    await findIssue(ctx.db, identifier(input.teamKey, created.number)),
  );
  await ctx.db.forumIssueLink.upsert({
    where: { postId_issueId: { postId: post.id, issueId: created.id } },
    create: {
      postId: post.id,
      issueId: created.id,
      sourceReplyId: reply?.id ?? null,
      createdById: ctx.actor.id,
    },
    update: { sourceReplyId: reply?.id ?? null },
  });
  await ctx.db.forumPost.update({
    where: { id: post.id },
    data: { lastActivityAt: now },
  });
  await touchActorReadAt(ctx.db, post.id, ctx.actor.id, now);
  await audit(ctx, {
    entityType: "issue",
    entityId: created.id,
    issueId: created.id,
    issueIdentifier: issue.identifier,
    action: "created",
    after: issue,
  });
  await audit(ctx, {
    entityType: "forum-issue-link",
    entityId: post.id,
    issueId: created.id,
    issueIdentifier: issue.identifier,
    action: "promoted",
    after: {
      postId: post.id,
      postIdentifier: postIdent,
      issueId: created.id,
      issueIdentifier: issue.identifier,
      sourceReplyId: reply?.id ?? null,
    },
  });
  return { issue, postId: post.id };
}
