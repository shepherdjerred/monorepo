# @shepherdjerred/helm-types

Generate TypeScript types from Helm chart values.

## What it does

This tool fetches Helm charts and generates strongly-typed TypeScript interfaces from their
`values.yaml` and `values.schema.json` files. Use it to get type-safe Helm configurations in your
TypeScript projects.

**Features:**

- Fetch charts from any Helm repository
- Generate nested interfaces with proper types
- Parse YAML comments for JSDoc documentation
- Support for arrays, unions, enums, and optional properties
- Handle reserved keywords and special characters

## Installation

```bash
npm install @shepherdjerred/helm-types
# or
bun add @shepherdjerred/helm-types
```

## Requirements

- **Node.js 18+** or **Bun**
- **Helm CLI** installed and available in PATH

## CLI Usage

Generate types directly with npx/bunx:

```bash
# Generate types for ArgoCD
npx @shepherdjerred/helm-types \
  --name argo-cd \
  --repo https://argoproj.github.io/argo-helm \
  --version 8.3.1 \
  --output argo-cd.types.ts

# Short flags
npx @shepherdjerred/helm-types \
  -n argo-cd \
  -r https://argoproj.github.io/argo-helm \
  -v 8.3.1 \
  -o argo-cd.types.ts

# Print to stdout
npx @shepherdjerred/helm-types \
  -n argo-cd \
  -r https://argoproj.github.io/argo-helm \
  -v 8.3.1

# Custom interface name
npx @shepherdjerred/helm-types \
  -n argo-cd \
  -r https://argoproj.github.io/argo-helm \
  -v 8.3.1 \
  -i CustomArgocdValues \
  -o argo-cd.types.ts
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

## Programmatic API

```typescript
import { fetchHelmChart, convertToTypeScriptInterface, generateTypeScriptCode } from "@shepherdjerred/helm-types";

// 1. Define your chart
const chart = {
  name: "argo-cd",
  chartName: "argo-cd",
  repoUrl: "https://argoproj.github.io/argo-helm",
  version: "8.3.1",
};

// 2. Fetch and generate types
const { values, schema, yamlComments } = await fetchHelmChart(chart);
const tsInterface = convertToTypeScriptInterface(values, "ArgocdHelmValues", schema, yamlComments);
const code = generateTypeScriptCode(tsInterface, chart.name);

// 3. Write output
await fs.writeFile("argo-cd.types.ts", code);
```

## Generated Output

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

## Type Inference

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

## API Reference

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

### `convertToTypeScriptInterface(values, name, schema?, comments?, prefix?)`

Converts Helm values to TypeScript interface definition.

- `values` - Chart values object
- `name` - Interface name
- `schema?` - Optional JSON schema for type hints
- `comments?` - Optional YAML comments for JSDoc
- `prefix?` - Optional key prefix for nested types

### `generateTypeScriptCode(interface, chartName)`

Generates TypeScript code from interface definition. Returns a string containing the main values
interface, nested type definitions, and flattened parameters type.

### `parseYAMLComments(yamlContent)`

Extracts YAML comments and associates them with keys.

## License

GPL-3.0
