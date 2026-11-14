import {
  SCOUT_OPS_HELP,
  parseScoutOpsArgs,
  runScoutOps,
} from "#commands/scout/ops.ts";
import { resolveCredentials } from "#lib/credentials.ts";
import {
  SCOUT_OPERATIONS_ORIGINS,
  SCOUT_OPERATIONS_TOKEN_CREDENTIALS,
  ScoutOperationsError,
  scoutOperationsClient,
} from "#lib/scout-operations/client.ts";

const SCOUT_HELP = `toolkit scout <command>

Commands:
  ops   Operate Scout's durable pipeline (queues, unknown deliveries, report chunks)

Run \`toolkit scout ops --help\` for details.`;

export async function handleScoutCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    console.log(SCOUT_HELP);
    return;
  }
  if (subcommand !== "ops") {
    throw new Error(`Unknown scout command: ${subcommand}\n\n${SCOUT_HELP}`);
  }
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(SCOUT_OPS_HELP);
    return;
  }

  let parsed: Awaited<ReturnType<typeof parseScoutOpsArgs>>;
  try {
    parsed = await parseScoutOpsArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  const credential = SCOUT_OPERATIONS_TOKEN_CREDENTIALS[parsed.environment];
  const dryRun =
    parsed.invocation.action === "submit" && parsed.invocation.dryRun;
  // A dry run sends nothing, so it spends no 1Password read.
  if (!dryRun) await resolveCredentials([credential]);
  const client = () => {
    const token = Bun.env[credential];
    if (token === undefined || token === "") {
      throw new Error(`${credential} did not resolve to a token`);
    }
    return scoutOperationsClient({
      origin: parsed.url ?? SCOUT_OPERATIONS_ORIGINS[parsed.environment],
      token,
    });
  };

  try {
    process.exitCode = await runScoutOps(parsed, client, (line) => {
      console.log(line);
    });
  } catch (error) {
    if (error instanceof ScoutOperationsError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}
