/**
 * Shared test fixtures for the pr-review activity tests.
 *
 * TEST-ONLY: this module is imported exclusively by `*.test.ts` files. It must
 * never be imported by production code — and, in particular, never by anything
 * a workflow file transitively imports (the workflow-bundle smoke test in
 * `src/workflows/bundle.test.ts` enforces that boundary).
 */
import {
  encodeEmbedding,
  type DismissedEntry,
  type RedisSend,
} from "#lib/pr-review/dismissed-store.ts";
import { EMBEDDING_DIM } from "#lib/pr-review/embedding.ts";
import type { IngestOctokit } from "#lib/pr-review/reaction-listener-helpers.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import type { AnnotatedFinding } from "#activities/pr-review/consensus.ts";

/**
 * Deterministic unit vector seeded from `seed`. Defaults to `EMBEDDING_DIM`
 * length so it matches what the dedupe / ingest activities embed.
 */
export function unitVector(
  seed: number,
  dim: number = EMBEDDING_DIM,
): number[] {
  const v = Array.from({ length: dim }, () => 0);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.sin(seed + i);
    norm += (v[i] ?? 0) * (v[i] ?? 0);
  }
  const s = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / s;
  return v;
}

/** In-memory fake Redis exposing the backing store for assertions. */
export type FakeRedis = RedisSend & { _store: Map<string, string[]> };

/**
 * In-memory Redis mock matching the methods dedupe.ts / ingest-dismissals.ts
 * use (LRANGE/LPUSH/LTRIM/EXPIRE via `send`). Keys map to lists of JSON
 * strings.
 */
export function makeFakeRedis(): FakeRedis {
  const store = new Map<string, string[]>();
  const run = (cmd: string, args: string[]): unknown => {
    const upper = cmd.toUpperCase();
    const key = args[0] ?? "";
    if (upper === "LRANGE") {
      return store.get(key) ?? [];
    }
    if (upper === "LPUSH") {
      const list = store.get(key) ?? [];
      const value = args[1] ?? "";
      store.set(key, [value, ...list]);
      return list.length + 1;
    }
    if (upper === "LTRIM") {
      const list = store.get(key) ?? [];
      const stop = Number.parseInt(args[2] ?? "0", 10);
      store.set(key, list.slice(0, stop + 1));
      return "OK";
    }
    if (upper === "EXPIRE") {
      return 1;
    }
    throw new Error(`unsupported in mock: ${cmd}`);
  };
  return {
    send: (cmd: string, args: string[]) => Promise.resolve(run(cmd, args)),
    _store: store,
  };
}

/**
 * Builds a bot-authored PR review comment carrying a `pr-review-finding`
 * marker, as returned by the review-comment list endpoint.
 */
export function botReviewComment(marker: string): Record<string, unknown> {
  return {
    id: 555,
    pull_request_url: "https://api.github.com/repos/o/r/pulls/42",
    body: marker,
    created_at: "2026-05-30T10:00:00Z",
    user: { login: "pr-review-bot", type: "Bot" },
  };
}

/** A 👎 (`-1`) reaction from user `o`. */
export function thumbsDownReaction(): Record<string, unknown> {
  return {
    content: "-1",
    created_at: "2026-05-30T11:00:00Z",
    user: { login: "o" },
  };
}

/**
 * Builds a fake `IngestOctokit` that serves `reviewComments` from the
 * review-comment-list route and `reactions` from the reaction-list route
 * (any other route yields an empty page). `pull` sets what `pulls.get`
 * returns as `data` (default: an open PR #42). A fresh instance is returned
 * on each call so re-run tests get independent generators.
 */
