import { z } from "zod";
import {
  CreateForumPostSchema,
  ForumListSchema,
  UpdateForumPostSchema,
  ForumReferenceSchema,
  ReplyForumSchema,
  ResolveForumSchema,
  ReopenForumSchema,
} from "@shepherdjerred/tracker/contract";
import type { TrackerCommandContext } from "./tracker/issues.ts";
import { integer, required, textInput } from "./tracker/options.ts";
import type { ForumOptions } from "./forum-options.ts";

type Action =
  | "list"
  | "search"
  | "view"
  | "post"
  | "update"
  | "reply"
  | "resolve"
  | "reopen";

function listInput(action: Action, args: string[], options: ForumOptions) {
  return ForumListSchema.parse({
    kind: options.kind,
    scopes: options.scope,
    state: options.all
      ? "all"
      : (options.state ?? (action === "search" ? "all" : "active")),
    limit: integer(options.limit),
    cursor: options.cursor,
    query: action === "search" ? required(args[0], "Search text") : undefined,
  });
}

async function postFields(options: ForumOptions) {
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
    expiresAt: options["expires-at"] === "none" ? null : options["expires-at"],
  };
}

export async function forumCommand(
  context: TrackerCommandContext,
  action: Action,
  args: string[],
  options: ForumOptions,
): Promise<unknown> {
  const client = context.client.forum;
  if (action === "list" || action === "search") {
    const input = listInput(action, args, options);
    return action === "list"
      ? client.list.query(input)
      : client.search.query(input);
  }
  if (action === "view")
    return client.byId.query(
      ForumReferenceSchema.parse({ id: required(args[0], "Post ID") }),
    );
  const fields = await postFields(options);
  const body = fields.body;
  if (action === "post") {
    const kind = z.enum(["notice", "discussion"]).parse(options.kind);
    const title = required(fields.title, "--title");
    if (kind === "notice")
      required(fields.exitCondition, "--condition or --condition-file");
    return client.create.mutate(
      CreateForumPostSchema.parse({
        ...fields,
        kind,
        title,
        body: required(body, "--body or --body-file"),
        actor: await context.actor(),
      }),
    );
  }
  const id = required(args[0], "Post ID");
  if (action === "reply")
    return client.reply.mutate(
      ReplyForumSchema.parse({
        id,
        body: required(body, "--body or --body-file"),
        actor: await context.actor(),
      }),
    );
  const expectedRevision = z
    .number()
    .int()
    .positive()
    .parse(integer(options["expected-revision"]));
  if (action === "update")
    return client.update.mutate(
      UpdateForumPostSchema.parse({
        ...fields,
        id,
        expectedRevision,
        actor: await context.actor(),
      }),
    );
  if (action === "reopen")
    return client.reopen.mutate(
      ReopenForumSchema.parse({
        id,
        expectedRevision,
        actor: await context.actor(),
      }),
    );
  const note = required(
    await textInput(options.note, options["note-file"]),
    "--note or --note-file",
  );
  const input = { id, expectedRevision, note, actor: await context.actor() };
  return client.resolve.mutate(ResolveForumSchema.parse(input));
}
