import { z } from "zod";
import {
  ActorMetadataSchema,
  ReplyForumSchema,
  type ActorEnvelope,
} from "@shepherdjerred/tracker/contract";
import type { TrackerCommandContext } from "./tracker/issues.ts";
import {
  chooseActor,
  parseTarget,
  resolveReach,
  type ForumLike,
  type IssueLike,
  type ReachActor,
  type ReachResult,
} from "#lib/agent/reach.ts";
import { parseArgs } from "node:util";
import { trackerContext } from "#lib/tracker/context.ts";
import { HerdrClient } from "#lib/agent/herdr.ts";
import { required, textInput } from "./tracker/options.ts";

export type AgentTrackerPort = {
  issue: (identifier: string) => Promise<IssueLike>;
  forum: (identifier: string) => Promise<ForumLike>;
  actorByKey: (key: string) => Promise<ReachActor>;
  comment: (identifier: string, body: string) => Promise<void>;
  reply: (identifier: string, body: string) => Promise<void>;
  sender: () => Promise<ActorEnvelope>;
};
export type AgentDeps = {
  tracker: AgentTrackerPort;
  herdr: Pick<HerdrClient, "list" | "get" | "locations" | "send">;
};

const ActorLikeSchema = z.looseObject({
  key: z.string(),
  kind: z.string(),
  name: z.string(),
  lastSeenAt: z
    .union([z.string(), z.date().transform((d) => d.toISOString())])
    .optional(),
  metadata: ActorMetadataSchema.optional(),
});
function asActor(value: unknown): ReachActor {
  const a = ActorLikeSchema.parse(value);
  return {
    key: a.key,
    kind: a.kind,
    name: a.name,
    ...(a.lastSeenAt === undefined ? {} : { lastSeenAt: a.lastSeenAt }),
    metadata: a.metadata ?? {},
  };
}
async function detailFor(deps: AgentDeps, actor: ReachActor) {
  const terminal = actor.metadata.hcAddress ?? actor.metadata.hcTerminal;
  return terminal === undefined || terminal === ""
    ? null
    : deps.herdr.get(terminal);
}
function senderLabelOf(sender: ActorEnvelope | null): string {
  if (sender === null) return "unknown agent";
  const address = sender.metadata.hcAddress ?? sender.metadata.hcTerminal;
  return address === undefined || address === ""
    ? sender.key
    : `${sender.key} (${address})`;
}

export function trackerPort(context: TrackerCommandContext): AgentTrackerPort {
  const { client } = context;
  return {
    issue: async (identifier) => {
      const issue = await client.issues.byIdentifier.query({ identifier });
      return {
        identifier: issue.identifier,
        title: issue.title,
        creator: asActor(issue.creator),
        assignee: issue.assignee === null ? null : asActor(issue.assignee),
      };
    },
    forum: async (identifier) => {
      const post = await client.forum.byId.query({ id: identifier });
      return {
        identifier: post.identifier,
        title: post.title,
        creator: asActor(post.creator),
        owner: post.owner === null ? null : asActor(post.owner),
      };
    },
    actorByKey: async (key) =>
      asActor(await client.actors.byKey.query({ key })),
    comment: async (identifier, body) => {
      await client.comments.create.mutate({
        actor: await context.actor(),
        identifier,
        body,
      });
    },
    reply: async (identifier, body) => {
      await client.forum.reply.mutate(
        ReplyForumSchema.parse({
          id: identifier,
          body,
          actor: await context.actor(),
        }),
      );
    },
    sender: () => context.actor(),
  };
}

export async function agentReach(
  deps: AgentDeps,
  targetRaw: string,
  options: { to?: string | undefined } = {},
): Promise<ReachResult> {
  const target = parseTarget(targetRaw);
  const [{ terminals, machines }, locations] = await Promise.all([
    deps.herdr.list(),
    deps.herdr.locations(),
  ]);
  if (target.kind === "terminal") {
    return resolveReach({
      target: targetRaw,
      directAddress: target.address,
      terminals,
      machines,
      locations,
    });
  }
  if (target.kind === "actor") {
    const actor = await deps.tracker.actorByKey(options.to ?? target.key);
    const detail = await detailFor(deps, actor);
    return resolveReach({
      target: targetRaw,
      actor,
      role: "actor",
      terminals,
      machines,
      locations,
      detail,
    });
  }
  const source =
    target.kind === "issue"
      ? await deps.tracker.issue(target.identifier)
      : await deps.tracker.forum(target.identifier);
  if (options.to !== undefined && parseTarget(options.to).kind === "terminal") {
    return resolveReach({
      target: targetRaw,
      title: source.title,
      directAddress: options.to,
      terminals,
      machines,
      locations,
    });
  }
  if (
    options.to !== undefined &&
    options.to !== chooseActor(source).actor.key &&
    options.to !==
      ("assignee" in source ? source.assignee?.key : source.owner?.key) &&
    options.to !== source.creator.key
  ) {
    const actor = await deps.tracker.actorByKey(options.to);
    const detail = await detailFor(deps, actor);
    return resolveReach({
      target: targetRaw,
      title: source.title,
      actor,
      role: "override",
      terminals,
      machines,
      locations,
      detail,
    });
  }
  const { actor, role } = chooseActor(source, options.to);
  const detail = await detailFor(deps, actor);
  return resolveReach({
    target: targetRaw,
    title: source.title,
    actor,
    role,
    terminals,
    machines,
    locations,
    detail,
  });
}

