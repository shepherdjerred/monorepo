---
name: typescript-helper
description: Current TypeScript configuration, migration, module, runtime, typing, and tooling guidance. Use when writing or reviewing TypeScript, selecting tsconfig settings, migrating TypeScript versions, resolving module/runtime mismatches, or designing safe typed boundaries.
---

# TypeScript Helper

Use TypeScript to make program contracts explicit, then validate data where static types end. Choose compiler and module settings from the actual runtime or bundler instead of applying one universal configuration.

## Current status

Verified 2026-08-03.

| Line | Status | Important boundary |
| --- | --- | --- |
| TypeScript 7.0 | Current stable native compiler and language server | No programmatic API in 7.0; tools that import or embed TypeScript may still require 6.x |
| TypeScript 6.x | JavaScript-codebase compatibility bridge | Use it to expose migration issues and stabilize type ordering before 7.0 |
| `typescript@next` | Nightly builds | Preview only; do not silently use it in production |

TypeScript reports typical 8–12x full-build improvements for the native 7.0 compiler. Treat that as an official benchmark range, not a universal guarantee. The experimental `--checkers` and `--builders` controls trade memory for concurrency; do not make them default without measuring the project.

Always inspect the selected toolchain:

```bash
tsc --version
tsc --showConfig
```

Read [references/releases-and-migration.md](references/releases-and-migration.md) before a TypeScript 6 or 7 upgrade. Read [references/configuration.md](references/configuration.md) when creating or reviewing a tsconfig. Read [references/modules-and-runtimes.md](references/modules-and-runtimes.md) for Node, Bun, bundler, ESM, and CommonJS decisions. Read [references/type-safety.md](references/type-safety.md) for narrowing, generics, validation, and exhaustiveness. Read [references/tooling.md](references/tooling.md) for ESLint and execution tooling.

## Project-safe commands

Type-check through the project configuration or build graph:

```bash
tsc -p tsconfig.json --noEmit
tsc -b
```

Passing source filenames to `tsc` bypasses project configuration historically. TypeScript 7 errors when a config is present unless that bypass is made explicit with `--ignoreConfig`. Do not use `tsc file.ts` as the normal project check.

In this monorepo, prefer its focused Turbo task over invoking a different compiler configuration:

```bash
bunx turbo run typecheck --filter=<package>
```

## Model the runtime

| Host | Compiler model | Execution boundary |
| --- | --- | --- |
| Modern Node | `module: "nodenext"` | Node's built-in TypeScript ignores tsconfig and directly runs only erasable syntax |
| Node 20 contract | `module: "node20"` | Fixed Node 20 behavior; use only when deliberately targeting it |
| Bundler or Bun application | `module: "preserve"` or `"esnext"`, `moduleResolution: "bundler"` | The runtime/bundler resolves and transforms modules; type-check separately |
| Multi-project library | Project references and `tsc -b` | Referenced projects require `composite` |

Do not rank Node, Bun, `tsx`, or `ts-node` as universally fastest. Select based on runtime semantics, transformation support, type-checking needs, and repository conventions.

## Strict baseline

Start with `strict`; add checks that reflect the project's boundary and indexing risks. The exact set enabled by `strict` can grow between releases.

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedSideEffectImports": true,
    "types": []
  }
}
```

- `noUncheckedIndexedAccess` adds `undefined` to undeclared index-signature lookups.
- `exactOptionalPropertyTypes` distinguishes absence from a present `undefined` value.
- An explicit `types` list prevents accidental global-type inclusion and is required during the TypeScript 7 migration because 7.0 defaults it to `[]`.
- `skipLibCheck` is a deliberate compatibility and performance trade-off, not a correctness baseline. Do not use it to hide an upgrade failure.

## Validate external data

Static annotations do not validate JSON, environment variables, HTTP bodies, database rows, cache values, or deserialized files. Keep these values unknown until parsed.

```typescript
import { z } from "zod";

const User = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
});

type User = z.infer<typeof User>;

async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw new Error(`User request failed: ${response.status}`);
  }
  return User.parse(await response.json());
}
```

Do not assign `response.json()` directly to a domain type. Do not use a type assertion to manufacture a branded ID; validate and construct it through a schema or omit the brand.

## Narrow instead of asserting

Use control-flow checks, discriminants, `typeof`, `instanceof`, `Array.isArray`, property checks, or a runtime schema. Avoid non-null assertions and unchecked casts.

```typescript
type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; count: number }
  | { kind: "failed"; message: string };

function describe(state: State): string {
  switch (state.kind) {
    case "idle":
      return "Idle";
    case "loading":
      return "Loading";
    case "loaded":
      return `${state.count} records`;
    case "failed":
      return state.message;
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled state: ${JSON.stringify(value)}`);
}
```

A reducer that returns the old state from a default branch hides newly added actions. Exhaustive `never` handling makes the missing case fail during checking.

## Type design

- Let inference handle obvious local values and return types when the public contract remains clear.
- Use generics when a type parameter relates two or more values; do not introduce a type parameter used only once.
- Prefer `unknown` to `any` at an untyped boundary, then narrow it.
- `readonly` blocks reassignment during checking; it is not deep runtime immutability.
- Interfaces and type aliases overlap. Use interfaces when declaration merging or reopenable object contracts are desired; use aliases for unions, primitives, tuples, and type composition.
- Optional callback parameters mean the callback may be invoked without that argument. They do not mean the consumer may ignore a required argument.
- Use primitive `string`, `number`, and `boolean` types, not boxed `String`, `Number`, and `Boolean`.

## Modules and imports

`module` and `moduleResolution` jointly model emitted syntax and how the host resolves imports. `node10` and `classic` resolution are obsolete for new projects.

Use `import type` and `export type` when an import exists only for types. With `verbatimModuleSyntax`, value imports remain and explicit type-only imports are erased.

`rewriteRelativeImportExtensions` rewrites only static relative `.ts`, `.tsx`, `.mts`, and `.cts` specifiers. It does not resolve path aliases, package `imports` or `exports`, dependency specifiers, or computed dynamic imports. Keep it distinct from `allowImportingTsExtensions`.

## Migration discipline

Do not mass-rename a JavaScript tree. Official migration guidance starts with `allowJs` and a separate output directory, then tightens checks and converts modules incrementally. Rename imports and configuration deliberately, exclude generated or vendor code by design, and verify each package through its real build graph.

For TypeScript 6 → 7, first make the project clean on 6.x with `stableTypeOrdering`, then address the removed and changed options listed in [references/releases-and-migration.md](references/releases-and-migration.md). Confirm whether framework tooling embeds the TypeScript programmatic API before selecting 7.0.

## Tooling

Current typescript-eslint setup uses flat `eslint.config.mjs`. Typed linting uses type-aware configurations and `parserOptions.projectService: true`. Keep the project compiler check separate from runtime execution: Node or Bun running a `.ts` file does not prove it type-checks.

Do not duplicate a generic Vite, Webpack, test-runner, or framework setup in this skill. Load the matching tool skill and use its current official configuration.

## Review checklist

- Confirm the installed TypeScript version and whether consumers need its programmatic API.
- Invoke the project config or build graph, not a source-file bypass.
- Match module settings to Node, Bun, or the actual bundler.
- Validate every external value before assigning a domain type.
- Replace assertions and non-null promises with narrowing or schemas.
- Make discriminated unions exhaustive.
- Use strict checks intentionally and do not hide dependency errors with `skipLibCheck`.
- Keep runtime execution, transpilation, and type-checking as separate claims.
- Read migration notes for every version crossed.
