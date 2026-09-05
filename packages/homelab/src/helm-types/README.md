# @shepherdjerred/helm-types

Generate TypeScript types from a Helm chart's `values.yaml` and optional
`values.schema.json`. The CLI and library preserve YAML comments as JSDoc,
infer nested types, and emit a flattened type for `helm --set` parameters.

Requires Node.js 24 or newer, or Bun, plus the `helm` CLI on `PATH`.

## Why use this?

Helm charts expose configuration as YAML, so a typo in an override or a string
where a chart expects a number can survive review and fail late. `helm-types`
turns one pinned chart version into TypeScript types, including chart comments
and flattened `--set` keys, so an editor and CI can check those values first.

Use it when you are building:

- A TypeScript or cdk8s deployment that configures third-party Helm charts.
- GitOps configuration that should catch renamed keys and wrong value types
  before a Helm render or cluster apply.
- A deployment CLI that accepts chart settings and needs a checked list of
  supported dotted `--set` parameters.

## Quick start

```bash
bun add -d @shepherdjerred/helm-types

npx @shepherdjerred/helm-types \
  --name argo-cd \
  --repo https://argoproj.github.io/argo-helm \
  --version 7.7.16 \
  --output src/generated/argo-cd-values.ts
```

The command downloads the exact chart version into a temporary directory,
generates the file, then removes that directory. It does not add, update, or
remove Helm repositories in your local Helm configuration.

Use `bunx @shepherdjerred/helm-types` instead of `npx` when Bun is your package
manager.

## CLI usage

```bash
# Print the generated module to stdout.
npx @shepherdjerred/helm-types \
  -n argo-cd \
  -r https://argoproj.github.io/argo-helm \
  -v 7.7.16

# The chart name can differ from the generated module name.
npx @shepherdjerred/helm-types \
  --name platform-argo-cd \
  --chart argo-cd \
  --repo https://argoproj.github.io/argo-helm \
  --version 7.7.16 \
  --interface PlatformArgoCdValues \
  --output src/generated/platform-argo-cd.ts
```

**Options:**

| Flag              | Description                                     |
| ----------------- | ----------------------------------------------- |
| `--name, -n`      | Unique identifier for the chart (required)      |
| `--chart, -c`     | Chart name in repository (defaults to --name)   |
| `--repo, -r`      | Helm repository URL (required)                  |
| `--version, -v`   | Chart version (required)                        |
| `--output, -o`    | Output file path (defaults to stdout)           |
| `--interface, -i` | Interface name (auto-generated if not provided) |
| `--help, -h`      | Show help message                               |

`--version` is the Helm chart version, not the package version. Run
`helm-types --help` to inspect the installed CLI.

## Programmatic API

```ts
import { writeFile } from "node:fs/promises";
import {
  fetchHelmChart,
  convertToTypeScriptInterface,
  generateTypeScriptCode,
} from "@shepherdjerred/helm-types";

// 1. Define your chart
const chart = {
  name: "argo-cd",
  chartName: "argo-cd",
  repoUrl: "https://argoproj.github.io/argo-helm",
  version: "7.7.16",
};

// 2. Fetch and generate types
const { values, schema, yamlComments } = await fetchHelmChart(chart);
const tsInterface = convertToTypeScriptInterface({
  values,
  interfaceName: "ArgocdHelmValues",
  schema,
  yamlComments,
  chartName: chart.name,
});
const code = generateTypeScriptCode(tsInterface, chart.name);

// 3. Write output
await writeFile("argo-cd.types.ts", code);
```

The runnable [`examples/argo-cd/generate.mjs`](examples/argo-cd/generate.mjs)
writes the generated module to standard output so callers choose where it
belongs.

## Demo recording

The included replayable asciicast starts with the pinned chart's `server`
values, shows the generated `replicas?: number` contract, then contrasts an
unsafe override with the typed alternative:

```bash
asciinema play node_modules/@shepherdjerred/helm-types/demos/argo-cd-cli.cast
```

## Generated output

### Values Interface

```typescript
export type ArgocdHelmValues = {
  /**
   * Number of replicas
   * @default 1
   */
  replicaCount?: number;

  image?: ArgocdHelmValuesImage;
  service?: ArgocdHelmValuesService;
};
```

### Nested Types

```typescript
export type ArgocdHelmValuesImage = {
  repository?: string;
  tag?: string;
  pullPolicy?: "Always" | "IfNotPresent" | "Never";
};
```

### Parameters Type (Flattened)

A flattened type using dot notation for Helm's `--set` parameter syntax:

```typescript
export type ArgocdHelmParameters = {
  replicaCount?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "service.type"?: string;
};
```

## Type inference

The library intelligently infers types from values:

| Value               | Inferred Type    |
| ------------------- | ---------------- |
| `true`, `false`     | `boolean`        |
| `"true"`, `"false"` | `boolean`        |
| `123`, `3.14`       | `number`         |
| `"123"`             | `number`         |
| `"hello"`           | `string`         |
| `[]`                | `unknown[]`      |
| `[1, 2]`            | `number[]`       |
| `{}`                | nested interface |

JSON schema takes precedence when available.

## API reference

### `fetchHelmChart(chart: ChartInfo)`

Fetches a Helm chart and extracts configuration.

```typescript
type ChartInfo = {
  name: string; // Unique identifier
  chartName: string; // Chart name in repo
  repoUrl: string; // Helm repository URL
  version: string; // Chart version
};

// Returns
{
  values: Record<string, unknown>;
  schema: JSONSchemaProperty | null;
  yamlComments: Map<string, string>;
}
```

### `convertToTypeScriptInterface(options)`

Converts Helm values to a TypeScript interface definition.

- `options.values` - Chart values object
- `options.interfaceName` - Interface name
- `options.schema?` - Optional JSON schema for type hints
- `options.yamlComments?` - Optional YAML comments for JSDoc
- `options.keyPrefix?` - Optional key prefix for nested types
- `options.chartName?` - Chart name used for chart-specific type rules

### `generateTypeScriptCode(interface, chartName)`

Generates TypeScript code from interface definition. Returns a string containing the main values
interface, nested type definitions, and flattened parameters type.

## License

GPL-3.0-only.
