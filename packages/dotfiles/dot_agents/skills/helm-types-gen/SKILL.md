---
name: helm-types-gen
description: >-
  Use when asking about generating Helm types, HelmValuesForChart,
  TypeScript interfaces from Helm charts, or the helm-types CLI.
---

# Helm Types Generation

## Overview

The `@homelab/helm-types` package generates TypeScript interfaces from Helm chart JSON schemas, enabling compile-time type safety for Helm values configuration.

## CLI Usage

```bash
bunx @homelab/helm-types \
  --name argo-cd \
  --repo https://argoproj.github.io/argo-helm \
  --version 8.3.1 \
  --output src/cdk8s/generated/helm/argo-cd.types.ts
```

## CLI Options

| Option        | Alias | Required | Description                                     |
| ------------- | ----- | -------- | ----------------------------------------------- |
| `--name`      | `-n`  | Yes      | Unique identifier for the chart                 |
| `--repo`      | `-r`  | Yes      | Helm repository URL                             |
| `--version`   | `-v`  | Yes      | Chart version                                   |
| `--chart`     | `-c`  | No       | Chart name in repo (defaults to --name)         |
| `--output`    | `-o`  | No       | Output file path (stdout if omitted)            |
| `--interface` | `-i`  | No       | Interface name (auto-generated from chart name) |

## Integration with CDK8s

### Step 1: Generate Types

```bash
bunx @homelab/helm-types \
  --name cert-manager \
  --repo https://charts.jetstack.io \
  --version 1.14.0 \
  --output src/cdk8s/generated/helm/cert-manager.types.ts
```

### Step 2: Register in HelmChartValuesMap

Edit `src/cdk8s/src/misc/typed-helm-parameters.ts`:

```typescript
import type { CertmanagerHelmValues } from "../../generated/helm/cert-manager.types.ts";

type HelmChartValuesMap = {
  "argo-cd": ArgocdHelmValues;
  "cert-manager": CertmanagerHelmValues; // Add new chart
  // ... other charts
};

export type HelmValuesForChart<TChart extends keyof HelmChartValuesMap> =
  HelmChartValuesMap[TChart];
```

### Step 3: Use in ArgoCD Applications

```typescript
import type { HelmValuesForChart } from "../misc/typed-helm-parameters.ts";

const certManagerValues: HelmValuesForChart<"cert-manager"> = {
  installCRDs: true, // Type-safe with autocomplete
  prometheus: {
    enabled: true,
    servicemonitor: {
      enabled: true,
    },
  },
};
```

## How It Works

The tool performs these steps:

1. **Fetch Chart**: Downloads chart from Helm repo, extracts `values.yaml` and `values.schema.json`
2. **Parse YAML**: Extracts structure and preserves comments for documentation
3. **Convert Schema**: Transforms JSON Schema to TypeScript types
4. **Infer Types**: Falls back to runtime type inference when schema is incomplete
5. **Generate Code**: Outputs TypeScript interfaces with JSDoc comments

## Regenerating Committed Types — Gotchas

The committed `src/cdk8s/generated/helm/*.types.ts` are the **source of truth** (git-committed,
refreshed weekly by the `helm-types-weekly-refresh` Temporal schedule, which opens a PR on
drift). `bun run generate-helm-types` (`src/cdk8s/scripts/generate-helm-types.ts`) `helm pull`s
every chart in `versions.ts`. Behavior (post-PR #1150):

- **Writes in place, no destructive wipe.** It used to `rm -rf generated/helm` then regenerate,
  so a single flaky fetch could silently delete a committed type file. Now it writes in place,
  retries fetches 3×, prunes only charts removed from `versions.ts`, and throws if any chart
  can't be generated (two runs ⇒ 0 diff).
- **Uses the repo's pinned prettier** (workspace 3.8.3 + `.prettierrc`), with a scoped
  `helm repo update <repoName>` and fail-fast prettier — a full generate leaves the tree
  byte-clean, no manual `prettier --write` needed afterward.
- **Recovery:** if generated types go missing/wrong, `git restore packages/homelab/src/cdk8s/generated/helm/`
  (the whole dir) — never re-run the generator to "fix" them.
- **OCI charts** (kueue, agent-stack-k8s) use `datasource=docker` in `versions.ts`
  (renovate models OCI as docker); they're pulled via `helm pull oci://…` and tracked by the
  `OCI_CHART_KEYS` allowlist in `parse-helm-charts.ts`.
- **Commented-out config keys** (e.g. buildkite `config.{queue,…}`)
  need `EXTENSIBLE_TYPE_PATTERNS` entries in `helm-types/src/config.ts`, since the generator only
  infers from active `values.yaml` defaults; those blocks become `[key: string]: unknown`.

## Generated Type Features

- **Nested Interfaces**: Each object becomes its own TypeScript type
- **JSDoc Comments**: Preserves documentation from chart comments
- **Default Values**: Shows `@default` annotations
- **Optional Properties**: All properties are optional (Helm defaults apply)
- **Extensible Types**: ConfigMaps and similar allow arbitrary keys

## Example Generated Output

```typescript
export type CertmanagerHelmValues = {
  /**
   * Install CRDs as part of the Helm release
   * @default true
   */
  installCRDs?: boolean;

  /**
   * Prometheus monitoring configuration
   */
  prometheus?: CertmanagerHelmValuesPrometheus;
};

export type CertmanagerHelmValuesPrometheus = {
  enabled?: boolean;
  servicemonitor?: CertmanagerHelmValuesPrometheusServicemonitor;
};
```

## Key Files

- `src/helm-types/src/cli.ts` - CLI entry point
- `src/helm-types/src/type-converter.ts` - JSON Schema → TypeScript conversion
- `src/helm-types/src/yaml-comments.ts` - Comment extraction and preservation
- `src/helm-types/src/interface-generator.ts` - Code generation
- `src/cdk8s/src/misc/typed-helm-parameters.ts` - Type registry
- `src/cdk8s/generated/helm/*.types.ts` - Generated type files
