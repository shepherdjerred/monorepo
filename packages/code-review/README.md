# @shepherdjerred/code-review

Provider-neutral library for reasoning about automated PR code review: which
bot posts reviews (Codex, Greptile, …), whether it has finished reviewing the
head commit, and whether its unresolved findings should block. It is the single
shared vocabulary behind the `review-gate` Buildkite step
([scripts/wait-for-review.ts](../../scripts/wait-for-review.ts)), the PR fleet
controller ([packages/pr-fleet-controller](../pr-fleet-controller/)), and the
Temporal review-signal collector
([packages/temporal](../temporal/)`/src/workflows/observe-review-signals.ts`).

## Model

A `ReviewProvider` (see `src/types.ts`) declares everything consumers need:

- **`authorLogins`** — the provider's exact GitHub logins.
  `isProviderAuthor` (`src/identity.ts`) strips the REST `[bot]` suffix and
  compares exactly (case-insensitive), never by substring, so a look-alike
  login cannot impersonate the provider and satisfy the gate.
- **`completion: CompletionStrategy`** — how "reviewed the head commit" is
  detected:
  - `check-run`: the provider posts a check-run matching `namePattern` per
    reviewed commit (Greptile).
  - `review-at-head`: the provider posts a PR review whose
    `commit_id === head`; because a clean PR leaves no review artifact,
    `cleanSignal: "thumbsup-reaction"` detects "reviewed, nothing to flag"
    (Codex).
- **`parseSeverity`** — parses a P0–P3 badge from a review comment body into a
  numeric priority (0 = most severe), or `null` when unbadged.
- **`detectSkip: SkipStrategy | null`** — how a deliberate skip ("no
  reviewable files", excluded author, …) is recognized on issue comments.
- **`requestReview: ReviewRequestStrategy | null`** — how to ask for a
  (re-)review of the head, with an idempotency marker so a consumer never
  posts a duplicate trigger comment; `null` for providers that review
  automatically.
- **`botAuthoredPullRequestPolicy`** — whether bot-authored PRs still require
  this provider's review (`review`) or are explicitly skipped (`skip`).

### Gate semantics

`evaluateGate` (`src/gate.ts`) is pure and fixture-tested. Given the head SHA,
the resolved `ReviewState` (`reviewing` | `reviewed` | `errored`), and the PR's
review threads, it returns `waiting`, `passed`, or `failed`. A thread blocks
iff it is authored by the active provider, unresolved, not outdated, and
carries a severity at or above the threshold (`priority <=
maxBlockingPriority`; the CI gate reads `REVIEW_MAX_BLOCKING_PRIORITY`).
Threads without a severity badge never block. `errored` review jobs fail the
gate rather than being trusted.

## Providers

Registered in `src/providers/registry.ts`: **`codex`** (the default,
`DEFAULT_PROVIDER_ID`) and **`greptile`**. `resolveProvider(id)` throws on an
unknown id — a typo'd `REVIEW_PROVIDER` env var fails loudly instead of gating
against the wrong bot.

## Entry points

| Import                                       | Contents                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `@shepherdjerred/code-review`                | Pure core: types, severity/identity parsing, `evaluateGate`, providers, and the `review-signal/v1` observability event schema (`src/signal.ts`) |
| `@shepherdjerred/code-review/github`         | GitHub I/O: fetch PR author, review threads, skip reasons, latest provider review/reaction, and `resolveReviewState`                            |
| `@shepherdjerred/code-review/head-pushed-at` | Resolve when the head commit was pushed (review-latency measurement)                                                                            |

The split is deliberate: pure consumers don't pull in the GitHub layer.

## Usage

```ts
import { resolveProvider, evaluateGate } from "@shepherdjerred/code-review";
import {
  resolveReviewState,
  fetchReviewThreads,
} from "@shepherdjerred/code-review/github";
import { fetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";

const provider = resolveProvider(Bun.env["REVIEW_PROVIDER"]);
const repo = "shepherdjerred/monorepo";
const number = 1234;
const head = "0123456789abcdef0123456789abcdef01234567";
const token = Bun.env["GH_TOKEN"] ?? "";

// Only `review-at-head` providers need the push time; it binds a commit-less
// 👍 clean-review reaction to this head.
const headPushedAt =
  provider.completion.kind === "review-at-head"
    ? await fetchHeadPushedAt({ repo, sha: head, prNumber: number, token })
    : null;

// Resolve completion FIRST, then fetch threads — never concurrently, or the
// gate can pass on a thread snapshot older than the review it just observed.
const state = await resolveReviewState({
  provider,
  repo,
  head,
  prNumber: number,
  token,
  headPushedAt,
});
const { threads } = await fetchReviewThreads({ repo, number, token, provider });

const decision = evaluateGate({
  head,
  provider,
  reviewState: state.state,
  threads,
  maxBlockingPriority: 1,
  skipReason: state.skipReason,
});
```

## Development

```bash
bun run test        # bun test
bun run typecheck
bun run lint
```

Review-gate policy for this repo (what counts as blocking, severity
discipline) lives in the root [CLAUDE.md](../../CLAUDE.md) Code Review Rules
section; this package implements the mechanics, not the policy.
