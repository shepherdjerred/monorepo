---
id: dpp-goal-trace-post-deploy-verify
type: todo
status: awaiting-human
board: true
verification: human
disposition: active
origin: packages/docs/plans/2026-07-04_llm-observability-gaps.md
---

# Verify dpp goal-mode tracing after next deploy + goal run

discord-plays-pokemon produced zero gen_ai spans/archives from ~2026-06-21
through 2026-07-03 despite goal mode running. Root cause was the bun isolated
linker duplicating `@opentelemetry/api` (fixed on main by the hoisted-linker
pin, commit `f36643fed`); a secondary duplicate context-manager registration
was fixed in the llm-obs-gaps PR (`observability/tracing.ts` now passes the
context manager via `NodeSDK({ contextManager })`).

After the next deploy, run one goal in Discord and verify:

```bash
# Tempo (7d window)
{ resource.service.name = "discord-plays-pokemon" && name =~ "pokemon.goal.*" }

# S3 (note dpp's non-default prefix)
aws s3 ls s3://llm-archive/goals/discord-plays-pokemon/discord-plays-pokemon/openai/ \
  --profile seaweedfs --recursive | tail
```

Expect `pokemon.goal.run` / `.turn` / `.tool` spans and fresh `.json.gz`
envelopes dated after the deploy. If still dark, check pod logs for
"duplicate registration" or archive upload warnings
(`{namespace="pokemon"} |~ "llm-observability|archive"`).

## Human Verification

- Verify `Verify dpp goal-mode tracing after next deploy + goal run` in its intended environment and record evidence in the Comment Log.
