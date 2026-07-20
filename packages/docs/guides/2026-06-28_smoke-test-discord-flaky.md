---
id: guide-2026-06-28-smoke-test-discord-flaky
type: guide
status: complete
board: false
---

# Smoke tests flake on transient Discord network errors

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
