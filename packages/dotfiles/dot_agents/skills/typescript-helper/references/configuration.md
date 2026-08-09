# TypeScript configuration

Read this when creating a tsconfig, selecting strict flags, or wiring a multi-project build.

## Configuration discovery

Running `tsc` without filenames searches upward for a tsconfig. `tsc -p path` selects one explicitly. `tsc --showConfig` displays the resolved configuration.

Source filenames on the command line historically ignore tsconfig. TypeScript 7 rejects the ambiguous config-plus-filenames case unless `--ignoreConfig` makes the bypass explicit.

## Shared strict settings

Use `strict` as the umbrella. Add checks according to the project contract:

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

The contents of `strict` can change in future versions. Do not duplicate every current sub-flag unless the project needs a specific override.

`skipLibCheck` skips checking declaration files. It can reduce work or bridge ecosystem incompatibility, but it can also hide conflicting or invalid declarations. Never use it as the automatic answer to an upgrade failure.

## Host-specific examples

Bundler or Bun application:

```json
{
  "compilerOptions": {
    "module": "preserve",
    "moduleResolution": "bundler",
    "noEmit": true,
    "strict": true,
    "verbatimModuleSyntax": true
  }
}
```

Modern Node application:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "strict": true,
    "verbatimModuleSyntax": true
  }
}
```

These are starting points, not complete universal configs. Select `target`, libraries, JSX, declaration output, source maps, and path behavior from the deployment and publishing contract.

## Project references

Referenced projects require `composite`. Build them with `tsc -b`; build mode performs dependency-aware incremental work.

```json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/web" }
  ]
}
```

Do not invoke every referenced package separately when the repository already provides a build graph.