export type AgentSendResult = {
  delivered: boolean;
  forced: boolean;
  reach: ReachResult;
  fallback: "comment" | "reply" | null;
  note: string;
};

export async function agentSend(
  deps: AgentDeps,
  targetRaw: string,
  message: string,
  options: {
    to?: string | undefined;
    force?: boolean | undefined;
    fallback?: boolean | undefined;
  } = {},
): Promise<AgentSendResult> {
  const reach = await agentReach(deps, targetRaw, { to: options.to });
  const sender = await deps.tracker.sender().catch(() => null);
  const senderLabel = senderLabelOf(sender);
  const addressed = `from ${senderLabel} re ${targetRaw}: ${message}`;
  const force = options.force === true;
  if ((force || reach.reachable) && reach.address !== null) {
    const sent = await deps.herdr.send(reach.address, addressed, force);
    if (sent.exitCode === 0) {
      return {
        delivered: true,
        forced: force && !reach.reachable,
        reach,
        fallback: null,
        note: `Delivered to ${reach.address} via hc send.`,
      };
    }
    // Fall through to the durable fallback with the hc failure as evidence.
    reach.reason = `hc send to ${reach.address} failed (${String(sent.exitCode)}): ${sent.stderr.trim() || sent.stdout.trim()}`;
  }
  const target = parseTarget(targetRaw);
  const useFallback =
    target.kind !== "terminal" &&
    target.kind !== "actor" &&
    options.fallback !== false;
  if (useFallback) {
    const body = [
      `**Agent message undelivered** — ${reach.reason}`,
      "",
      `From: ${senderLabel}`,
      "",
      message,
    ].join("\n");
    if (target.kind === "issue") {
      await deps.tracker.comment(target.identifier, body);
      return {
        delivered: false,
        forced: false,
        reach,
        fallback: "comment",
        note: `Not delivered live; preserved as a comment on ${target.identifier}.`,
      };
    }
    await deps.tracker.reply(target.identifier, body);
    return {
      delivered: false,
      forced: false,
      reach,
      fallback: "reply",
      note: `Not delivered live; preserved as a reply on ${target.identifier}.`,
    };
  }
  return {
    delivered: false,
    forced: false,
    reach,
    fallback: null,
    note: reach.reason,
  };
}

const HELP = `toolkit agent <COMMAND> <TARGET> [MESSAGE] [OPTIONS]

Reach and message the agent owning a Tracker issue or Forum thread,
resolved through Tracker's actor registry to a live Herdr terminal.

Commands:
  reach <TARGET>               Show the owning actor, live hc address,
                               status, Herdr space/tab, and exact commands
  send <TARGET> <MESSAGE>      Deliver via hc send; dead or blocked
                               targets fall back to a Tracker comment
                               (issue) or Forum reply (thread)

Targets:
  AI-123 | SJ-12               Tracker issue (assignee, else creator)
  FM-45 | <post UUID>          Forum thread (owner, else creator)
  muse:<session>               Actor key from toolkit tracker whoami
  t91 | karpathy/t5d | <name>  Direct hc terminal address

Options:
  --to KEY|ADDRESS             Override the resolved actor or address
  --force                      Send even when the terminal is blocked
  --no-fallback                Fail instead of leaving a Tracker note
  --body TEXT --body-file PATH Message from text or file (send)
  --json --url URL --actor-key KEY --actor-kind KIND --actor-name NAME

Examples:
  toolkit agent reach AI-123 --json
  toolkit agent send FM-45 "blocked on the failing test" 
  toolkit agent send t91 --body-file /tmp/note.md
`;

export async function handleAgentCommand(
  action: string | undefined,
  args: string[],
): Promise<void> {
  if (
    action === undefined ||
    action === "--help" ||
    action === "-h" ||
    args.includes("--help")
  ) {
    console.log(HELP);
    return;
  }
  if (action !== "reach" && action !== "send")
    throw new Error(`Unknown agent command: ${action}`);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      url: { type: "string" },
      "actor-key": { type: "string" },
      "actor-kind": { type: "string" },
      "actor-name": { type: "string" },
      to: { type: "string" },
      force: { type: "boolean", default: false },
      "no-fallback": { type: "boolean", default: false },
      body: { type: "string" },
      "body-file": { type: "string" },
    },
  });
  const context = await trackerContext(values);
  const deps = {
    tracker: trackerPort({
      client: context.client,
      url: context.url,
      actor: context.actor,
    }),
    herdr: new HerdrClient(),
  };
  const target = required(
    positionals[0],
    "Target (AI-123, FM-45, actor key, or hc address)",
  );
  if (action === "reach") {
    const result = await agentReach(deps, target, { to: values.to });
    console.log(JSON.stringify(result, null, values.json ? undefined : 2));
    if (!result.reachable) process.exitCode = 1;
    return;
  }
  const fromFile = await textInput(values.body, values["body-file"]);
  const message = required(
    fromFile ?? (positionals.slice(1).join(" ") || undefined),
    "Message text, --body, or --body-file",
  );
  const result = await agentSend(deps, target, message, {
    to: values.to,
    force: values.force,
    fallback: !values["no-fallback"],
  });
  console.log(JSON.stringify(result, null, values.json ? undefined : 2));
  if (!result.delivered) process.exitCode = 1;
}
