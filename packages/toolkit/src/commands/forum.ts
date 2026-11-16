import { z } from "zod";
import {
  CreateForumPostSchema,
  ForumInboxSchema,
  ForumKindSchema,
  ForumListSchema,
  ForumPostIdOrIdentifierSchema,
  ForumReferenceSchema,
  ReopenForumSchema,
  ReplyForumSchema,
  ResolveForumSchema,
  UpdateForumPostSchema,
} from "@shepherdjerred/tracker/contract";
import type { TrackerCommandContext } from "./tracker/issues.ts";
import { clearable, integer, required, textInput } from "./tracker/options.ts";
import {
  attachmentIdsFor,
  resolveOwnerOrTargetKey,
  secondaryForumCommand,
} from "./forum-actions.ts";
import type { ForumAction, ForumOptions } from "./forum-options.ts";

function positiveRevision(value: string | undefined): number {
  return z.number().int().positive().parse(integer(value));
}

async function optionalViewerKey(
  context: TrackerCommandContext,
): Promise<string | undefined> {
  try {
    const actor = await context.actor();
    return actor.key;
  } catch {
    return undefined;
  }
}

async function listInput(
  context: TrackerCommandContext,
  action: "list" | "search",
  args: string[],
  options: ForumOptions,
) {
  if ((options.issue?.length ?? 0) > 1)
    throw new Error(`${action} takes at most one --issue`);
  const needsActor =
    options.owner === "me" ||
    options.creator === "me" ||
    options.unread ||
    options.subscribed;
  const actor = needsActor ? await context.actor() : undefined;
  const actorKey = actor?.key;
  const ownerKey =
    options.owner === undefined
      ? undefined
      : resolveOwnerOrTargetKey(options.owner, actorKey ?? "");
  const creatorKey = options.creator === "me" ? actorKey : options.creator;
  return ForumListSchema.parse({
    kind: options.kind,
    scopes: options.scope,
    state: options.all
      ? "all"
      : (options.state ?? (action === "search" ? "all" : "active")),
    sort: options.sort,
    projectSlug: clearable(options.project),
    ownerKey,
    creatorKey,
    linkedIssueIdentifier: options.issue?.[0]?.trim().toUpperCase(),
    unreadOnly: options.unread,
    subscribedOnly: options.subscribed,
    viewerActorKey: options.unread || options.subscribed ? actorKey : undefined,
    limit: integer(options.limit),
    cursor: options.cursor,
    query: action === "search" ? required(args[0], "Search text") : undefined,
  });
}

async function postFields(options: ForumOptions, actorKey: string) {
  if (options["clear-scopes"] && options.scope !== undefined)
    throw new Error("Choose --scope or --clear-scopes");
  return {
    title: options.title,
    body: await textInput(options.body, options["body-file"]),
    scopes: options["clear-scopes"] ? [] : options.scope,
    exitCondition: await textInput(
      options.condition,
      options["condition-file"],
    ),
    expiresAt: clearable(options["expires-at"]),
    ownerKey:
      options.owner === undefined
        ? undefined
        : resolveOwnerOrTargetKey(options.owner, actorKey),
    projectSlug: clearable(options.project),
  };
}

async function createOrUpdatePost(
  context: TrackerCommandContext,
  action: "post" | "update",
  args: string[],
  options: ForumOptions,
) {
  const client = context.client.forum;
  if (action === "post") {
    const kind = ForumKindSchema.parse(options.kind);
    const actor = await context.actor();
    const fields = await postFields(options, actor.key);
    const title = required(fields.title, "--title");
    if (kind === "notice")
      required(
        fields.exitCondition ?? undefined,
        "--condition or --condition-file",
      );
    const parsed = CreateForumPostSchema.parse({
      ...fields,
      kind,
      title,
      body: required(fields.body, "--body or --body-file"),
      linkedIssueIdentifiers: options.issue?.map((item) =>
        item.trim().toUpperCase(),
      ),
      ...(options.pinned ? { pinned: true } : {}),
      actor,
    });
    const attachmentIds = await attachmentIdsFor(
      context.url,
      options.attach,
      actor,
    );
    return client.create.mutate({ ...parsed, attachmentIds });
  }
  const id = required(args[0], "Post ID");
  const expectedRevision = positiveRevision(options["expected-revision"]);
  const actor = await context.actor();
  const fields = await postFields(options, actor.key);
  const parsed = UpdateForumPostSchema.parse({
    ...fields,
    id,
    expectedRevision,
    actor,
  });
  const attachmentIds = await attachmentIdsFor(
    context.url,
    options.attach,
    actor,
  );
  return client.update.mutate({ ...parsed, attachmentIds });
}

async function replyOrStateMutation(
  context: TrackerCommandContext,
  action: "reply" | "resolve" | "reopen",
  args: string[],
  options: ForumOptions,
) {
  const client = context.client.forum;
  const id = required(args[0], "Post ID");
  if (action === "reply") {
    const body = required(
      await textInput(options.body, options["body-file"]),
      "--body or --body-file",
    );
    const actor = await context.actor();
    const parsed = ReplyForumSchema.parse({
      id,
      body,
      parentReplyId: clearable(options["parent-reply"]),
      actor,
    });
    const attachmentIds = await attachmentIdsFor(
      context.url,
      options.attach,
      actor,
    );
    return client.reply.mutate({ ...parsed, attachmentIds });
  }
  const expectedRevision = positiveRevision(options["expected-revision"]);
  if (action === "reopen") {
    return client.reopen.mutate(
      ReopenForumSchema.parse({
        id,
        expectedRevision,
        actor: await context.actor(),
      }),
    );
  }
  const note = required(
    await textInput(options.note, options["note-file"]),
    "--note or --note-file",
  );
  return client.resolve.mutate(
    ResolveForumSchema.parse({
      id,
      expectedRevision,
      note,
      actor: await context.actor(),
    }),
  );
}

export async function forumCommand(
  context: TrackerCommandContext,
  action: ForumAction,
  args: string[],
  options: ForumOptions,
): Promise<unknown> {
  const client = context.client.forum;
  if (action === "list" || action === "search") {
    const input = await listInput(context, action, args, options);
    return action === "list"
      ? client.list.query(input)
      : client.search.query(input);
  }
  if (action === "inbox") {
    const actor = await context.actor();
    return client.inbox.query(
      ForumInboxSchema.parse({
        viewerActorKey: actor.key,
        unreadOnly: !options.all,
        limit: integer(options.limit),
        cursor: options.cursor,
      }),
    );
  }
  if (action === "scopes") return client.scopes.query();
  if (action === "view" || action === "show") {
    const id = ForumPostIdOrIdentifierSchema.parse(
      required(args[0], "Post ID"),
    );
    const viewerActorKey = await optionalViewerKey(context);
    return client.byId.query(
      ForumReferenceSchema.parse({
        id,
        ...(viewerActorKey === undefined ? {} : { viewerActorKey }),
      }),
    );
  }
  if (action === "post" || action === "update")
    return createOrUpdatePost(context, action, args, options);
  return action === "reply" || action === "resolve" || action === "reopen"
    ? replyOrStateMutation(context, action, args, options)
    : secondaryForumCommand(context, action, args, options);
}
