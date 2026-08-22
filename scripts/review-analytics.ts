#!/usr/bin/env bun
/**
 * Measure what the required review gate actually costs, from GitHub.
 *
 * This exists instead of a bigger archive. Everything it reports is
 * reconstructible from GitHub after the fact — reviews, review comments, their
 * `commit_id`s and timestamps are retained indefinitely — so copying them into
 * S3 would duplicate a durable store and leave a second thing to keep correct.
 * The durable collector (`review-signals-collect`) stays as it is; it snapshots
 * the *current* head every six hours and therefore cannot answer any per-push
 * question, which is what this answers.
 *
 * Severity is parsed with the repository's own provider rules, so a count is
 * only comparable against the parser that produced it — run this from the
 * checkout whose numbers you mean to compare.
 *
 * Usage:
 *   GH_TOKEN=$(gh auth token) bun scripts/review-analytics.ts rounds --last 50
 *   GH_TOKEN=$(gh auth token) bun scripts/review-analytics.ts requests --last 50
 *   GH_TOKEN=$(gh auth token) bun scripts/review-analytics.ts blame --pr 2301
 *   GH_TOKEN=$(gh auth token) bun scripts/review-analytics.ts rounds --last 20 --json
 */

import {
  BLAME_QUERY,
  BlameSchema,
  DEFAULT_REPO,
  fetchPr,
  fetchPrRounds,
  graphql,
  IssueCommentSchema,
  IssueReactionSchema,
  ghAll,
  listPrs,
  requireToken,
  type PrRounds,
  type PrSchema,
} from "./lib/review-analytics-github.ts";
import type { z } from "zod";

type ReviewAnswer = {
  head: string | null;
  at: string;
  kind: "review" | "reaction";
};

const QODO_ACKNOWLEDGEMENT = "was updated up to the latest commit";

function acknowledgedHead(body: string): string | null {
  const markerAt = body.indexOf(QODO_ACKNOWLEDGEMENT);
  if (markerAt === -1) return null;
  return /\b([0-9a-f]{40})\b/iu.exec(body.slice(markerAt))?.[1] ?? null;
}

/** Distinct reviewed heads in chronological order, with per-provider counts. */
function headsOf(pr: PrRounds) {
  const byHead = new Map<
    string,
    { head: string; at: string; qodo: number[]; codex: number[] }
  >();
  for (const round of pr.rounds) {
    const entry = byHead.get(round.head) ?? {
      head: round.head,
      at: round.at,
      qodo: [],
      codex: [],
    };
    if (round.at !== "" && (entry.at === "" || round.at < entry.at)) {
      entry.at = round.at;
    }
    for (const finding of round.findings) {
      if (finding.priority === null) continue;
      entry[round.provider].push(finding.priority);
    }
    byHead.set(round.head, entry);
  }
  return [...byHead.values()].toSorted((left, right) =>
    left.at.localeCompare(right.at),
  );
}

function tally(priorities: readonly number[]): string {
  if (priorities.length === 0) return "-";
  const counts = new Map<number, number>();
  for (const priority of priorities) {
    counts.set(priority, (counts.get(priority) ?? 0) + 1);
  }
  return (
    [...counts.entries()]
      .toSorted((left, right) => left[0] - right[0])
      .map(([priority, n]) => `${String(n)}p${String(priority)}`)
      .join("+") || "-"
  );
}

function commandRounds(repo: string, prs: PrRounds[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ repo, prs }, null, 2));
    return;
  }
  const active = prs.filter((pr) => pr.rounds.length > 0);
  let totalHeads = 0;
  let totalFindings = 0;
  const bySeverity = new Map<number, number>();

  console.log(
    `${String(prs.length)} PR(s) scanned, ${String(active.length)} with provider reviews.\n`,
  );
  console.log("Per-push finding sequence — n[qodo|codex]:\n");
  for (const pr of active.toSorted(
    (left, right) => right.rounds.length - left.rounds.length,
  )) {
    const heads = headsOf(pr);
    totalHeads += heads.length;
    for (const head of heads) {
      totalFindings += head.qodo.length + head.codex.length;
      for (const priority of [...head.qodo, ...head.codex]) {
        bySeverity.set(priority, (bySeverity.get(priority) ?? 0) + 1);
      }
    }
    const sequence = heads
      .map(
        (head, index) =>
          `${String(index + 1)}[${tally(head.qodo)}|${tally(head.codex)}]`,
      )
      .join(" ");
    console.log(
      `#${String(pr.number)} (${pr.state}, ${String(heads.length)} reviewed heads)`,
    );
    console.log(`  ${sequence}\n`);
  }

  console.log("---");
  console.log(`finding-bearing rounds: ${String(totalHeads)}`);
  console.log(`findings: ${String(totalFindings)}`);
  for (const [priority, n] of [...bySeverity.entries()].toSorted(
    (left, right) => left[0] - right[0],
  )) {
    const share = totalFindings === 0 ? 0 : (100 * n) / totalFindings;
    console.log(`  P${String(priority)}: ${String(n)} (${share.toFixed(0)}%)`);
  }
  if (totalHeads > 0) {
    console.log(
      `mean findings per round: ${(totalFindings / totalHeads).toFixed(2)}`,
    );
  }
}

