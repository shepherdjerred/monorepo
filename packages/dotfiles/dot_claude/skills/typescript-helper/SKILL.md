---
name: typescript-helper
description: "Resolve TypeScript type errors, configure tsconfig.json, apply TS 5.7+ features (path rewriting, ES2024, V8 caching), define advanced type patterns (discriminated unions, branded types), and migrate JavaScript projects to TypeScript with validation checkpoints"
---

# TypeScript Helper Agent

## What's New in TypeScript 5.7 & 2025

- **Never-Initialized Variables**: Detects variables that are never assigned in nested scopes
- **Path Rewriting**: `--rewriteRelativeImportExtensions` auto-converts .ts to .js imports
- **ES2024 Support**: `Object.groupBy()`, `Map.groupBy()`, `Promise.withResolvers()`
- **V8 Compile Caching**: `module.enableCompileCache()` = ~2.5x faster startup (Node 22+)
- **TypeScript 7.0 Preview**: 10x speedup, multi-threaded builds coming soon
- **Direct Execution**: ts-node, tsx, and Node 23.x `--experimental-strip-types`

## CLI Commands

### TypeScript Compiler

```bash
# Check types without emitting
tsc --noEmit

# Check with specific config
tsc --project tsconfig.build.json --noEmit

# Watch mode
tsc --watch

# Compile specific file
tsc app.ts

# Initialize tsconfig.json
tsc --init
```

### Running TypeScript Directly

```bash
# Using tsx (fast, recommended)
tsx app.ts

# Using bun (fastest for most workloads)
bun run app.ts

# Node.js 23+ with experimental type stripping (no transpilation)
node --experimental-strip-types app.ts

# With V8 compile caching for 2.5x faster startup (Node 22+)
node --experimental-strip-types --enable-source-maps app.ts

# Using ts-node
ts-node app.ts
```

## Modern TypeScript 5.7+ Features

### Path Rewriting for Imports

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "rewriteRelativeImportExtensions": true
  }
}

// You write:
import { foo } from "./utils.ts";

// TypeScript rewrites to:
import { foo } from "./utils.js";

// Enables direct .ts imports that work in Node.js ESM
```

### ES2024 Features

```typescript
// Object.groupBy()
const people = [
  { name: "Alice", age: 30 },
  { name: "Bob", age: 25 },
  { name: "Charlie", age: 30 },
];

const byAge = Object.groupBy(people, (person) => person.age);
// { 25: [{name: "Bob", ...}], 30: [{name: "Alice", ...}, {name: "Charlie", ...}] }

// Map.groupBy()
const grouped = Map.groupBy(people, (person) => person.age);
// Map { 25 => [{...}], 30 => [{...}, {...}] }

// Promise.withResolvers()
const { promise, resolve, reject } = Promise.withResolvers<number>();
setTimeout(() => resolve(42), 1000);
await promise; // 42
```

### V8 Compile Caching (Node 22+)

```typescript
// Enable at app entry point for ~2.5x faster startup
import { enableCompileCache } from "node:module";

enableCompileCache();

// All subsequent module loads use V8's code cache
```

## Advanced Type Patterns

### Discriminated Unions

```typescript
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rectangle"; width: number; height: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "rectangle":
      return shape.width * shape.height;
  }
}
```

### Branded Types

```typescript
type UserId = string & { readonly __brand: "UserId" };
type Email = string & { readonly __brand: "Email" };

function createUserId(id: string): UserId {
  return id as UserId;
}

// Prevents mixing up string IDs at compile time
function getUser(id: UserId): Promise<User> { /* ... */ }
getUser("abc");           // Error: string is not UserId
getUser(createUserId("abc")); // OK
```

### Type Guards and Assertion Functions

```typescript
// Type guard
function isString(value: unknown): value is string {
  return typeof value === "string";
}

// Assertion function
function assertString(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error("Not a string");
  }
}
```

## Practical Examples

### API Response Type with Error Handling

```typescript
type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function fetchUser(id: string): Promise<ApiResponse<User>> {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` };
  }
  return { ok: true, data: await response.json() };
}

// Usage with exhaustive handling
const result = await fetchUser("123");
if (result.ok) {
  console.log(result.data.name);
} else {
  console.error(result.error);
}
```

### Type-Safe State Management with Discriminated Unions

```typescript
type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: User }
  | { status: "error"; error: string };

type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; payload: User }
  | { type: "FETCH_ERROR"; payload: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "FETCH_START":
      return { status: "loading" };
    case "FETCH_SUCCESS":
      return { status: "success", data: action.payload };
    case "FETCH_ERROR":
      return { status: "error", error: action.payload };
  }
}
```

## JavaScript to TypeScript Migration Workflow

### Step 1: Initialize TypeScript Config

```bash
tsc --init
```

Start with a permissive config, then tighten:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "strict": false,
    "noImplicitAny": false,
    "skipLibCheck": true
  }
}
```

### Step 2: Rename Files (.js to .ts)

```bash
find src -name "*.js" -exec sh -c 'mv "$1" "${1%.js}.ts"' _ {} \;
find src -name "*.jsx" -exec sh -c 'mv "$1" "${1%.jsx}.tsx"' _ {} \;
```

**Validation checkpoint**: Run `tsc --noEmit` -- expect errors but confirm the compiler finds all files.

### Step 3: Fix Type Errors Incrementally

```bash
# Count current errors
tsc --noEmit 2>&1 | grep "error TS" | wc -l

# Fix errors file-by-file, starting with leaf modules (no imports from other project files)
tsc --noEmit --skipLibCheck
```

**Validation checkpoint**: Error count should decrease after each batch of fixes. Track with `tsc --noEmit 2>&1 | grep "error TS" | wc -l`.

### Step 4: Enable Strict Mode Incrementally

Enable one flag at a time, fixing errors between each:

```json
// Phase 1
{ "noImplicitAny": true }
// Validate: tsc --noEmit passes

// Phase 2
{ "noImplicitAny": true, "strictNullChecks": true }
// Validate: tsc --noEmit passes

// Phase 3
{ "strict": true }
// Validate: tsc --noEmit passes
```

**Validation checkpoint**: After each phase, confirm `tsc --noEmit` exits with code 0 before enabling the next flag.

### Step 5: Install Missing Type Declarations

```bash
# Find packages missing types
tsc --noEmit 2>&1 | grep "Could not find a declaration file"

# Install @types packages
bun add -d @types/node @types/react
```

**Validation checkpoint**: `tsc --noEmit` shows zero "Could not find a declaration file" errors.

### Type Declaration Files for Untyped Code

```typescript
// types/express.d.ts
declare namespace Express {
  export interface Request {
    user?: {
      id: string;
      email: string;
    };
  }
}

// types/globals.d.ts
declare global {
  interface Window {
    myApp: {
      version: string;
    };
  }
}

export {};
```

## Reference Files

For detailed configuration and tooling setup, see:

- `references/strict-typescript.md` -- Strict TypeScript patterns with Zod runtime validation
- `references/tsconfig-reference.md` -- Full tsconfig.json configuration options and recommended presets
- `references/build-tool-integration.md` -- Vite, Webpack, ESLint, Jest, and Vitest setup for TypeScript

## When to Ask for Help

Ask the user for clarification when:

- The desired type structure is ambiguous
- Multiple valid typing approaches exist
- Migration from JavaScript needs strategy decisions
- Build tool integration specifics are unclear
- Type error resolution requires code refactoring decisions
