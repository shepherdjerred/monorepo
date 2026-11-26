import { callOptions } from "#lib/artifacts/client.ts";
import { EXIT, usageError } from "#lib/artifacts/errors.ts";
import { readTextFile } from "./files.ts";
import { onlyPositional, parseCommandArgs, parseId } from "./options.ts";
import type { Runtime } from "./runtime.ts";

export const REPLY_HELP = `toolkit artifacts reply <threadId> --body-file <file|-> [--resolve] [--json]

Answer a review thread as the agent. --resolve closes it in the same step.
The thread id is printed in each digest \`wait\` returns.

toolkit artifacts resolve <threadId> [--json]

Close a thread without a reply.

Options:
  --body-file <file|->  The reply text (- reads stdin)
  --resolve             Resolve the thread with the reply
  --url <url>           Service URL (default: ARTIFACTS_URL or config)
  --json                Print the updated thread as JSON
`;

const REPLY_OPTIONS = {
  "body-file": { type: "string" },
  resolve: { type: "boolean", default: false },
  url: { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

const RESOLVE_OPTIONS = {
  url: { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

export async function replyCommand(
  args: string[],
  runtime: Runtime,
): Promise<number> {
  const { values, positionals } = parseCommandArgs(
    "reply",
    args,
    REPLY_OPTIONS,
  );
  if (values.help) {
    await runtime.io.stdout(REPLY_HELP);
    return EXIT.ok;
  }
  const threadId = parseId(
    onlyPositional("reply", positionals, "threadId"),
    "threadId",
  );
  if (values["body-file"] === undefined)
    throw usageError("reply needs --body-file <file> (or - for stdin).");
  const text = await readTextFile(runtime, values["body-file"], "--body-file");
  const body = text.trim();
  if (body === "") throw usageError("The reply body is empty.");
  const client = await runtime.connect({ url: values.url, actor: "required" });
  try {
    const thread = await client.trpc.threads.reply.mutate(
      { threadId, body, resolve: values.resolve },
      callOptions(runtime.signal),
    );
    await runtime.io.stdout(
      values.json
        ? `${JSON.stringify(thread)}\n`
        : `Replied to thread ${thread.id}${thread.state === "resolved" ? " and resolved it" : ""}.\n`,
    );
    return EXIT.ok;
  } catch (error) {
    throw client.explain(error);
  }
}

export async function resolveCommand(
  args: string[],
  runtime: Runtime,
): Promise<number> {
  const { values, positionals } = parseCommandArgs(
    "resolve",
    args,
    RESOLVE_OPTIONS,
  );
  if (values.help) {
    await runtime.io.stdout(REPLY_HELP);
    return EXIT.ok;
  }
  const threadId = parseId(
    onlyPositional("resolve", positionals, "threadId"),
    "threadId",
  );
  const client = await runtime.connect({ url: values.url, actor: "required" });
  try {
    const thread = await client.trpc.threads.resolve.mutate(
      { threadId },
      callOptions(runtime.signal),
    );
    await runtime.io.stdout(
      values.json
        ? `${JSON.stringify(thread)}\n`
        : `Resolved thread ${thread.id}.\n`,
    );
    return EXIT.ok;
  } catch (error) {
    throw client.explain(error);
  }
}
