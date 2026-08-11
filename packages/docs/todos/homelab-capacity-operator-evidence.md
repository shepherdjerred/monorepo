---
id: homelab-capacity-operator-evidence
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/plans/2026-08-09_homelab-capacity-right-sizing-remediation.md
source_marker: false
---

# Collect the two privileged capacity-rollout checks an operator must run

Two acceptance checks for the capacity right-sizing rollout cannot be gathered
by the scheduled report-only tasks in
`packages/docs/todos/homelab-capacity-rollout-acceptance.md`. They need
credentials and host access the agent worker deliberately does not have, so
they are tracked here as blocked operator work rather than folded into that
TODO's human acceptance step.

## Evidence

Agent-task evidence collectors execute inside `temporal-agent-worker`. That
deployment's environment is intentionally minimal — provider auth, basic
runtime and TLS settings, and the non-secret `PROMETHEUS_URL` and
`ALERT_DASHBOARD_URL` endpoints — and `AGENT_TASK_COMMON_ENVIRONMENT`
(`packages/temporal/src/activities/agent-task-env.ts`) forwards only that
allowlist to a collector process.

- **Grafana dashboard query audit.** `grafana-dashboard-audit.ts` needs
  `GRAFANA_URL` and `GRAFANA_API_KEY`. Neither is in the allowlist, and neither
  is defined on the agent deployment.
- **ZFS pool health.** `zpool status -x` needs the `zpool` binary and a host
  ZFS device. The worker image installs no ZFS tooling, and the agent service
  account is deliberately absent from every `pods/exec` RoleBinding, so it
  cannot reach a node that has them either.

Declaring either as a required collector would have failed every scheduled run
instead of proving anything. Granting the agent Grafana credentials or exec
rights purely to satisfy a report would widen a boundary that exists on
purpose, so the checks move to an operator instead of the boundary moving.

## Remaining

- [ ] Run the Grafana dashboard query audit from an operator machine
      (`cd packages/homelab/src/cdk8s && bun run audit:grafana`) and record that
      it reports zero invalid dashboard queries.
- [ ] Run `zpool status -x` on `liskov` and record that every pool is healthy.
- [ ] Attach both results to the capacity acceptance decision in
      `packages/docs/todos/homelab-capacity-rollout-acceptance.md`.

## Comment Log

### 2026-08-11 — split out of the acceptance TODO

Created while addressing a review finding on PR #2133: these two checks had
been listed under that TODO's `## Human Verification`, which
`packages/docs/AGENTS.md` reserves for subjective user acceptance testing.
They are deterministic commands that simply require privilege, so they belong
in separate blocked operator work.