async function commandRequests(
  repo: string,
  prs: PrRounds[],
  token: string,
  json: boolean,
): Promise<void> {
  const rows: {
    pr: number;
    automated: number;
    manual: number;
    converted: number;
  }[] = [];

  for (const pr of prs) {
    const raw = await ghAll(
      `/repos/${repo}/issues/${String(pr.number)}/comments?per_page=100`,
      token,
    );
    const rawReactions = await ghAll(
      `/repos/${repo}/issues/${String(pr.number)}/reactions?per_page=100`,
      token,
    );
    const comments = raw.map((item) => IssueCommentSchema.parse(item));
    const reactions = rawReactions.map((item) =>
      IssueReactionSchema.parse(item),
    );
    const acks: ReviewAnswer[] = comments
      .filter((comment) => comment.body.includes(QODO_ACKNOWLEDGEMENT))
      .map((comment) => ({
        head: acknowledgedHead(comment.body),
        at: comment.created_at,
        kind: "review",
      }));
    const codexReviews: ReviewAnswer[] = pr.rounds
      .filter((round) => round.provider === "codex")
      .map((round) => ({ head: round.head, at: round.at, kind: "review" }));
    const codexReactions: ReviewAnswer[] = reactions
      .filter(
        (reaction) =>
          reaction.content === "+1" &&
          reaction.user !== null &&
          reaction.user.login.replace(/\[bot\]$/u, "").toLowerCase() ===
            "chatgpt-codex-connector",
      )
      .map((reaction) => ({
        head: null,
        at: reaction.created_at,
        kind: "reaction",
      }));

    const requests = comments.flatMap((comment) => {
      const isRequest =
        /^\s*\/(?:agentic_)?review\b/mu.test(comment.body) ||
        comment.body.includes("@codex review");
      if (!isRequest) return [];
      const marker = /<!-- review-request:([a-z]+):([0-9a-f]{40})/u.exec(
        comment.body,
      );
      return [
        {
          askedAt: Date.parse(comment.created_at),
          askedProvider:
            marker?.[1] ??
            (comment.body.includes("@codex review") ? "codex" : "qodo"),
          requestedHead: marker?.[2] ?? null,
          automated: marker !== null,
        },
      ];
    });

    let automated = 0;
    let manual = 0;
    let converted = 0;
    for (const request of requests) {
      if (request.automated) automated += 1;
      else manual += 1;
      const answers =
        request.askedProvider === "codex"
          ? [...codexReviews, ...codexReactions]
          : acks;
      if (
        answers.some((answer) => {
          const gap = Date.parse(answer.at) - request.askedAt;
          const headMatches =
            request.requestedHead === null ||
            answer.head === request.requestedHead ||
            (answer.kind === "reaction" &&
              request.askedProvider === "codex" &&
              // GitHub's reaction has no commit SHA. It answers an automated
              // request only when no later Codex request was posted before the
              // reaction; otherwise the reaction belongs to that later head.
              !requests.some(
                (later) =>
                  later.askedProvider === request.askedProvider &&
                  later.askedAt > request.askedAt &&
                  later.askedAt < Date.parse(answer.at),
              ));
          return headMatches && gap > 0 && gap < 60 * 60 * 1000;
        })
      ) {
        converted += 1;
      }
    }
    rows.push({ pr: pr.number, automated, manual, converted });
  }

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const totals = rows.reduce(
    (accumulator, row) => ({
      automated: accumulator.automated + row.automated,
      manual: accumulator.manual + row.manual,
      converted: accumulator.converted + row.converted,
    }),
    { automated: 0, manual: 0, converted: 0 },
  );
  console.log("PR\tautomated\tmanual\tanswered<60m");
  for (const row of rows) {
    console.log(
      `${String(row.pr)}\t${String(row.automated)}\t\t${String(row.manual)}\t${String(row.converted)}`,
    );
  }
  const all = totals.automated + totals.manual;
  console.log("---");
  console.log(
    `requests: ${String(all)} (automated ${String(totals.automated)}, manual ${String(totals.manual)})`,
  );
  if (all > 0) {
    console.log(
      `answered within 60 min: ${String(totals.converted)} (${((100 * totals.converted) / all).toFixed(0)}%)`,
    );
  }
}

type BlameRange = { start: number; end: number; at: string };

/**
 * Blame ranges for one file at one commit, cached across findings — several
 * findings routinely point at the same file in the same review, and blame is
 * the expensive call here.
 */
async function blameRanges(input: {
  owner: string;
  name: string;
  head: string;
  path: string;
  token: string;
  cache: Map<string, BlameRange[]>;
}): Promise<BlameRange[]> {
  const key = `${input.head} ${input.path}`;
  const cached = input.cache.get(key);
  if (cached !== undefined) return cached;
  const payload = await graphql(
    BLAME_QUERY,
    {
      owner: input.owner,
      name: input.name,
      expression: input.head,
      path: input.path,
    },
    input.token,
  );
  const parsed = BlameSchema.safeParse(payload);
  const blame = parsed.success
    ? (parsed.data.data.repository?.object?.blame.ranges ?? null)
    : null;
  const ranges =
    blame?.map((range) => ({
      start: range.startingLine,
      end: range.endingLine,
      at: range.commit.committedDate,
    })) ?? [];
  input.cache.set(key, ranges);
  return ranges;
}

