/**
 * Fish fidelity: agent CLIs are launched through the user's interactive fish
 * functions and abbreviation expansions, not by bare-executing binaries.
 *
 * `claude` is an abbreviation, and abbreviations only expand while typing in
 * the interactive editor — never inside a `fish -i -c` program. So spawning
 * `fish -i -c 'claude ...'` would silently run the bare `claude` binary,
 * dropping the `--allow-dangerously-skip-permissions` flag and the `env -u`
 * credential scrubbing. Instead the expansion is resolved at runtime and
 * spliced into the program, while functions (`codex`, `opencode`, `agy`,
 * `grok`, `muse`, defined under `if status is-interactive`) are invoked by
 * name. Only the fish *word* per provider is hardcoded here;
 * expansions are resolved at runtime, so editing
 * `~/.config/fish/config.fish` needs no CLI change.
 */

/** Brim provider id -> fish word. Null means no word is configured. */
export const FISH_WORDS: Record<string, string | null> = {
  "claude-code": "claude",
  codex: "codex",
  antigravity: "agy",
  cursor: null,
  grok: "grok",
  kimi: null,
  muse: "muse",
};

export function fishWord(provider: string): string | null {
  return FISH_WORDS[provider] ?? null;
}

/**
 * Providers without a fish word fall back to a bare binary, spawned
 * directly (no fish flags, no env scrubbing — there is no wrapper to honor).
 * A missing binary is a clean error at spawn time, so mapping an
 * as-yet-uninstalled CLI (Kimi) is safe: it starts working on install.
 */
const DIRECT_BINARIES: Record<string, string> = {
  cursor: "cursor-agent",
  grok: "grok",
  kimi: "kimi",
};

export function directBinary(provider: string): string | null {
  return DIRECT_BINARIES[provider] ?? null;
}

export type ResolvedFishEntry =
  | { readonly kind: "function"; readonly body: string }
  | { readonly kind: "abbr"; readonly expansion: string }
  | { readonly kind: "none" };

export type FishRunner = (args: string[]) => Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}>;

async function defaultRunner(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  // Bun.$ interpolates the array with shell escaping; quiet() captures the
  // streams instead of inheriting them, nothrow() surfaces the exit code.
  const result = await Bun.$`fish ${args}`.nothrow().quiet();
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

const ESCAPE = String.fromCodePoint(27);

function stripAnsi(output: string): string {
  // Interactive fish emits cursor-shape sequences (CSI Ps SP q).
  return output.replaceAll(
    new RegExp(String.raw`${ESCAPE}\[[0-9;?]* ?[a-zA-Z]`, "gu"),
    "",
  );
}

/**
 * Resolve how interactive fish defines `word`: a function body, an
 * abbreviation expansion, or nothing. Runs at most two `fish -i -c` probes
 * (~90ms each).
 *
 * The abbreviation probe extracts just this word's expansion and unescapes
 * it fish-side, so the result splices directly into a `-c` program. Words
 * here are hardcoded `[a-z]+` ids, safe to interpolate into the match
 * pattern.
 */
export async function resolveFishEntry(
  word: string,
  run: FishRunner = defaultRunner,
): Promise<ResolvedFishEntry> {
  const fn = await run(["-i", "-c", `functions ${word}`]);
  if (fn.exitCode === 0 && stripAnsi(fn.stdout).trim().length > 0) {
    return { kind: "function", body: stripAnsi(fn.stdout).trim() };
  }
  const abbr = await run([
    "-i",
    "-c",
    `abbr --show | string match -r -g -- '^abbr -a -- ${word} (.*)$' | string unescape --style=script`,
  ]);
  const expansion = stripAnsi(abbr.stdout).trim();
  return abbr.exitCode === 0 && expansion.length > 0
    ? { kind: "abbr", expansion }
    : { kind: "none" };
}

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", String.raw`'\''`)}'`;
}

/** The `fish -i -c` program invoking a function word with quoted args. */
export function fishSpawnProgram(word: string, extraArgs: string[]): string {
  return [word, ...extraArgs.map((arg) => shellQuote(arg))].join(" ");
}

export type SpawnResult = { readonly exitCode: number };

