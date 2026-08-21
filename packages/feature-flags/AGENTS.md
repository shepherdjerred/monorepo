# AGENTS.md

An OpenFeature client. It answers "what does the flag backend say about this
key?" and nothing else — layering, precedence, and typed key registries belong
to `@shepherdjerred/config`, which consumes this package as one source among
several.

## The contract that matters: absence vs. answer

Every evaluation returns `FlagResult<T>` = `{ value, reason, errorCode }`, and
callers must distinguish two outcomes:

| Outcome                                 | `errorCode`                            | What the caller must do               |
| --------------------------------------- | -------------------------------------- | ------------------------------------- |
| **Absent** — the backend has no opinion | `FLAG_NOT_FOUND`, `PROVIDER_NOT_READY` | Fall through to the next config layer |
| **Answered** — including `false`        | anything else, or `undefined`          | Stop. This is the value.              |

`isAbsent()` in `src/flag-result.ts` is the only sanctioned test.

**A flag that exists and evaluates to `false` is an answer.** If it were treated
as absence, `@shepherdjerred/config` would descend to an env var still set to
`true` and silently re-enable exactly the thing an operator just turned off.
That failure is invisible in normal testing, so it has dedicated tests in
`src/index.test.ts` — do not weaken them.

A type mismatch is also **not** absence. A source that has an opinion it cannot
express is a configuration bug that should surface, not get masked by a lower
layer.

## Two failure classes, deliberately different

| Class                  | Examples                                                                          | Behavior                                                         |
| ---------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Config error**       | missing/unknown `FEATURE_FLAGS_MODE`, malformed `FLIPT_URL`, non-scalar attribute | **Throws** from `initFeatureFlags`. A deploy bug should be loud. |
| **Availability error** | backend unreachable, provider not ready, flag undefined                           | **Never throws.** Returns the call-site default with a reason.   |

This is a deliberate carve-out from the repo's fail-fast default, recorded here
so review does not re-litigate it on every PR. A flag system that throws during
a backend outage converts a degraded dependency into an outage of its own — and
because every call-site default is current production behavior, degrading to
defaults means behaving exactly as the service did before flags existed.

`initFeatureFlags` does not throw when a provider fails to initialize, for the
same reason: a flag backend must never stop a service from booting.

## Rules

- **The default is a required argument** at every call site, per the OpenFeature
  spec. There is no registry of defaults. It must be current production
  behavior, because it is what a cold start and an outage both resolve to.
- **`targetingKey` is required.** It is Flipt's `entityId` and the bucketing key
  for percentage rollouts; an optional one silently degrades every ramp into a
  single bucket.
- **`FEATURE_FLAGS_MODE` has no default and `NODE_ENV` is never sniffed.** A
  hidden environment fork is the silent fallback this repo bans. Consumers set
  `FEATURE_FLAGS_MODE=disabled` explicitly in test environments — including in
  their `scripts/ci-test-manifest.json` entry.
- **Attributes are scalars only.** Flipt's evaluation context is
  `Record<string, string>`; an object would target on `"[object Object]"`.
- **No logging dependency.** `onInitializationFailure` is injected so each
  consumer routes it through its own `createLogger`.
- **Object flags are unsupported** and say so with `TYPE_MISMATCH` rather than
  returning the default with a success reason.

## Flipt specifics

Learned by running `flipt/flipt:v2.11.0`, not from documentation:

- **An unknown flag key throws** from `evaluateBoolean`; it does not return a
  not-found reason. And `reason` is `DEFAULT_EVALUATION_REASON` for a `true`, a
  `false`, and a rollout miss alike — it discriminates nothing.
  **`listFlags()` is the absence oracle**: synchronous, reads the same cached
  snapshot, no string matching. A key it does not contain is `FLAG_NOT_FOUND`
  without calling the engine; a throw on a key it _does_ contain is `GENERAL`,
  never `FLAG_NOT_FOUND`, or the resolver would fall through on a real failure.
- **`enabled` is the flag's default and rollouts override it.** A 30% rollout to
  `true` on a flag whose `enabled` is already `true` is a no-op. Ramp-ups set
  `enabled: false` with a rollout to `true`.
- The vendored WASM glue emits a `console.warn` about deprecated init
  parameters on every startup. It comes from inside the package and is
  unavoidable from here.
