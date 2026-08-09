# TypeScript releases and migration

Read this when selecting TypeScript 6 versus 7, upgrading a project, or evaluating a performance or compatibility claim.

## TypeScript 7.0

TypeScript 7.0 became stable on 2026-07-08. It is the native Go implementation of the compiler and language server. Microsoft reports typical 8–12x faster full builds, with parallel parsing, checking, and emitting.

The central compatibility boundary is that 7.0 does not ship a programmatic API. Tools that import `typescript`—including some Angular template-checking and Vue, MDX, Astro, or Svelte integrations—may need TypeScript 6 until the native API arrives. A compiler being stable does not make every embedded-tool integration compatible.

`--checkers` and `--builders` are experimental concurrency controls. More workers can increase memory use. `--singleThreaded` is useful for debugging or constrained environments.

## TypeScript 6.x bridge

TypeScript 6 is the last release from the JavaScript compiler codebase and the migration bridge from 5.9 to 7. Use `stableTypeOrdering` to approximate TypeScript 7's deterministic ordering before switching compilers.

Before upgrading to 7.0:

1. Make the project clean on current 6.x.
2. Enable `stableTypeOrdering` and review output or snapshot changes.
3. Remove `ignoreDeprecations` and fix each exposed configuration issue.
4. Set `rootDir` explicitly for nested source layouts.
5. List intended global `types` explicitly; 7.0 defaults to `[]`.
6. Replace `moduleResolution: "node"` / `"node10"` and `"classic"`.
7. Remove obsolete ES5/downlevel iteration, AMD/UMD/SystemJS/none, `baseUrl`, `outFile`, false interop, and false `alwaysStrict` settings.
8. Replace legacy namespace and import-assertion syntax.
9. Check command lines that combine source filenames with a config; 7.0 requires explicit `--ignoreConfig` for that bypass.
10. Confirm every framework, linter, editor, and build tool that embeds the programmatic API supports the selected compiler.

The official package alias can keep TypeScript 6 available as `@typescript/typescript6`, with a `tsc6` binary. Tools that directly import the `typescript` package can require the official npm-alias layout rather than only the alternate binary.

## TypeScript 5.9 context

TypeScript 5.9 introduced `import defer`, stable `module: "node20"`, and a smaller `tsc --init` output. It is historical context for projects crossing multiple releases, not the current baseline.

## Version selection

- Stable application whose tooling supports the native compiler: prefer the repository-approved TypeScript 7 version.
- Tool or framework that imports the programmatic API: remain on current TypeScript 6 until compatibility is documented.
- Preview testing: use `typescript@next` only in an explicit canary path.
- Never install the old `@typescript/native-preview` package as the stable TypeScript 7 path.

## Research ledger

The following official pages were fetched and inspected for this refresh:

1. [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
2. [TypeScript 7.0 RC](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/)
3. [TypeScript 7.0 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/)
4. [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)
5. [TypeScript 6.0 RC](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-rc/)
6. [TypeScript 6.0 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-beta/)
7. [Announcing TypeScript 5.9](https://devblogs.microsoft.com/typescript/announcing-typescript-5-9/)
8. [A 10x Faster TypeScript](https://devblogs.microsoft.com/typescript/typescript-native-port/)
9. [TypeScript Native Previews](https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/)
10. [Nightly builds](https://www.typescriptlang.org/docs/handbook/nightly-builds.html)
11. [Download TypeScript](https://www.typescriptlang.org/download/)
12. [What is a tsconfig.json](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html)
13. [tsc CLI options](https://www.typescriptlang.org/docs/handbook/compiler-options.html)
14. [Project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
15. [Modules introduction](https://www.typescriptlang.org/docs/handbook/modules/introduction.html)
16. [Modules theory](https://www.typescriptlang.org/docs/handbook/modules/theory.html)
17. [ESM/CJS interoperability](https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html)
18. [Migrating from JavaScript](https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html)
19. [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
20. [More on functions](https://www.typescriptlang.org/docs/handbook/2/functions.html)
21. [Object types](https://www.typescriptlang.org/docs/handbook/2/objects.html)
22. [Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)
23. [Conditional types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
24. [Utility types](https://www.typescriptlang.org/docs/handbook/utility-types.html)
25. [Declaration-file dos and don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
26. [Type inference](https://www.typescriptlang.org/docs/handbook/type-inference.html)
27. [TypeScript 5.7 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html)
28. [rewriteRelativeImportExtensions](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html)
29. [verbatimModuleSyntax](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html)
30. [allowImportingTsExtensions](https://www.typescriptlang.org/tsconfig/allowImportingTsExtensions.html)
31. [moduleResolution](https://www.typescriptlang.org/tsconfig/moduleResolution.html)
32. [module](https://www.typescriptlang.org/tsconfig/module.html)
33. [noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)
34. [exactOptionalPropertyTypes](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)
35. [strict](https://www.typescriptlang.org/tsconfig/strict.html)

Supplemental runtime and tooling pages:

36. [Node.js TypeScript support](https://nodejs.org/api/typescript.html)
37. [Node module compile cache](https://nodejs.org/api/module.html#module-compile-cache)
38. [Bun TypeScript](https://bun.sh/docs/runtime/typescript)
39. [ts-node overview](https://typestrong.org/ts-node/docs/)
40. [typescript-eslint getting started](https://typescript-eslint.io/getting-started/)
41. [typescript-eslint typed linting](https://typescript-eslint.io/getting-started/typed-linting/)
42. [Everyday types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)
