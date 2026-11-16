import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { openingPromptHash } from "#lib/history/query/messages.ts";
import { TakeoverError } from "./errors.ts";
import { resolveBrimProvider, type BrimProviderId } from "./providers.ts";

export type HcCommandResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

export type HcCommandRunner = (
  args: readonly string[],
) => Promise<HcCommandResult>;

export type InspectedTerminal = {
  readonly address: string;
  readonly cwd: string | null;
  readonly createdMs: number | null;
  readonly space: string | null;
  readonly tab: string | null;
  readonly where: string | null;
  readonly statusState: string | null;
  readonly sourceProvider: BrimProviderId | null;
  readonly initialPrompt: string | null;
  readonly promptHash: string | null;
};

const HcForegroundSchema = z.object({
  argv: z.array(z.string()).nullish(),
  cwd: z.string().nullish(),
  name: z.string().nullish(),
  pid: z.number().nullish(),
});

const HcStatusObjectSchema = z.object({
  app: z.string().nullish(),
  state: z.string().nullish(),
});

const HcTerminalGetSchema = z.object({
  address: z.string().min(1),
  cwd: z.string().nullish(),
  created_ms: z.number().nullish(),
  argv: z.array(z.string()).nullish(),
  foreground: HcForegroundSchema.nullish(),
  labels: z.record(z.string(), z.string()).nullish(),
  status: z.union([HcStatusObjectSchema, z.string()]).nullish(),
});

const HcErrorEnvelopeSchema = z.object({
  error: z.union([z.string(), z.object({ message: z.string().optional() })]),
});

const SHELL_OR_RUNTIME_NAMES = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "node",
  "bun",
]);

function nonEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value.trim().length > 0 ? value : null;
}

function executableBasename(token: string): string {
  const leaf = token.split(/[\\/]/u).at(-1) ?? token;
  return leaf.replace(/\.(?:exe|cmd|bat|mjs|cjs|js)$/iu, "").toLowerCase();
}

function isEnvAssignment(token: string): boolean {
  return token.includes("=") && !token.startsWith("-");
}

function skipEnvFlagsAndVars(
  argv: readonly string[],
  startIndex: number,
): readonly string[] {
  let index = startIndex;
  while (index < argv.length) {
    const token = argv[index] ?? "";
    if (token === "-u") {
      index += 2;
    } else if (token === "-i" || token === "--" || isEnvAssignment(token)) {
      index += 1;
    } else {
      break;
    }
  }
  return argv.slice(index);
}

function skipEnvPrefix(argv: readonly string[]): readonly string[] {
  const first = argv[0];
  if (first !== undefined && executableBasename(first) === "env") {
    return skipEnvFlagsAndVars(argv, 1);
  }
  let index = 0;
  while (index < argv.length && isEnvAssignment(argv[index] ?? "")) {
    index += 1;
  }
  return argv.slice(index);
}

function brimArgvOptionsSlice(
  argv: readonly string[],
): readonly string[] | null {
  const first = argv[0];
  if (first === undefined) {
    return null;
  }
  const base = executableBasename(first);
  if (base === "brim") {
    return argv.slice(1);
  }
  return base === "toolkit" && argv[1] === "brim" ? argv.slice(2) : null;
}

function providerFromBrimArgv(argv: readonly string[]): BrimProviderId | null {
  const options = brimArgvOptionsSlice(argv);
  if (options === null) {
    return null;
  }
  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (token === undefined || token === "--") {
      break;
    }
    if (token === "--provider") {
      const value = options[index + 1];
      return value === undefined ? null : resolveBrimProvider(value);
    }
    if (token.startsWith("--provider=")) {
      return resolveBrimProvider(token.slice("--provider=".length));
    }
  }
  return null;
}

function providerFromShellScript(script: string): BrimProviderId | null {
  const words = script
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  const firstWord = words[0];
  return firstWord === undefined
    ? null
    : (providerFromBrimArgv(words) ??
        resolveBrimProvider(executableBasename(firstWord)));
}

function providerFromPositionalTail(tail: readonly string[]): {
  readonly resolved: BrimProviderId | null;
  readonly skip: boolean;
} {
  const fromBrim = providerFromBrimArgv(tail);
  if (fromBrim !== null) {
    return { resolved: fromBrim, skip: false };
  }
  const base = executableBasename(tail[0] ?? "");
  return SHELL_OR_RUNTIME_NAMES.has(base)
    ? { resolved: null, skip: true }
    : { resolved: resolveBrimProvider(base), skip: false };
}

function providerFromRuntimeTail(
  tail: readonly string[],
): BrimProviderId | null {
  for (let index = 0; index < tail.length; index += 1) {
    const token = tail[index];
    if (token === undefined || token === "--") {
      break;
    }
    if (/^-[a-z]*c$/iu.test(token)) {
      const fromScript = providerFromShellScript(tail[index + 1] ?? "");
      if (fromScript !== null) {
        return fromScript;
      }
      index += 1;
      continue;
    }
    if (!token.startsWith("-")) {
      const { resolved, skip } = providerFromPositionalTail(tail.slice(index));
      if (!skip) {
        return resolved;
      }
    }
  }
  return null;
}

