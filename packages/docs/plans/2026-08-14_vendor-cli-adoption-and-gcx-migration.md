---
id: plan-2026-08-14-vendor-cli-adoption-and-gcx-migration
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Vendor CLI adoption and the `toolkit gf` retirement

## Goal

Replace homegrown tooling with maintained first-party CLIs, then delete what they
supersede. The question that started this was "which MCP servers are worth
adding"; the answer, under a CLI-first preference, was **none** — every remaining
gap had a maintained vendor CLI. The MCP gateway keeps earning its place only for
services with no CLI (Linear's official CLI has been dead since 2021, Fastmail,
Home Assistant, Canvas, Gradescope, Ed).

## Shipped (on `main`)

Landed via #2164 (which absorbed #2165) and #2173.

- `gcx`, `linear`, `pgcli` + keg-only `libpq`, `logcli`, `prometheus` (for
  `promtool`), `crane`, `temporal`, `posthog-cli`, a pinned `bunx` wrapper for the
  `cf` technical preview, and an exec wrapper for the Tailscale CLI.
- Recorded the previously-untracked `bk@3` tap; dropped a stray `brew "bun"` that
  shadowed the mise pin.
- `gcx` baked into the temporal-worker image, `ensureGcxContext()`, and the
  `GCX_*` worker environment.
- `packages/docs/wiki/.../how-to/connect-to-a-homelab-database.md`.

## Findings that changed the design

These were discovered by testing, not inferred — do not re-litigate them.

- **gcx cannot use a chezmoi-managed config.** An inline token works, but gcx
  migrates it into the macOS Keychain and rewrites the file on first use, which
  leaves `chezmoi diff` permanently dirty. Its own two native environment
  variables are the exact pair banned by `scripts/environment-variable-rules.ts`.
  Resolution: `run_onchange_after_configure-gcx.sh.tmpl` provisions the context
  from 1Password and re-runs on credential rotation. No lint exclusion.
- **`GCX_CONFIG` is a choice, not a requirement.** `HOME=/home/bun` is set by the
  `oven/bun` base and is writable by uid 1000, so gcx's default path would work.
  Pinning it keeps the credential's location independent of the base image.
- **A Tailscale symlink does not work.** The bundled binary resolves its identity
  from its invocation path and dies with `bundleIdentifier is unknown to the
registry`. It must be an exec wrapper.
- **`cf` covers R2.** `cf r2 buckets|super-slurper|temporary-credentials` exists;
  `--help` shows a curated ~15 groups while the API-generated surface is 117
  groups / 1350 commands.
- **`posthog-cli api` exposes PostHog's own MCP tool catalog** through a shell
  interface, which makes the gateway's PostHog route redundant. Candidate for
  removal; Linear's route stays justified.
- **The Brewfile is a `brew bundle dump` snapshot**, so hand-written entries and
  comments do not survive. Install first, dump second.

## Remaining

- [ ] Derive `GcxMetricsQuerySchema` from the captured production output (below)
      and replace `PrometheusResultSchema` in `homelab-audit-collectors.ts:14-33`.
- [ ] Repoint `homelab-audit-collectors.ts:379` and
      `homelab-audit-preflight.ts:212` from `toolkit gf query` to
      `gcx metrics query --context homelab -d prometheus '<expr>' -o json`.
      Always pass `-o json`: gcx enters agent mode under `CLAUDECODE` and spills
      payloads over 100 KiB to a temp file, and `buildAuditAgentEnv` forwards the
      parent environment to the `claude -p` subprocess.
- [ ] Update `homelab-audit-prompts.ts:124-125`. Keep the strings
      `ALERTS{alertstate="firing"}` and `Grafana-managed rules only` verbatim —
      two tests assert on them — and add a `not.toContain("toolkit gf")`
      assertion, since the existing ones pass either way.
- [ ] Delete `packages/toolkit/src/handlers/grafana.ts`,
      `src/commands/grafana/`, `src/lib/grafana/`, and the `case "grafana"/"gf"`
      routing plus help text in `src/index.ts`. Verified self-contained: no tests
      exist and `lib/http.ts` / `lib/config.ts` keep other consumers.
- [ ] Update the `toolkit alerts|bugsink|gf` comment in
      `packages/temporal/Dockerfile` and the baked-CLI inventory header.
- [ ] Update ~40 doc lines: the homelab audit runbook (~25),
      `2026-04-21_nvme-wear-attribution.md`,
      `2026-05-05_velero-orphan-snapshot-remediation.md`,
      `2026-05-22_temporal-post-deploy-quality-checklist.md`,
      `2026-06-14_streambot-autonomous-perf-debug-runbook.md`, `AGENTS.md:46,446`
      (the `(pr, pd, bugsink, grafana)` list is stale on two counts — there is no
      `pd` command), `packages/toolkit/AGENTS.md` + `README.md`, and
      `packages/temporal/AGENTS.md:180`. Do not touch `packages/docs/archive/**`.
- [ ] Rewrite `dot_agents/skills/grafana-helper/SKILL.md` around gcx. Do not
      vendor gcx's own skills bundle — it would couple the dotfiles tree to
      upstream releases.
- [ ] Consciously dropped: annotations, read and write. `gcx` has no equivalent;
      `toolkit gf annotate` was the only write operation in the 2287 lines and has
      zero callers. `gcx api /api/annotations` carries the same auth.

### Gate status: OPEN

`gcx` 1.0.0 is live in `temporal-temporal-worker`. Verified in-pod: `gcx login`
succeeds, `gcx metrics query` returns real firing alerts, and `toolkit gf` is
still present — so the runbook can flip in either direction without breaking.

The ordering hazard this gate existed for: `homelab-audit-prompts.ts:10` fetches
the runbook from `main` **at activity start**, so a doc change takes effect on
merge while binaries only change when the image rolls. That coupling is worth its
own todo — pin the URL to a SHA or ship the runbook in the image.

### Captured production output shape

```json
{
  "status": "success",
  "data": {
    "resultType": "vector",
    "result": [
      {
        "metric": {
          "alertname": "Watchdog",
          "alertstate": "firing",
          "severity": "none"
        },
        "value": [1786754881.627, "1"]
      }
    ]
  }
}
```

Native Prometheus, not Grafana `/api/ds/query` frames. Timestamp is a float,
value is a string. `prometheusCount` collapses to `data.result.length`, which is
more correct than the code it replaces — that summed max column length across
frames, counting data points as firing series on any range query.

## Comment Log

- 2026-08-14: Shipped the CLI adoption and the gcx image work; retirement of
  `toolkit gf` remains. Gate verified open against the live worker.
