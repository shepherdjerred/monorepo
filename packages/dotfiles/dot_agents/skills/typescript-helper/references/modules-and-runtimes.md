# TypeScript modules and runtimes

Read this when module resolution, import syntax, runtime execution, ESM/CommonJS interop, or extension rewriting is involved.

## Compiler model

`module` describes module syntax and host behavior; `moduleResolution` describes lookup. Choose them together:

- Modern Node: `module: "nodenext"`.
- Deliberate Node 20 contract: `module: "node20"`.
- Bundler or Bun: `module: "preserve"` or `"esnext"` with `moduleResolution: "bundler"`.
- Do not start new projects with `node10` or `classic` resolution.

Interop flags model host and transpiler behavior; they are not a substitute for the correct host mode.

## Type-only imports

With `verbatimModuleSyntax`, imports and exports without `type` remain in output, while explicit type-only imports are erased.

```typescript
import { startServer } from "./server.js";
import type { ServerOptions } from "./server.js";
```

Node's built-in TypeScript stripping requires erasable syntax and ignores tsconfig. Use `import type` so a type-only dependency is not treated as a runtime import.

## Relative extension rewriting

`rewriteRelativeImportExtensions` rewrites static relative `.ts`, `.tsx`, `.mts`, and `.cts` specifiers to JavaScript equivalents during emit. It does not rewrite:

- aliases,
- dependency or package specifiers,
- package `imports` and `exports`,
- dynamic expressions.

`allowImportingTsExtensions` is a separate permission used when the runtime or resolver can interpret TypeScript extensions. Follow its documented emit constraints.

## Runtime matrix

| Runtime | Direct TypeScript behavior |
| --- | --- |
| Current Node | Type stripping is enabled by default in supported current releases and stable in newer lines; only erasable syntax; ignores tsconfig |
| Bun | Executes TS/TSX and recommends a bundler-oriented tsconfig; execution is separate from type-checking |
| `ts-node` | JIT transformation for Node with optional type-checking |
| `tsx` | Runtime transformer; verify semantics against its current docs and project needs |

Do not use `--enable-source-maps` as a compile-cache switch. Node's module compile cache uses `module.enableCompileCache()` or `NODE_COMPILE_CACHE`; it may slow the first load and improve subsequent unchanged loads.
