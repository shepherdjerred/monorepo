# Helm Escaping Pipeline

How template-bearing content survives the multi-engine rendering pipeline in the homelab infrastructure.

## The Problem

Helm's Go template engine processes the ENTIRE YAML file as a template BEFORE YAML parsing. Any `{{` anywhere — string values, block scalars, comments — is interpreted as Go template syntax. Since many Kubernetes workloads embed content that uses `{{` (Prometheus rules, Go templates, Jinja2 templates, Python f-strings), all such content must be escaped for Helm and then unescaped during rendering.

## Content Flow

**Production path (ArgoCD):**

```
TypeScript → CDK8s synth → YAML (dist/*.k8s.yaml) → Helm chart → ArgoCD helm template → rendered YAML → K8s API → final consumer
```

**Dev path (`bun run up`):**

```
TypeScript → CDK8s synth → YAML (dist/*.k8s.yaml) → kubectl apply → K8s API → final consumer
```

The production path has one extra processing stage (Helm) that strips the escaping. The dev path does not, so escaped content is stored literally. This is why `CLAUDE.md` mandates: all deployments go through ArgoCD, never `kubectl apply`.

## Content Categories

| Category                                 | Escape Method                          | In YAML (pre-Helm)                                | After Helm                        | Final Consumer                    |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------- | --------------------------------- | --------------------------------- |
| Prometheus/Alertmanager rule annotations | `escapePrometheusTemplate()`           | `{{ "{{" }} $value {{ "}}" }}`                    | `{{ $value }}`                    | Prometheus Go template engine     |
| Event-exporter/Go template configs       | `escapeHelmGoTemplate()`               | `{{ "{{" }} .InvolvedObject.Namespace {{ "}}" }}` | `{{ .InvolvedObject.Namespace }}` | Event-exporter Go template engine |
| Home Assistant Jinja2 templates          | Pre-escaped in source YAML             | `{{ "{{" }} states \| ... {{ "}}" }}`             | `{{ states \| ... }}`             | HA Jinja2 engine                  |
| Embedded scripts (Python/shell)          | Manual `.replaceAll()` on file content | `{{ "{{" }}bucket="{{ "}}" }}`                    | `{{bucket="..."}}`                | Python runtime                    |

## Escape Functions

Located in `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts`:

| Function                             | Behavior                              | Use Case                                                               |
| ------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------- |
| `escapeHelmGoTemplate(template)`     | `{{ X }}` → `{{ "{{" }} X {{ "}}" }}` | Inline strings in TypeScript with Go/Jinja2 template syntax            |
| `escapePrometheusTemplate(template)` | Delegates to `escapeHelmGoTemplate`   | Prometheus rule annotations                                            |
| `escapeGoTemplate(template)`         | Identity function (no-op)             | Content that does NOT go through Helm (currently unused in production) |
| `escapeAlertmanagerTemplate`         | Alias for `escapeGoTemplate`          | Same as above                                                          |

For file content read via `Bun.file()` that contains `{{`, use manual `.replaceAll()` since the escape functions expect `{{ X }}` patterns with spaces, not arbitrary `{{`:

```typescript
const content = await Bun.file("r2_exporter.py").text();
const escaped = content
  .replaceAll("{{", '{{ "{{" }}')
  .replaceAll("}}", '{{ "}}" }}');
```

For raw config files (e.g., HA `configuration.yaml`) that cannot go through a TypeScript function, pre-escape `{{` directly in the source file.

## Inventory

18 TypeScript files embed content into K8s resources. Only 2 output charts contain `{{`:

| Chart           | Escaped Sequences | Sources                                                                                   |
| --------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `apps.k8s.yaml` | 196+              | 20 Prometheus rule files, event-exporter, PagerDuty config, Loki alert rules, R2 exporter |
| `home.k8s.yaml` | 5                 | HA Jinja2 templates in `configuration.yaml`                                               |

Safe content (no `{{`): Minecraft configs (50+ files), Grafana dashboards (JSON), shell scripts (`smartmon.sh`, `zfs_zpool.sh`), Python scripts without f-string braces (`nvme_metrics.py`, `zfs_snapshots.py`), XML configs (ClickHouse), YAML configs (`gickup.yml`, `discordsrv`), JSON configs (`mcp-gateway`).

## Adding New Embedded Content

Decision tree:

1. **Does the content contain `{{` or `}}`?** If no, no escaping needed.
2. **Is the content in a TypeScript template literal?** Use `escapeHelmGoTemplate()` wrapper.
3. **Is the content read from a file via `Bun.file()`?** Use `.replaceAll("{{", '{{ "{{" }}').replaceAll("}}", '{{ "}}" }}')` after reading.
4. **Is the content in a raw config file (YAML, TOML, etc.)?** Pre-escape `{{` to `{{ "{{" }}` in the source file.
5. **When in doubt**, run `bun run build` then `helm template` on the affected chart to verify.

## Validation

The `helm-compatibility.test.ts` test suite validates:

1. **Denylist regex** — flags ANY `{{`/`}}` not wrapped in `{{ "{{" }}`
2. **`helm template`** — runs real Helm on each synthesized chart
3. **E2E content check** — verifies rendered output is correct for each consumer

Lefthook pre-commit runs `lint-helm.sh` on homelab changes.

## Bug History

The R2 exporter (`r2_exporter.py`) embedded Python f-strings `{{bucket="..."}}` without escaping. This went undetected because the regex-based validation only checked for known Go template keywords. Fixed by adding `.replaceAll()` escaping and replacing the regex allowlist with a denylist.