export function inferProviderFromArgv(
  argv: readonly string[],
): BrimProviderId | null {
  const rest = skipEnvPrefix(argv);
  const first = rest[0];
  if (first === undefined) {
    return null;
  }
  const fromBrim = providerFromBrimArgv(rest);
  if (fromBrim !== null) {
    return fromBrim;
  }
  const base = executableBasename(first);
  const direct = resolveBrimProvider(base);
  if (direct !== null) {
    return direct;
  }
  return SHELL_OR_RUNTIME_NAMES.has(base)
    ? providerFromRuntimeTail(rest.slice(1))
    : null;
}

function findInteractiveFlagPrompt(tokens: readonly string[]): string | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    if (token === "-i" || token === "--prompt-interactive") {
      return nonEmpty(tokens[index + 1]);
    }
    if (token.startsWith("-i=") && token.length > 3) {
      return nonEmpty(token.slice(3));
    }
    if (token.startsWith("--prompt-interactive=")) {
      return nonEmpty(token.slice("--prompt-interactive=".length));
    }
  }
  return null;
}

export function extractInitialPrompt(argv: readonly string[]): string | null {
  const firstDash = argv.indexOf("--");
  const head = firstDash === -1 ? argv : argv.slice(0, firstDash);
  const headFlag = findInteractiveFlagPrompt(head);
  if (headFlag !== null) {
    return headFlag;
  }
  if (firstDash === -1) {
    return null;
  }
  const afterFirst = argv.slice(firstDash + 1);
  if (afterFirst.length >= 2) {
    const tailFlag = findInteractiveFlagPrompt(afterFirst);
    if (tailFlag !== null) {
      return tailFlag;
    }
  }
  const lastDash = argv.lastIndexOf("--");
  return nonEmpty(argv.slice(lastDash + 1).at(-1));
}

function extractStatusFields(
  status: z.infer<typeof HcTerminalGetSchema>["status"],
): { readonly app: string | null; readonly state: string | null } {
  if (status === null || status === undefined) {
    return { app: null, state: null };
  }
  if (typeof status === "string") {
    return { app: null, state: nonEmpty(status) };
  }
  return {
    app: nonEmpty(status.app),
    state: nonEmpty(status.state),
  };
}

function decodeHcTerminalData(
  rawJson: string,
): z.infer<typeof HcTerminalGetSchema> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawJson);
  } catch (error: unknown) {
    throw new TakeoverError(
      `Failed to parse \`hc get\` JSON output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const errorCheck = HcErrorEnvelopeSchema.safeParse(decoded);
  if (errorCheck.success) {
    const detail =
      typeof errorCheck.data.error === "string"
        ? errorCheck.data.error
        : (errorCheck.data.error.message ?? "unknown hc error");
    throw new TakeoverError(`hc get failed: ${detail}`);
  }
  const parsed = HcTerminalGetSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new TakeoverError(
      `Unexpected \`hc get\` JSON shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

function inferTerminalProvider(
  data: z.infer<typeof HcTerminalGetSchema>,
  app: string | null,
): BrimProviderId | null {
  const fgName = data.foreground?.name;
  return (
    (app === null ? null : resolveBrimProvider(app)) ??
    inferProviderFromArgv(data.foreground?.argv ?? []) ??
    inferProviderFromArgv(data.argv ?? []) ??
    (fgName == null ? null : resolveBrimProvider(executableBasename(fgName)))
  );
}

export function parseHcTerminalJson(rawJson: string): InspectedTerminal {
  const data = decodeHcTerminalData(rawJson);
  const { app, state: statusState } = extractStatusFields(data.status);
  const sourceProvider = inferTerminalProvider(data, app);
  const initialPrompt =
    extractInitialPrompt(data.foreground?.argv ?? []) ??
    extractInitialPrompt(data.argv ?? []);
  return {
    address: data.address,
    cwd: nonEmpty(data.foreground?.cwd) ?? nonEmpty(data.cwd),
    createdMs: data.created_ms ?? null,
    space: nonEmpty(data.labels?.["herdr.space"]),
    tab: nonEmpty(data.labels?.["herdr.tab"]),
    where: nonEmpty(data.labels?.["where"]),
    statusState,
    sourceProvider,
    initialPrompt,
    promptHash: openingPromptHash(initialPrompt),
  };
}

export function resolveHcBinary(home: string = os.homedir()): string {
  const localBin = path.join(home, ".local", "bin");
  const resolved = Bun.which("hc", { PATH: localBin }) ?? Bun.which("hc");
  if (resolved === null) {
    throw new TakeoverError(
      `Could not find \`hc\` in ${localBin} or PATH. Install herdr-core first.`,
    );
  }
  return resolved;
}

export const defaultHcRunner: HcCommandRunner = async (args) => {
  const binary = resolveHcBinary();
  const child = Bun.spawn([binary, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
};

export async function inspectTerminal(
  address: string,
  runHc: HcCommandRunner = defaultHcRunner,
): Promise<InspectedTerminal> {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    throw new TakeoverError("Terminal address must not be empty.");
  }
  const result = await runHc(["get", trimmed, "--json"]);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new TakeoverError(
      `hc get ${trimmed} exited with code ${String(result.exitCode)}${detail.length > 0 ? `: ${detail}` : ""}`,
    );
  }
  return parseHcTerminalJson(result.stdout);
}