export function makeIngestOctokit(opts: {
  reviewComments?: readonly unknown[];
  reactions?: readonly unknown[];
  pull?: unknown;
}): IngestOctokit {
  const reviewComments = opts.reviewComments ?? [];
  const reactions = opts.reactions ?? [];
  const pull = opts.pull ?? { number: 42, state: "open" };
  const ROUTE_LIST = { _id: "listReviewCommentsForRepo" };
  const ROUTE_REACTIONS = { _id: "listForPullRequestReviewComment" };
  const pageFor = (route: unknown): readonly unknown[] => {
    if (route === ROUTE_LIST) return reviewComments;
    if (route === ROUTE_REACTIONS) return reactions;
    return [];
  };
  return {
    paginate: {
      // Single-page async iterable. Implemented as a hand-rolled async
      // iterator (rather than `async function*`) so the fake needs no real
      // `await`. Yields one `{ data }` page for the route, then completes.
      iterator: (route: unknown) => ({
        [Symbol.asyncIterator]() {
          let done = false;
          return {
            next: () => {
              if (done) {
                return Promise.resolve({ value: undefined, done: true });
              }
              done = true;
              return Promise.resolve({
                value: { data: pageFor(route) },
                done: false,
              });
            },
          };
        },
      }),
    },
    rest: {
      issues: { listCommentsForRepo: {}, listEventsForRepo: {} },
      pulls: {
        listReviewCommentsForRepo: ROUTE_LIST,
        get: () => Promise.resolve({ data: pull }),
        listCommits: { _id: "listCommits" },
      },
      reactions: {
        listForPullRequestReviewComment: ROUTE_REACTIONS,
        listForIssueComment: {},
      },
    },
  };
}

/** Builds a `Finding` with sensible defaults, overridable per test. */
export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    file: "src/foo.ts",
    lineStart: 10,
    lineEnd: 12,
    kind: "correctness",
    severity: "warning",
    verifier: "none",
    claim: "ignores the error from foo()",
    evidence: "snippet",
    confidence: 0.8,
    ...overrides,
  };
}

/** Named-field `Finding` builder used by the consensus voting tests. */
export function mkFinding(input: {
  id: string;
  file: string;
  lineStart: number;
  kind?: Finding["kind"];
  severity?: Finding["severity"];
  claim?: string;
  confidence?: number;
}): Finding {
  return {
    id: input.id,
    file: input.file,
    lineStart: input.lineStart,
    lineEnd: input.lineStart,
    kind: input.kind ?? "correctness",
    severity: input.severity ?? "warning",
    verifier: "none",
    claim: input.claim ?? "test claim",
    evidence: "test evidence",
    confidence: input.confidence ?? 0.7,
  };
}

/**
 * Raw (untyped) specialist-finding object for `specialistOutputSchema` parse
 * tests. Returns a valid `security`/`verifier: "none"` finding as a plain
 * record so tests can spread deliberately-invalid overrides (wrong kind,
 * verifier without target, mismatched verifierTarget) and assert the schema
 * rejects them.
 */
export function rawSpecialistFinding(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "f1",
    file: "a.ts",
    lineStart: 1,
    lineEnd: 1,
    kind: "security",
    severity: "warning",
    verifier: "none",
    claim: "x",
    evidence: "y",
    confidence: 0.7,
    ...overrides,
  };
}

/**
 * Attaches the canonical grep verifier + target to a `Finding`, marking it
 * verifier-backed for the consensus keep-reason tests.
 */
export function withGrepVerifier(finding: Finding): Finding {
  return {
    ...finding,
    verifier: "grep",
    verifierTarget: {
      kind: "grep",
      pattern: "dangerously-skip-permissions",
      isLiteral: true,
      pathGlob: "release.ts",
      mustMatch: true,
    },
  };
}

/** Wraps a `Finding` as an `AnnotatedFinding` for consensus voting. */
export function annotate(
  finding: Finding,
  specialistId: string,
  passId: number,
): AnnotatedFinding {
  return { finding, specialistId, passId };
}

/**
 * Builds a run of annotated findings all attributed to `specialistId`, with
 * `passId` assigned by array position (0, 1, 2, …). Lets consensus tests
 * express "these findings on successive passes of one specialist" without
 * repeating the `annotate(…, specialistId, N)` boilerplate per finding.
 */
export function passes(
  specialistId: string,
  findings: readonly Finding[],
): AnnotatedFinding[] {
  return findings.map((finding, passId) =>
    annotate(finding, specialistId, passId),
  );
}

/**
 * Builds a `DismissedEntry` from a raw embedding vector. The vector is encoded
 * for you; timestamps and evidence default to a valid non-expired shape and
 * are overridable.
 */
export function makeDismissedEntry(
  vector: readonly number[],
  overrides: Partial<Omit<DismissedEntry, "embedding">> = {},
): DismissedEntry {
  return {
    hash: "h",
    embedding: encodeEmbedding(vector),
    dismissedAt: "2026-05-30T00:00:00.000Z",
    expiresAt: "2026-08-28T00:00:00.000Z",
    reason: "thumbs-down",
    weight: 1,
    evidence: { commentId: 1, prNumber: 1, sha: "x" },
    ...overrides,
  };
}
