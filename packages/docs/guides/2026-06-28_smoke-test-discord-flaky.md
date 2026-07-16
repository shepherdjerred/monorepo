# Smoke tests flake on transient Discord network errors

## Status

Reference (guide).

The shared Dagger `runSmokeTest` (`.dagger/src/misc.ts`) boots a bot with dummy creds for 30s and passes only if the output contains an auth-failure pattern (`401`/`TokenInvalid`/`Unauthorized`/`Invalid token`), the process exits 0, or it hits the 30s timeout (exit 124). It backs `smoke-scout-for-lol`, `smoke-test-streambot`, and birmel's smoke test.

## Failure mode

Because passing depends on reaching **live discord.com** for the 401, a transient CI network blip yields a non-401 error (ENOTFOUND/ETIMEDOUT) not in the expected list → hard fail (`soft_failed:false`, exit 1). The Buildkite log shows the dagger span as `∅` with no captured inner output, which looks mysterious.

## Diagnose

Reproduce locally (scout example):

```bash
dagger -m .dagger call smoke-test-scout-for-lol --pkg-dir packages/scout-for-lol \
  --dep-names eslint-config --dep-dirs packages/eslint-config \
  --dep-names llm-observability --dep-dirs packages/llm-observability
```

If it prints "✅ Smoke test passed: failed with expected auth error", the bot boots fine and the CI failure was flaky.

## Recover

`bk job retry <job-uuid>` the single failed job (don't rebuild the whole build) — it passes reliably on main.

## Potential hardening (not done)

Add network-error substrings to the expected-failure patterns so a flaky DNS/timeout doesn't fail the smoke test.
