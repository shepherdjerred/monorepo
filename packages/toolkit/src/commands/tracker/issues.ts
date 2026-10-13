import { z } from "zod";
import {
  CreateIssueSchema,
  IssueListSchema,
  UpdateIssueSchema,
  StateTypeSchema,
  type ActorEnvelope,
} from "@shepherdjerred/tracker/contract";
import type { TrackerClient } from "#lib/tracker/client.ts";
import { attachFiles } from "#lib/tracker/attachments.ts";
import {
  integer,
  required,
  textInput,
  type TrackerOptions,
} from "./options.ts";

export type TrackerCommandContext = {
  client: TrackerClient;
  url: string;
  actor: () => Promise<ActorEnvelope>;
};

function listInput(options: TrackerOptions, search?: string) {
  return IssueListSchema.parse({
    teamKey: options.team,
    projectSlug: options.project,
    states: options.state,
    labels: options.label,
    assigneeKey: options.assignee,
    creatorKey: options.creator,
    priority: integer(options.priority),
    includeArchived: options["include-archived"],
    limit: options.limit === "all" ? "all" : integer(options.limit),
    cursor: options.cursor,
    sort: options.sort,
    search,
  });
}

async function create(context: TrackerCommandContext, options: TrackerOptions) {
  if ((options.state?.length ?? 0) > 1)
    throw new Error("Create takes one --state");
  const state = options.state?.[0];
  const stateType = StateTypeSchema.safeParse(state);
  return context.client.issues.create.mutate(
    CreateIssueSchema.parse({
      actor: await context.actor(),
      teamKey: required(options.team, "--team"),
      title: required(options.title, "--title"),
      description: await textInput(
        options.description,
        options["description-file"],
      ),
      priority: integer(options.priority),
      projectSlug: options.project,
      assigneeKey: options.assignee,
      labels: options.label,
      ...(state === undefined
        ? {}
        : stateType.success
          ? { stateType: stateType.data }
          : { stateName: state }),
    }),
  );
}

async function update(
  context: TrackerCommandContext,
  identifier: string,
  options: TrackerOptions,
) {
  if (options.archive && options.unarchive)
    throw new Error("Choose --archive or --unarchive");
  if ((options.state?.length ?? 0) > 1)
    throw new Error("Update takes one --state");
  const state = options.state?.[0];
  const states =
    state === undefined
      ? []
      : await context.client.states.list.query({
          teamKey: identifier.split("-")[0],
        });
  const selected =
    state === undefined
      ? undefined
      : states.find((item) => item.name === state || item.type === state);
  if (state !== undefined && selected === undefined)
    throw new Error(`Unknown state: ${state}`);
  return context.client.issues.update.mutate(
    UpdateIssueSchema.parse({
      actor: await context.actor(),
      identifier,
      title: options.title,
      description: await textInput(
        options.description,
        options["description-file"],
      ),
      priority: integer(options.priority),
      projectSlug: options.project === "none" ? null : options.project,
      assigneeKey: options.assignee === "none" ? null : options.assignee,
      addLabels: options["add-label"],
      removeLabels: options["remove-label"],
      stateName: selected?.name,
      ...(options.archive || options.unarchive
        ? { archived: options.archive }
        : {}),
      expectedRevision: integer(options["expected-revision"]),
    }),
  );
}

async function comments(
  context: TrackerCommandContext,
  args: string[],
  options: TrackerOptions,
) {
  const action = required(
    args[0],
    "comment action (add, list, update, delete)",
  );
  const reference = required(args[1], "Issue identifier or comment ID");
  if (action === "list")
    return context.client.comments.list.query({
      identifier: reference.toUpperCase(),
    });
  const actor = await context.actor();
  if (action === "delete")
    return context.client.comments.delete.mutate({ actor, id: reference });
  const body = required(
    await textInput(options.body, options["body-file"]),
    "--body or --body-file",
  );
  if (action === "add")
    return context.client.comments.create.mutate({
      actor,
      identifier: reference.toUpperCase(),
      body,
    });
  if (action === "update")
    return context.client.comments.update.mutate({
      actor,
      id: reference,
      body,
    });
  throw new Error(`Unknown comment action: ${action}`);
}

export async function issueCommand(
  context: TrackerCommandContext,
  args: string[],
  options: TrackerOptions,
): Promise<unknown> {
  const action = required(args[0], "Issue action");
  if (action === "list")
    return context.client.issues.list.query(listInput(options));
  if (action === "search") {
    const input = listInput(options, required(args[1], "Search text"));
    if (!options["all-states"] && input.states.length === 0)
      input.states = ["triage", "backlog", "unstarted", "started"];
    return context.client.issues.list.query(input);
  }
  if (action === "create") return create(context, options);
  if (action === "comment") return comments(context, args.slice(1), options);
  const identifier = required(args[1], "Issue identifier").toUpperCase();
  if (action === "view")
    return context.client.issues.byIdentifier.query({ identifier });
  if (action === "events")
    return context.client.issues.activity.query({ identifier, limit: 500 });
  if (action === "update") return update(context, identifier, options);
  return action === "attach"
    ? attachFiles(context, identifier, args.slice(2), await context.actor())
    : issueMutation(context, args, options);
}

async function issueMutation(
  context: TrackerCommandContext,
  args: string[],
  options: TrackerOptions,
): Promise<unknown> {
  const { client } = context;
  const action = required(args[0], "Issue action");
  const identifier = required(args[1], "Issue identifier").toUpperCase();
  const actor = await context.actor();
  if (action === "vote")
    return options.remove
      ? client.votes.remove.mutate({ actor, identifier })
      : client.votes.cast.mutate({
          actor,
          identifier,
          ...(options.note === undefined ? {} : { note: options.note }),
        });
  if (action === "relate")
    return client.relations.create.mutate({
      actor,
      identifier,
      target: required(args[2], "Target issue").toUpperCase(),
      type: z
        .enum(["blocks", "blocked-by", "duplicate", "related"])
        .parse(options.type),
    });
  if (action === "delete")
    return client.issues.delete.mutate({
      actor,
      identifier,
      expectedRevision: z
        .number()
        .int()
        .positive()
        .parse(integer(options["expected-revision"])),
    });
  throw new Error(`Unknown issue action: ${action}`);
}
