import path from "node:path";
import { z } from "zod";

const RECIPE_ROOT = "packages/delivery/registrations/v2";
const CATALOG = "packages/ops-model/catalog-document.json";
const REVISION_FILE_PATTERN =
  /^packages\/delivery\/registrations\/v2\/(.+)\/(recipe|configuration)\.json$/u;
const REVISION_ID_PATTERN = /^(.+)\/([1-9]\d*)$/u;
const RevisionRecordSchema = z.record(z.string(), z.unknown());

export type ImmutableRevisionFinding = { subject: string; item: string };

type ParsedRevisionId = { prefix: string; num: number };
type SplitRevision = { id: string | undefined; payloadKey: string };
type GitRunner = (args: readonly string[]) => {
  exitCode: number;
  stdout: string;
};

export function parseRevisionId(
  revisionId: string | undefined,
): ParsedRevisionId | undefined {
  const match =
    revisionId === undefined ? null : REVISION_ID_PATTERN.exec(revisionId);
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : { prefix: match[1], num: Number(match[2]) };
}

export function nextRevisionId(revisionId: string): string {
  const match = /^(.+)\/(\d+)$/u.exec(revisionId);
  return match?.[1] === undefined || match[2] === undefined
    ? `${revisionId}/2`
    : `${match[1]}/${String(Number(match[2]) + 1)}`;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalJsonValue(item));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = RevisionRecordSchema.parse(value);
  return Object.fromEntries(
    Object.keys(record)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => [key, canonicalJsonValue(record[key])]),
  );
}

function splitRevisionJson(raw: unknown): SplitRevision {
  const { id, ...rest } = RevisionRecordSchema.parse(raw);
  return {
    id: typeof id === "string" ? id : undefined,
    payloadKey: JSON.stringify(canonicalJsonValue(rest)),
  };
}

