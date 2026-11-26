import {
  FeedbackClaimResponseSchema,
  type FeedbackScope,
} from "@shepherdjerred/artifacts/contract";
import { parseTimeout } from "#lib/ci/arguments.ts";
import { agentWaitHint } from "#lib/ci/wait/agent-hint.ts";
import { formatFeedbackDigest } from "#lib/artifacts/digest.ts";
import { callOptions, type ArtifactsClient } from "#lib/artifacts/client.ts";
import { redactTokens, EXIT, usageError } from "#lib/artifacts/errors.ts";
import { streamLive, type LiveScope } from "#lib/artifacts/live.ts";
import {
  waitForFeedback,
  type WaitDeps,
  type WaitResult,
} from "#lib/artifacts/wait.ts";
import { parseCommandArgs, noPositionals, parseId } from "./options.ts";
import type { Runtime } from "./runtime.ts";
import { BoardSlugSchema } from "@shepherdjerred/artifacts/contract";

export const WAIT_HELP = `toolkit artifacts wait [OPTIONS]

Block until the reviewer comments, print each comment as a markdown digest,
acknowledge it, and exit. Hand each item to a subagent, publish a new version,
\`reply --resolve\`, then run wait again: a second wait returns only newer
comments. By default it covers the artifacts published from this worktree.

Options:
  --board <slug>        Only this board
  --artifact <id>       Only this artifact
  --timeout <duration>  Give up after e.g. 30m or 2h (default: no deadline)
  --url <url>           Service URL (default: ARTIFACTS_URL or config)
  --json                One JSON object {outcome, items} on stdout; notes on stderr

Exit: 0 feedback, 2 usage or service error, 4 the board or artifact is gone,
6 timeout (not a failure), 130 SIGINT, 143 SIGTERM.
`;

