import path from "node:path";
import { z } from "zod/v4";
import {
  ClaudeResultMessage,
  GroomResult,
  ImplementResult,
} from "#shared/docs-groom-types.ts";

// ---------------------------------------------------------------------------
// Subprocess helpers
// ---------------------------------------------------------------------------

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Optional stdin payload to pipe into the process. */
  stdin?: string;
  /** Whether to throw on non-zero exit. Default true. */
  throwOnError?: boolean;
};

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function run(
  cmd: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    env: opts.env === undefined ? Bun.env : { ...Bun.env, ...opts.env },
    stdin: opts.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (opts.stdin !== undefined && proc.stdin !== undefined) {
    void proc.stdin.write(opts.stdin);
    void proc.stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if ((opts.throwOnError ?? true) && exitCode !== 0) {
    throw new Error(
      `Command failed with exit code ${String(exitCode)}: ${cmd.join(" ")}\n${stderr}`,
    );
  }

  return { exitCode, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Slug + secret-path helpers
// ---------------------------------------------------------------------------

const MAX_SLUG_LEN = 50;

const SECRET_FILENAME_PATTERNS = [
  /(?:^|\/)\.env(?:$|\..*$)/,
  /(?:^|\/)\.env\.[^/]+$/,
  /\.key$/,
  /\.pem$/,
  /\.pfx$/,
  /\.p12$/,
  /(?:^|\/)id_rsa(?:\..+)?$/,
  /(?:^|\/)id_ed25519(?:\..+)?$/,
  /(?:^|\/)id_ecdsa(?:\..+)?$/,
  /(?:^|\/)id_dsa(?:\..+)?$/,
  /\.gpg$/,
  /\.asc$/,
];

export function slugifyTaskTitle(title: string): string {
  // Strip diacritics by removing combining marks (Unicode property escape).
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/\p{M}+/gu, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .replaceAll(/-{2,}/g, "-");

  if (slug.length === 0) {
    return "task";
  }
  return slug.slice(0, MAX_SLUG_LEN).replaceAll(/-+$/g, "");
}

export function isSecretPath(filePath: string): boolean {
  return SECRET_FILENAME_PATTERNS.some((re) => re.test(filePath));
}

// ---------------------------------------------------------------------------
// Git status / PR list parsers
// ---------------------------------------------------------------------------

/** Parse `git status --porcelain` output into a list of changed file paths. */
export function parseGitStatus(stdout: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    // Porcelain v1 format: 2-char status code, space, path. Renames are
    // " R  old -> new" — take the new path.
    const lineBody = line.slice(3).trim();
    if (lineBody.includes(" -> ")) {
      const arrowIdx = lineBody.indexOf(" -> ");
      const newPath = lineBody.slice(arrowIdx + 4);
      if (newPath.length > 0) {
        out.push(newPath);
      }
    } else {
      out.push(lineBody);
    }
  }
  return out;
}

export function parsePrNumberFromUrl(url: string): number {
  const match = /\/pull\/(\d+)/.exec(url.trim());
  if (match?.[1] === undefined) {
    throw new Error(`could not parse PR number from URL: ${url}`);
  }
  return Number.parseInt(match[1], 10);
}

const PrListEntrySchema = z.object({
  number: z.number(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  closedAt: z.string().nullable().optional(),
});

export type PrListEntry = {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  closedAt?: string;
};

const PrListSchema = z.array(z.unknown());

export function parsePrListOutput(stdout: string): PrListEntry[] {
  if (stdout.trim().length === 0) {
    return [];
  }
  const parsedRaw = PrListSchema.parse(JSON.parse(stdout));
  const entries: PrListEntry[] = [];
  for (const raw of parsedRaw) {
    const result = PrListEntrySchema.safeParse(raw);
    if (!result.success) {
      continue;
    }
    const { number, state, closedAt } = result.data;
    entries.push({
      number,
      state,
      ...(typeof closedAt === "string" ? { closedAt } : {}),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Claude output parsers
// ---------------------------------------------------------------------------

/**
 * Strip a single leading ```json (or plain ```) fence and a trailing ```
 * fence, if present. Tolerates leading/trailing whitespace.
 */
export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) {
    return trimmed;
  }
  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) {
    return trimmed;
  }
  const opening = trimmed.slice(0, firstNewline);
  if (opening !== "```" && opening !== "```json") {
    return trimmed;
  }
  return trimmed.slice(firstNewline + 1, -3).trimEnd();
}

const JsonValueSchema = z.unknown();

export function parseClaudeResultMessage(stdout: string): ClaudeResultMessage {
  const parsed = JsonValueSchema.parse(JSON.parse(stdout));
  return ClaudeResultMessage.parse(parsed);
}

export function parseGroomResult(rawResultText: string): GroomResult {
  const cleaned = stripJsonFences(rawResultText);
  const parsed = JsonValueSchema.parse(JSON.parse(cleaned));
  return GroomResult.parse(parsed);
}

export function parseImplementResult(rawResultText: string): ImplementResult {
  const cleaned = stripJsonFences(rawResultText);
  const parsed = JsonValueSchema.parse(JSON.parse(cleaned));
  return ImplementResult.parse(parsed);
}

// ---------------------------------------------------------------------------
// Owning-package walker
// ---------------------------------------------------------------------------

const PackageJsonSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
});

async function tryReadPackageJson(
  pkgJsonPath: string,
): Promise<z.infer<typeof PackageJsonSchema> | undefined> {
  const file = Bun.file(pkgJsonPath);
  if (!(await file.exists())) {
    return undefined;
  }
  try {
    return PackageJsonSchema.parse(JSON.parse(await file.text()));
  } catch {
    return undefined;
  }
}

/**
 * Walk up from one changed file's directory to find the owning
 * `package.json` that has a `typecheck` script. Returns the directory
 * path or undefined if none found before reaching the worktree root.
 */
async function findOwningPackageDirForFile(
  root: string,
  file: string,
): Promise<string | undefined> {
  let dir = path.dirname(path.resolve(root, file));
  while (dir.length >= root.length && dir !== root) {
    const pkg = await tryReadPackageJson(path.join(dir, "package.json"));
    if (pkg?.scripts?.["typecheck"] !== undefined) {
      return dir;
    }
    if (pkg !== undefined) {
      // Found a package.json without typecheck; stop here (don't escape
      // to a parent package by accident).
      return undefined;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
  return undefined;
}

/**
 * Walk up from each changed file's directory to find the owning
 * `package.json` that has a `typecheck` script. Returns the set of
 * unique package directories.
 */
export async function findOwningPackageDirs(
  worktreeRoot: string,
  changedFiles: string[],
): Promise<Set<string>> {
  const root = path.resolve(worktreeRoot);
  const result = new Set<string>();
  for (const file of changedFiles) {
    const owner = await findOwningPackageDirForFile(root, file);
    if (owner !== undefined) {
      result.add(owner);
    }
  }
  return result;
}