function createGitRunner(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
): GitRunner {
  return (args) => {
    const res = Bun.spawnSync(["git", ...args], {
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return { exitCode: res.exitCode, stdout: res.stdout.toString("utf8") };
  };
}

export function resolveImmutableRevisionBase(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const git = createGitRunner(root, env);
  const req = env["CI_CHANGED_BASE"]?.trim();
  const baseRef = req !== undefined && req.length > 0 ? req : "origin/main";
  for (const args of [
    ["merge-base", baseRef, "HEAD"],
    ["rev-parse", "--verify", "HEAD"],
  ] as const) {
    const res = git(args);
    if (res.exitCode === 0 && res.stdout.trim().length > 0) {
      return res.stdout.trim();
    }
  }
  return undefined;
}

function maxHistoricalRevision(
  git: GitRunner,
  base: string,
  rel: string,
  prefix: string,
): number {
  const log = git([
    "log",
    "--full-history",
    "-m",
    '-G"id"',
    "-p",
    base,
    "--",
    rel,
  ]);
  if (log.exitCode !== 0) {
    return 0;
  }
  let max = 0;
  for (const line of log.stdout.split("\n")) {
    const first = line[0];
    if (
      (first !== "+" && first !== "-") ||
      line.startsWith("+++") ||
      line.startsWith("---")
    ) {
      continue;
    }
    for (const match of line.matchAll(/"id"\s*:\s*"([^"]+)"/gu)) {
      const parsed = parseRevisionId(match[1]);
      if (parsed?.prefix === prefix && parsed.num > max) {
        max = parsed.num;
      }
    }
  }
  return max;
}

function describeViolation(
  baseId: string,
  baseParsed: ParsedRevisionId,
  currRev: SplitRevision,
  maxHist: number,
): { reason: string; nextId: string } | undefined {
  if (currRev.id === baseId) {
    const maxSeen = Math.max(baseParsed.num, maxHist);
    return {
      reason: `"${baseId}" changed in place`,
      nextId: `${baseParsed.prefix}/${String(maxSeen + 1)}`,
    };
  }
  const maxSeen = Math.max(baseParsed.num, maxHist);
  const nextId = `${baseParsed.prefix}/${String(maxSeen + 1)}`;
  const currParsed = parseRevisionId(currRev.id);
  if (currParsed?.prefix !== baseParsed.prefix) {
    return {
      reason: `"${currRev.id ?? ""}" does not match monotonic prefix "${baseParsed.prefix}/<N>" after "${baseId}"`,
      nextId,
    };
  }
  if (currParsed.num <= baseParsed.num) {
    return {
      reason: `"${currRev.id ?? ""}" is non-monotonic after "${baseId}"`,
      nextId,
    };
  }
  if (currParsed.num <= maxHist) {
    return {
      reason: `"${currRev.id ?? ""}" reuses reverted historical revision (max seen "${baseParsed.prefix}/${String(maxHist)}")`,
      nextId,
    };
  }
  return undefined;
}

function checkAddedRevision(
  git: GitRunner,
  base: string,
  rel: string,
  currRev: SplitRevision,
): { reason: string; nextId: string } | undefined {
  const currParsed = parseRevisionId(currRev.id);
  if (currParsed === undefined) {
    const match = REVISION_FILE_PATTERN.exec(rel);
    const fallbackPrefix = match?.[1] ?? "service/prod";
    return {
      reason: `"${currRev.id ?? ""}" is not a valid "<prefix>/<N>" revision id`,
      nextId: `${fallbackPrefix}/1`,
    };
  }
  const maxHist = maxHistoricalRevision(git, base, rel, currParsed.prefix);
  if (currParsed.num <= maxHist) {
    return {
      reason: `"${currRev.id ?? ""}" reuses reverted historical revision (max seen "${currParsed.prefix}/${String(maxHist)}")`,
      nextId: `${currParsed.prefix}/${String(maxHist + 1)}`,
    };
  }
  return undefined;
}

function checkExistingRevision(
  git: GitRunner,
  base: string,
  rel: string,
  blobs: { baseText: string; currRev: SplitRevision },
): { reason: string; nextId: string } | undefined {
  const baseRev = splitRevisionJson(
    RevisionRecordSchema.parse(JSON.parse(blobs.baseText)),
  );
  const baseParsed = parseRevisionId(baseRev.id);
  if (baseParsed === undefined || baseRev.id === undefined) {
    return undefined;
  }
  if (
    blobs.currRev.id === baseRev.id &&
    blobs.currRev.payloadKey === baseRev.payloadKey
  ) {
    return undefined;
  }
  const maxHist = maxHistoricalRevision(git, base, rel, baseParsed.prefix);
  return describeViolation(baseRev.id, baseParsed, blobs.currRev, maxHist);
}

export async function collectImmutableRevisionFindings(options: {
  root: string;
  env: Readonly<Record<string, string | undefined>>;
}): Promise<ImmutableRevisionFinding[]> {
  const { root, env } = options;
  const base = resolveImmutableRevisionBase(root, env);
  if (base === undefined) {
    return [];
  }
  const git = createGitRunner(root, env);
  const diff = git(["diff", "--name-only", base, "--", RECIPE_ROOT]);
  if (diff.exitCode !== 0) {
    return [];
  }
  const findings: ImmutableRevisionFinding[] = [];
  const changedPaths = diff.stdout
    .split("\n")
    .map((line) => line.trim())
    .sort((a, b) => a.localeCompare(b));
  for (const rel of changedPaths) {
    const match = REVISION_FILE_PATTERN.exec(rel);
    if (match?.[1] === undefined || match[2] === undefined) {
      continue;
    }
    const file = Bun.file(path.join(root, rel));
    if (!(await file.exists())) {
      continue;
    }
    const currRev = splitRevisionJson(
      RevisionRecordSchema.parse(JSON.parse(await file.text())),
    );
    const blob = git(["show", `${base}:${rel}`]);
    const violation =
      blob.exitCode === 0
        ? checkExistingRevision(git, base, rel, {
            baseText: blob.stdout,
            currRev,
          })
        : checkAddedRevision(git, base, rel, currRev);
    if (violation === undefined) {
      continue;
    }
    const field =
      match[2] === "recipe" ? "recipeRevisionId" : "configurationRevisionId";
    findings.push({
      subject: match[1],
      item: `${rel}: immutable ${match[2]} revision ${violation.reason} relative to ${base.slice(0, 12)}; bump "id" and ${field} in ${CATALOG} to "${violation.nextId}"`,
    });
  }
  return findings;
}
