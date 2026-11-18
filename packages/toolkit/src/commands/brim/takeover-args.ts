import { parseArgs } from "node:util";
import { TakeoverError } from "#lib/brim/takeover/errors.ts";
import { resolveBrimProvider } from "#lib/brim/takeover/providers.ts";

export const TAKEOVER_USAGE = `
brim takeover — hand off an interrupted agent session to another subscription

Resolves an agent session (by history ID, Herdr terminal, or current workspace),
writes a clean Markdown handoff transcript to ~/.toolkit/takeovers/, ranks
remaining Brim subscriptions (excluding the exhausted source provider), and
starts the next provider with the takeover prompt:

  brim takeover [<history-id>] [options] [-- <extra agent args...>]
  brim takeover [<history-id>] --herdr [--keep-open] [--to <provider>]
  brim takeover [<history-id>] --prepare [--json] [--terminal <addr>] [--note <text>]

Options:
  --terminal <addr>     Inspect Herdr terminal <addr> for cwd, provider, and prompt
                        (defaults to $HC_TERMINAL_ID when --herdr is set)
  --from <provider>     Source provider id or alias (overrides terminal inference)
  --to <provider>       Target provider id or alias (also --provider <id>)
  --exclude <provider>  Additional provider(s) to exclude (repeatable or comma list)
  --cwd <dir>           Workspace directory override
  --note <text>         User handoff note included in the Markdown file and prompt
  --output-dir <dir>    Directory for handoff Markdown files (default ~/.toolkit/takeovers)
  --prepare             Write handoff Markdown and build prompt without launching
  --herdr               Replace the Herdr tab/pane in place (creates new before closing old)
  --keep-open           With --herdr, keep the previous tab/pane open
  --min-5h <pct>        Minimum 5-hour remaining percent to stay available (default 10)
  --snapshots <path>    Read Brim snapshots from <path> instead of Brim's cache
  --no-interactive      Never show the picker; choose the top-ranked provider
  --dry-run             Resolve, write handoff, and print the target command without launching
  --json                Emit structured JSON output
  -h, --help            Show this help message
`;

export type ParsedTakeoverArgs = {
  readonly help: boolean;
  readonly historyId: number | undefined;
  readonly terminal: string | undefined;
  readonly from: string | undefined;
  readonly to: string | undefined;
  readonly exclude: readonly string[];
  readonly cwd: string | undefined;
  readonly note: string | undefined;
  readonly outputDir: string | undefined;
  readonly prepare: boolean;
  readonly herdr: boolean;
  readonly keepOpen: boolean;
  readonly minRemaining: number;
  readonly snapshotsPath: string | undefined;
  readonly noInteractive: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly extraArgs: readonly string[];
};

function splitExcludeValues(values: readonly string[] | undefined): string[] {
  return values === undefined
    ? []
    : values
        .flatMap((entry) => entry.split(","))
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

function parseHistoryIdArg(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new TakeoverError(
      `Invalid <history-id> "${raw}": expected a positive integer.`,
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TakeoverError(
      `Invalid <history-id> "${raw}": expected a positive integer.`,
    );
  }
  return parsed;
}

function runRawParseArgs(args: readonly string[]) {
  try {
    return parseArgs({
      args: [...args],
      allowPositionals: true,
      tokens: true,
      options: {
        terminal: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        provider: { type: "string" },
        exclude: { type: "string", multiple: true },
        cwd: { type: "string" },
        note: { type: "string" },
        "output-dir": { type: "string" },
        prepare: { type: "boolean", default: false },
        herdr: { type: "boolean", default: false },
        "keep-open": { type: "boolean", default: false },
        "min-5h": { type: "string", default: "10" },
        snapshots: { type: "string" },
        "no-interactive": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error: unknown) {
    throw new TakeoverError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function splitPositionalTokens(
  tokens: ReturnType<typeof runRawParseArgs>["tokens"],
): { readonly beforeTerminator: string[]; readonly extraArgs: string[] } {
  const terminator = tokens.find((token) => token.kind === "option-terminator");
  const beforeTerminator: string[] = [];
  const extraArgs: string[] = [];
  for (const token of tokens) {
    if (token.kind !== "positional") {
      continue;
    }
    if (terminator === undefined || token.index < terminator.index) {
      beforeTerminator.push(token.value);
    } else {
      extraArgs.push(token.value);
    }
  }
  if (beforeTerminator.length > 1) {
    throw new TakeoverError(
      `Unexpected positional arguments: ${beforeTerminator.slice(1).join(" ")} (pass extra agent flags after \`--\`).`,
    );
  }
  return { beforeTerminator, extraArgs };
}

function resolveTargetOption(
  toValue: string | undefined,
  providerValue: string | undefined,
): string | undefined {
  if (
    toValue !== undefined &&
    providerValue !== undefined &&
    resolveBrimProvider(toValue) !== resolveBrimProvider(providerValue)
  ) {
    throw new TakeoverError(
      `Conflicting target flags: --to "${toValue}" vs --provider "${providerValue}".`,
    );
  }
  return toValue ?? providerValue;
}

export function parseTakeoverArgs(args: readonly string[]): ParsedTakeoverArgs {
  const parsed = runRawParseArgs(args);
  const { beforeTerminator, extraArgs } = splitPositionalTokens(parsed.tokens);
  const { values } = parsed;

  const minRemaining = Number.parseFloat(values["min-5h"]);
  if (
    !Number.isFinite(minRemaining) ||
    minRemaining < 0 ||
    minRemaining > 100
  ) {
    throw new TakeoverError("--min-5h must be a number between 0 and 100.");
  }
  if (values["keep-open"] && !values.herdr) {
    throw new TakeoverError("--keep-open requires --herdr.");
  }

  return {
    help: values.help,
    historyId: parseHistoryIdArg(beforeTerminator[0]),
    terminal: values.terminal,
    from: values.from,
    to: resolveTargetOption(values.to, values.provider),
    exclude: splitExcludeValues(values.exclude),
    cwd: values.cwd,
    note: values.note,
    outputDir: values["output-dir"],
    prepare: values.prepare,
    herdr: values.herdr,
    keepOpen: values["keep-open"],
    minRemaining,
    snapshotsPath: values.snapshots,
    noInteractive: values["no-interactive"],
    dryRun: values["dry-run"],
    json: values.json,
    extraArgs,
  };
}