/**
 * Resolve the exact `fish -i -c` program for `word`: functions run by name,
 * abbreviations run as their expansion (bare words never expand inside `-c`,
 * so spawning the word would silently drop wrapper flags and env scrubbing).
 * Throws when fish defines neither.
 */
export async function resolveFishProgram(
  word: string,
  extraArgs: string[],
  run: FishRunner = defaultRunner,
): Promise<string> {
  const resolved = await resolveFishEntry(word, run);
  if (resolved.kind === "function") {
    return fishSpawnProgram(word, extraArgs);
  }
  if (resolved.kind === "abbr") {
    return [resolved.expansion, ...extraArgs.map((arg) => shellQuote(arg))]
      .join(" ")
      .trim();
  }
  throw new Error(
    `fish defines neither a function nor an abbreviation for "${word}".`,
  );
}

/** Spawn an agent session through interactive fish with inherited stdio. */
/**
 * Pure `fish -i -c` program builder for a resolved entry. Returns null when
 * fish defines neither a function nor an abbreviation for the word.
 */
export function buildFishProgram(
  word: string,
  entry: ResolvedFishEntry,
  extraArgs: string[],
): string | null {
  if (entry.kind === "function") {
    return fishSpawnProgram(word, extraArgs);
  }
  return entry.kind === "abbr"
    ? [entry.expansion, ...extraArgs.map((arg) => shellQuote(arg))]
        .join(" ")
        .trim()
    : null;
}

/** Resolve entries for several words in parallel, keyed by word. */
export async function resolveFishEntries(
  words: readonly string[],
  run: FishRunner = defaultRunner,
): Promise<ReadonlyMap<string, ResolvedFishEntry>> {
  const pairs = await Promise.all(
    words.map(async (word) => {
      const entry = await resolveFishEntry(word, run);
      return [word, entry] as const;
    }),
  );
  return new Map(pairs);
}

export async function spawnFishProgram(program: string): Promise<SpawnResult> {
  const proc = Bun.spawn(["fish", "-i", "-c", program], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return { exitCode: await proc.exited };
}

type NoFishCommand = {
  readonly argv: string[];
  /** Env vars the fish wrappers deliberately scrub; never leak them. */
  readonly scrubEnv: readonly string[];
};

/**
 * Last-resort `--no-fish` table. This duplicates `~/.config/fish/config.fish`
 * and can drift when that file changes; prefer the default fish-resolved
 * spawn. Kept explicit so a non-fish fallback never leaks provider API keys
 * into agent processes.
 */
const NO_FISH_COMMANDS: Record<string, NoFishCommand> = {
  "claude-code": {
    argv: ["claude", "--allow-dangerously-skip-permissions"],
    scrubEnv: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"],
  },
  codex: {
    argv: ["codex"],
    scrubEnv: ["OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY"],
  },
  antigravity: {
    argv: ["agy", "--dangerously-skip-permissions"],
    scrubEnv: [],
  },
  cursor: { argv: ["cursor-agent"], scrubEnv: [] },
  kimi: { argv: ["kimi"], scrubEnv: [] },
  grok: { argv: ["grok"], scrubEnv: [] },
  muse: { argv: ["muse", "--yolo", "--disable-sandbox"], scrubEnv: [] },
};

export function noFishCommand(provider: string): NoFishCommand | null {
  return NO_FISH_COMMANDS[provider] ?? null;
}

export type DirectSpawnResult = { readonly exitCode: number };

/** Spawn a bare provider binary directly with inherited stdio. */
export async function spawnDirectBinary(
  binary: string,
  extraArgs: string[],
): Promise<DirectSpawnResult> {
  if (Bun.which(binary) === null) {
    throw new Error(
      `"${binary}" is not on PATH. Install it or add a fish abbreviation for this provider.`,
    );
  }
  const proc = Bun.spawn([binary, ...extraArgs], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return { exitCode: await proc.exited };
}

export async function spawnNoFish(
  provider: string,
  extraArgs: string[],
): Promise<SpawnResult> {
  const command = noFishCommand(provider);
  if (command === null) {
    throw new Error(`No fallback command configured for "${provider}".`);
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined && !command.scrubEnv.includes(key)) {
      env[key] = value;
    }
  }
  const proc = Bun.spawn([...command.argv, ...extraArgs], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env,
  });
  return { exitCode: await proc.exited };
}
