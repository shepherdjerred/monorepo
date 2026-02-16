# Dagger Module Notes

## Using npm packages that depend on @dagger.io/dagger

When using npm packages that import from `@dagger.io/dagger` (like `@shepherdjerred/dagger-utils`), you must use **Bun runtime** instead of the default Node.js/tsx runtime.

### The Problem

The Node.js runtime uses `tsx` which has ESM resolution issues. When resolving `@dagger.io/dagger`, it calls `legacyMainResolve` which looks for `index.js` at the package root instead of respecting the `exports` field in package.json. This causes:

```
Error: Cannot find package '/src/.dagger/node_modules/@dagger.io/dagger/index.js'
```

Additionally, Dagger always overrides `@dagger.io/dagger` to point to the local `./sdk` directory via `npm pkg set "dependencies[@dagger.io/dagger]=./sdk"`, so installing from npm doesn't help.

### The Solution

Add the Bun runtime configuration to `.dagger/package.json`:

```json
{
  "dagger": {
    "runtime": "bun"
  }
}
```

Bun correctly handles ESM `exports` fields, allowing packages like `@shepherdjerred/dagger-utils` to properly import from `@dagger.io/dagger`.

### Example package.json

```json
{
  "name": "@webring/dagger",
  "type": "module",
  "private": true,
  "scripts": {
    "lint": "bunx eslint src",
    "format": "bunx prettier --check src",
    "typecheck": "bunx tsc --noEmit"
  },
  "dagger": {
    "runtime": "bun"
  },
  "dependencies": {
    "@dagger.io/dagger": "^0.19.8",
    "@shepherdjerred/dagger-utils": "^0.1.0",
    "typescript": "^5.8.2"
  }
}
```