const OPTIONS = {
  board: { type: "string" },
  artifact: { type: "string" },
  timeout: { type: "string" },
  url: { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

function describeElapsed(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60
    ? `${String(minutes)}m`
    : `${String(Math.floor(minutes / 60))}h${String(minutes % 60).padStart(2, "0")}m`;
}

function render(
  result: Exclude<WaitResult, { outcome: "interrupted" }>,
  json: boolean,
  timeout = "the requested deadline",
): string {
  if (json)
    return `${redactTokens(
      JSON.stringify({
        outcome: result.outcome,
        items: result.outcome === "feedback" ? result.items : [],
      }),
    )}\n`;
  switch (result.outcome) {
    case "feedback":
      return formatFeedbackDigest(result.items);
    case "timeout":
      return `Timed out after ${timeout} with no new feedback. This is not a failure. Run \`toolkit artifacts wait\` again to keep waiting.\n`;
    case "gone":
      return "The board or artifact being waited on was archived, expired, or deleted, so no feedback can arrive. Run `toolkit artifacts list` to see what is still published.\n";
  }
}

type WaitPlan = {
  scope: FeedbackScope | undefined;
  live: LiveScope;
  timeoutMs: number | undefined;
  json: boolean;
  url: string | undefined;
  timeout: string | undefined;
};

function planWait(args: string[]): WaitPlan | "help" {
  const { values, positionals } = parseCommandArgs("wait", args, OPTIONS);
  if (values.help) return "help";
  noPositionals("wait", positionals);
  const { board, artifact } = values;
  if (board !== undefined && artifact !== undefined)
    throw usageError("Pass --board or --artifact, not both.");
  if (board !== undefined && !BoardSlugSchema.safeParse(board).success)
    throw usageError(
      "--board must be a board slug, as printed by `toolkit artifacts boards`.",
    );
  const artifactId =
    artifact === undefined ? undefined : parseId(artifact, "--artifact");
  const scope: FeedbackScope | undefined =
    board === undefined
      ? artifactId === undefined
        ? undefined
        : { type: "artifact", artifactId }
      : { type: "board", board };
  return {
    scope,
    live: {
      ...(board === undefined ? {} : { board }),
      ...(artifactId === undefined ? {} : { artifact: artifactId }),
    },
    timeoutMs:
      values.timeout === undefined ? undefined : parseTimeout(values.timeout),
    json: values.json,
    url: values.url,
    timeout: values.timeout,
  };
}

function describeTarget(scope: FeedbackScope | undefined): string {
  if (scope === undefined) return "the artifacts published from this worktree";
  switch (scope.type) {
    case "board":
      return `board ${scope.board}`;
    case "artifact":
      return `artifact ${scope.artifactId}`;
    case "owner":
      return "the artifacts published from this worktree";
  }
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? redactTokens(error.message) : "unknown error";
}

/** The service calls a wait makes, bound to one client and scope. */
function waitDeps(
  client: ArtifactsClient,
  plan: WaitPlan,
  runtime: Runtime,
): WaitDeps {
  const { scope } = plan;
  return {
    claim: async (signal) => {
      try {
        return FeedbackClaimResponseSchema.parse(
          await client.trpc.feedback.claim.mutate(
            scope === undefined ? {} : { scope },
            callOptions(signal),
          ),
        );
      } catch (error) {
        throw client.explain(error);
      }
    },
    ack: async (commentIds) => {
      try {
        await client.trpc.feedback.ack.mutate({ commentIds });
      } catch (error) {
        throw client.explain(error);
      }
    },
    stream: (signal) => streamLive(client, plan.live, signal),
    present: (items) =>
      runtime.io.stdout(
        plan.json
          ? `${redactTokens(JSON.stringify({ outcome: "feedback", items }))}\n`
          : formatFeedbackDigest(items),
      ),
    heartbeat: ({ elapsedMs, connected }) => {
      runtime.io.stderr(
        `Still waiting for feedback (${describeElapsed(elapsedMs)}; stream ${connected ? "connected" : "reconnecting"}).`,
      );
    },
    reconnecting: (error, delayMs) => {
      runtime.io.stderr(
        `Feedback stream dropped (${error === null ? "stream closed" : describeFailure(error)}); reconnecting in ${(delayMs / 1000).toFixed(1)}s.`,
      );
    },
  };
}

export async function waitCommand(
  args: string[],
  runtime: Runtime,
): Promise<number> {
  const plan = planWait(args);
  if (plan === "help") {
    await runtime.io.stdout(WAIT_HELP);
    return EXIT.ok;
  }
  const client = await runtime.connect({ url: plan.url, actor: "required" });
  if (client.actor?.kind === "human" && plan.scope === undefined)
    throw usageError(
      "A human caller has no worktree to scope a wait to: pass --board <slug> or --artifact <id>.",
    );
  runtime.io.stderr(
    `Waiting for review feedback on ${describeTarget(plan.scope)}. Keep this process running; it returns as soon as a comment arrives.`,
  );
  const hint = agentWaitHint(runtime.env);
  if (hint !== null) runtime.io.stderr(hint);

  const result = await waitForFeedback(waitDeps(client, plan, runtime), {
    ...runtime.wait,
    timeoutMs: plan.timeoutMs,
    signal: runtime.signal,
    notFoundIsGone: plan.scope !== undefined,
  });

  if (result.outcome === "interrupted") {
    runtime.io.stderr(
      "Interrupted; any comment already claimed will be redelivered by the next wait.",
    );
    return runtime.interruptExit?.() ?? EXIT.sigint;
  }
  if (result.outcome === "feedback") {
    if (result.ackError !== undefined)
      runtime.io.stderr(
        `Could not acknowledge the delivered comments (${describeFailure(result.ackError)}); the next wait may deliver them again.`,
      );
    return EXIT.ok;
  }
  await runtime.io.stdout(render(result, plan.json, plan.timeout));
  return result.outcome === "timeout" ? EXIT.timeout : EXIT.gone;
}
