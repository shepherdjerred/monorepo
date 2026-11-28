import {
  ArtifactsCliError,
  EXIT,
  redactTokens,
} from "#lib/artifacts/errors.ts";
import { publishCommand, PUBLISH_HELP } from "./publish.ts";
import {
  boardsCommand,
  guideCommand,
  listCommand,
  READ_HELP,
  showCommand,
} from "./read.ts";
import { replyCommand, resolveCommand, REPLY_HELP } from "./reply.ts";
import type { Runtime } from "./runtime.ts";
import { waitCommand, WAIT_HELP } from "./wait.ts";

export const ARTIFACTS_HELP = `toolkit artifacts - publish for review, wait for comments, reply

  publish <path...>        Publish files or a site; prints the review URL first
  wait                     Block until the reviewer comments; print the digest
  reply <threadId>         Answer a thread (--body-file F [--resolve])
  resolve <threadId>       Close a thread
  list | show <id> | boards | guide [<name>]

The loop: publish, then hold one \`wait\`. Hand each comment to a subagent,
publish a new version with \`publish <path> --version-of <artifactId>\`,
\`reply <threadId> --body-file F --resolve\`, and \`wait\` again.

Exit codes: 0 ok, 2 usage or service error, 4 gone, 6 wait timeout (not a
failure), 130 SIGINT, 143 SIGTERM. \`toolkit artifacts <command> --help\` lists
each command's options. An "Unknown command" from this binary means it is stale:
run \`bun run --cwd packages/toolkit install:local\`.
`;

const HELP_BY_COMMAND: Readonly<Record<string, string>> = {
  publish: PUBLISH_HELP,
  wait: WAIT_HELP,
  reply: REPLY_HELP,
  resolve: REPLY_HELP,
  list: READ_HELP,
  show: READ_HELP,
  boards: READ_HELP,
  guide: READ_HELP,
};

type CommandRunner = (args: string[], runtime: Runtime) => Promise<number>;

const COMMANDS: Readonly<Record<string, CommandRunner>> = {
  publish: publishCommand,
  wait: waitCommand,
  reply: replyCommand,
  resolve: resolveCommand,
  list: listCommand,
  show: showCommand,
  boards: boardsCommand,
  guide: guideCommand,
};

/**
 * Runs one `toolkit artifacts` command and returns its exit code. Failures
 * print one stderr line naming the fix and exit 2.
 */
export async function artifactsCommand(
  subcommand: string | undefined,
  args: string[],
  runtime: Runtime,
): Promise<number> {
  if (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h" ||
    subcommand === "help"
  ) {
    await runtime.io.stdout(ARTIFACTS_HELP);
    return EXIT.ok;
  }
  const run = COMMANDS[subcommand];
  if (run === undefined) {
    runtime.io.stderr(
      `Unknown artifacts command: ${subcommand}. Commands: ${Object.keys(HELP_BY_COMMAND).join(", ")}. If the command exists in the README, this binary is stale: run \`bun run --cwd packages/toolkit install:local\`.`,
    );
    return EXIT.error;
  }
  try {
    return await run(args, runtime);
  } catch (error) {
    if (runtime.signal?.aborted === true)
      return runtime.interruptExit?.() ?? EXIT.sigint;
    if (error instanceof ArtifactsCliError) {
      runtime.io.stderr(redactTokens(error.message));
      return error.exitCode;
    }
    runtime.io.stderr(
      redactTokens(error instanceof Error ? error.message : String(error)),
    );
    return EXIT.error;
  }
}
