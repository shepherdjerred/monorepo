---
name: grafana-helper
description: "Use Grafana's GCX CLI for dashboards, datasources, Prometheus metrics, Loki logs, Tempo traces, …"
---

# Grafana with GCX

Use Grafana's native `gcx` CLI. Inside `shepherdjerred/monorepo`, invoke it
through toolkit so the tracked `homelab` context is selected consistently:

```bash
toolkit grafana --version
toolkit grafana help-tree
toolkit grafana commands
```

Use native `gcx` directly outside the monorepo or when explicitly requested.
Do not recreate routine GCX capabilities with handwritten REST calls.

## Discover before operating

GCX evolves quickly. Read help on the exact command instead of guessing flags:

```bash
toolkit grafana <group> --help
toolkit grafana <group> <command> --help
toolkit grafana agent skills list
toolkit grafana agent skills get <name> -o text
```

Prefer `--agent` or `-o json` for machine-readable evidence. Use `--json list`
where offered to discover selectable fields. Never enable
`--insecure-log-http-payload`; it can expose authorization material.

The Fish configuration and 1Password-backed setup own credentials and the
`homelab` context. Do not run `gcx login`, print tokens, add credentials to
arguments, or create another config store during normal repository work.

## Query observability data

Toolkit exposes focused aliases for the three signal backends:

```bash
toolkit prom query 'up == 0'
toolkit prom query 'rate(http_requests_total[5m])' --since 1h -o json

toolkit loki query '{namespace="temporal"} |= "error"' --since 1h --limit 50
toolkit loki query '{app="birmel"}' -o raw

toolkit tempo query --help
```

Start broad enough to establish scope, then narrow by service, namespace,
deployment, endpoint, trace ID, and time window. Correlate signals rather than
claiming a root cause from one log line or one metric spike. Record the exact
query and time window in incident evidence.

For active alerts, distinguish the layers:

- `toolkit prom query 'ALERTS{alertstate="firing"}'` shows firing Prometheus
  series.
- `toolkit grafana alert rules list` inspects Grafana-managed rule definitions
  and evaluation state.
- `toolkit alerts list --state open` shows the monorepo's durable alert
  occurrence ledger.

An empty Grafana-managed rule list is not an outage when Kubernetes
`PrometheusRule` resources and Alertmanager own alerting.

## Inspect Grafana resources

Discover the command-specific flags first, then use native groups:

```bash
toolkit grafana dashboards --help
toolkit grafana dashboards list
toolkit grafana datasources --help
toolkit grafana alert rules list
toolkit grafana alert rules get <uid>
```

Use `toolkit grafana api` only when GCX has no typed command for a required
read. Confirm the endpoint through current Grafana documentation or command
help, keep credentials inside GCX, and validate returned data before drawing a
conclusion.

## Mutation boundary

Dashboard, datasource, alert-rule, and other resource changes are external
mutations. Require explicit user authorization and identify the exact context,
resource, and intended diff before writing.

GCX's resource workflow is the preferred mutation surface:

```bash
toolkit grafana resources pull <resource-type> -p <directory>
toolkit grafana resources push --help
toolkit grafana resources delete --help
```

Pull and inspect current state first. Validate generated files and the target
context, then apply only the authorized resource set. After a write, read the
resource back and verify the relevant runtime signal separately; a successful
API response does not prove a dashboard query, alert evaluation, or telemetry
pipeline works end to end.

## Failure handling

- A missing context or credential is a setup failure; repair the tracked
  dotfiles path rather than bypassing it with an ad hoc token.
- A query error is evidence, not an empty result. Preserve stderr and the exit
  code.
- If GCX lacks a capability, state the gap before using `grafana api`; do not
  silently fall back to an unvalidated curl recipe.
- Keep reads and writes distinct. Investigation does not authorize dashboard,
  alert, annotation, or datasource changes.