/**
 * When the flagged line was last written, or null when blame cannot place it.
 */
async function flaggedLineAuthoredAt(input: {
  owner: string;
  name: string;
  head: string;
  path: string | null;
  line: number | null;
  token: string;
  cache: Map<string, BlameRange[]>;
}): Promise<string | null> {
  const { path, line } = input;
  if (path === null || line === null) return null;
  const ranges = await blameRanges({ ...input, path });
  const hit = ranges.find((range) => range.start <= line && line <= range.end);
  return hit?.at ?? null;
}

async function commandBlame(
  repo: string,
  prs: PrRounds[],
  token: string,
  json: boolean,
): Promise<void> {
  const [owner, name] = repo.split("/");
  if (owner === undefined || name === undefined) {
    throw new Error(`repo must be "owner/name", got "${repo}"`);
  }
  const cache = new Map<string, BlameRange[]>();
  const rows: {
    pr: number;
    total: number;
    selfInflicted: number;
    unresolved: number;
  }[] = [];

  for (const pr of prs) {
    if (pr.rounds.length === 0) continue;
    const firstReviewAt = pr.rounds
      .map((round) => round.at)
      .filter((at) => at !== "")
      .toSorted()[0];
    if (firstReviewAt === undefined) continue;

    let total = 0;
    let selfInflicted = 0;
    let unresolved = 0;
    for (const round of pr.rounds) {
      for (const finding of round.findings) {
        total += 1;
        const authoredAt = await flaggedLineAuthoredAt({
          owner,
          name,
          head: round.head,
          path: finding.path,
          line: finding.line,
          token,
          cache,
        });
        if (authoredAt === null) {
          unresolved += 1;
          continue;
        }
        if (Date.parse(authoredAt) > Date.parse(firstReviewAt)) {
          selfInflicted += 1;
        }
      }
    }
    rows.push({ pr: pr.number, total, selfInflicted, unresolved });
  }

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const totals = rows.reduce(
    (accumulator, row) => ({
      total: accumulator.total + row.total,
      selfInflicted: accumulator.selfInflicted + row.selfInflicted,
      unresolved: accumulator.unresolved + row.unresolved,
    }),
    { total: 0, selfInflicted: 0, unresolved: 0 },
  );
  console.log("PR\tfindings\tchurn-authored\tunresolved");
  for (const row of rows) {
    console.log(
      `${String(row.pr)}\t${String(row.total)}\t\t${String(row.selfInflicted)}\t\t${String(row.unresolved)}`,
    );
  }
  console.log("---");
  const resolved = totals.total - totals.unresolved;
  console.log(
    `findings: ${String(totals.total)} (${String(totals.unresolved)} lines not resolvable by blame)`,
  );
  if (resolved > 0) {
    console.log(
      `flagging a line written after the first review: ${String(totals.selfInflicted)} ` +
        `(${((100 * totals.selfInflicted) / resolved).toFixed(0)}%)`,
    );
  }
}

function parseArgs(argv: readonly string[]) {
  const command = argv[0];
  const options = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg?.startsWith("--") !== true) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options.set(key, "true");
      continue;
    }
    options.set(key, next);
    index += 1;
  }
  return { command, options };
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(Bun.argv.slice(2));
  const commands = new Set(["rounds", "requests", "blame"]);
  if (command === undefined || !commands.has(command)) {
    throw new Error(
      `Usage: review-analytics.ts <${[...commands].join("|")}> [--last N | --pr N] [--repo owner/name] [--json]`,
    );
  }
  const token = requireToken();
  const repo = options.get("repo") ?? DEFAULT_REPO;
  const json = options.get("json") === "true";

  const explicit = options.get("pr");
  const prs: z.infer<typeof PrSchema>[] = [];
  if (explicit === undefined) {
    const last = Number.parseInt(options.get("last") ?? "50", 10);
    if (Number.isInteger(last) && last > 0) {
      prs.push(...(await listPrs(repo, last, token)));
    } else {
      throw new Error(
        `--last expects a positive integer, got "${options.get("last") ?? ""}"`,
      );
    }
  } else {
    for (const raw of explicit.split(",")) {
      const number = Number.parseInt(raw.trim(), 10);
      if (Number.isInteger(number) && number > 0) {
        prs.push(await fetchPr(repo, number, token));
        continue;
      }
      throw new Error(`--pr expects positive PR numbers, got "${raw}"`);
    }
  }

  const resolved: PrRounds[] = [];
  for (const pr of prs) {
    resolved.push(await fetchPrRounds(repo, pr, token));
  }

  if (command === "rounds") commandRounds(repo, resolved, json);
  else if (command === "requests")
    await commandRequests(repo, resolved, token, json);
  else await commandBlame(repo, resolved, token, json);
}

await main();
