---
description: TypeScript development guidance for type systems and tooling
when_to_use: When user works with .ts or .tsx files, mentions TypeScript, or encounters type errors
---

# TypeScript Helper Agent

## What's New in TypeScript 5.7 & 2025

- **Never-Initialized Variables**: Detects variables that are never assigned in nested scopes
- **Path Rewriting**: `--rewriteRelativeImportExtensions` auto-converts .ts → .js imports
- **ES2024 Support**: `Object.groupBy()`, `Map.groupBy()`, `Promise.withResolvers()`
- **V8 Compile Caching**: `module.enableCompileCache()` = ~2.5x faster startup (Node 22+)
- **TypeScript 7.0 Preview**: 10x speedup, multi-threaded builds coming soon
- **Direct Execution**: ts-node, tsx, and Node 23.x `--experimental-strip-types`

## Overview

This agent helps you work with TypeScript for type-safe development, including type system usage, configuration, error resolution, and tooling integration.

## CLI Commands

### TypeScript Compiler

```bash
# Compile TypeScript files
tsc

# Watch mode
tsc --watch

# Compile specific file
tsc app.ts

# Check types without emitting
tsc --noEmit

# Show compiler version
tsc --version

# Initialize tsconfig.json
tsc --init
```

### Type Checking

```bash
# Type check entire project
tsc --noEmit

# Type check with specific config
tsc --project tsconfig.build.json --noEmit

# Type check single file
tsc --noEmit file.ts
```

### Running TypeScript

```bash
# Using ts-node
ts-node app.ts

# Using tsx (faster, recommended)
tsx app.ts

# Using bun (fastest for most workloads)
bun run app.ts

# Node.js 23+ with experimental type stripping (no transpilation!)
node --experimental-strip-types app.ts

# With V8 compile caching for 2.5x faster startup (Node 22+)
node --experimental-strip-types --enable-source-maps app.ts
```

### Modern TypeScript 5.7+ Features

**Path rewriting for imports**:
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

**ES2024 features now available**:
```typescript
// Object.groupBy()
const people = [
  { name: "Alice", age: 30 },
  { name: "Bob", age: 25 },
  { name: "Charlie", age: 30 }
];

const byAge = Object.groupBy(people, person => person.age);
// { 25: [{name: "Bob", ...}], 30: [{name: "Alice", ...}, {name: "Charlie", ...}] }

// Map.groupBy()
const grouped = Map.groupBy(people, person => person.age);
// Map { 25 => [{...}], 30 => [{...}, {...}] }

// Promise.withResolvers()
const { promise, resolve, reject } = Promise.withResolvers<number>();
setTimeout(() => resolve(42), 1000);
await promise; // 42
```

**V8 compile caching (Node 22+)**:
```typescript
// Enable at app entry point for ~2.5x faster startup
import { enableCompileCache } from "node:module";

enableCompileCache();

// All subsequent module loads use V8's code cache
```

## Common TypeScript Patterns

### Type Annotations

```typescript
// Basic types
let name: string = "Alice";
let age: number = 30;
let active: boolean = true;
let items: string[] = ["a", "b", "c"];
let tuple: [string, number] = ["hello", 42];

// Objects
interface User {
  id: number;
  name: string;
  email?: string;  // Optional property
  readonly createdAt: Date;  // Readonly
}

const user: User = {
  id: 1,
  name: "Alice",
  createdAt: new Date()
};

// Functions
function greet(name: string): string {
  return `Hello, ${name}`;
}

const add = (a: number, b: number): number => a + b;

// Async functions
async function fetchData(): Promise<User> {
  const response = await fetch("/api/user");
  return response.json();
}
```

### Interfaces vs Types

```typescript
// Interface
interface Point {
  x: number;
  y: number;
}

// Type alias
type Point2D = {
  x: number;
  y: number;
};

// Type alias for union
type Status = "pending" | "approved" | "rejected";

// Extending interface
interface Point3D extends Point {
  z: number;
}

// Intersection type
type ColoredPoint = Point & {
  color: string;
};
```

### Generics

```typescript
// Generic function
function identity<T>(value: T): T {
  return value;
}

// Generic interface
interface Container<T> {
  value: T;
  getValue(): T;
}

// Generic with constraints
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Generic with default
interface Response<T = unknown> {
  data: T;
  status: number;
}
```

### Utility Types

```typescript
// Partial - all properties optional
type PartialUser = Partial<User>;

// Required - all properties required
type RequiredUser = Required<User>;

// Pick - select specific properties
type UserBasic = Pick<User, "id" | "name">;

// Omit - exclude specific properties
type UserWithoutEmail = Omit<User, "email">;

// Record - create object type
type UserRoles = Record<string, string>;

// Exclude/Extract
type Status = "pending" | "approved" | "rejected";
type ApprovedStatus = Extract<Status, "approved">;
type NotPending = Exclude<Status, "pending">;

// ReturnType
type AddResult = ReturnType<typeof add>;  // number

// Parameters
type AddParams = Parameters<typeof add>;  // [number, number]
```

### Advanced Patterns

```typescript
// Discriminated unions
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

// Branded types
type UserId = string & { readonly __brand: "UserId" };
type Email = string & { readonly __brand: "Email" };

function createUserId(id: string): UserId {
  return id as UserId;
}

// Type guards
function isString(value: unknown): value is string {
  return typeof value === "string";
}

// Assertion functions
function assertString(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error("Not a string");
  }
}
```

## tsconfig.json Configuration

### Basic Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Strict Mode Options

```json
{
  "compilerOptions": {
    "strict": true,  // Enables all below
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true
  }
}
```

### Additional Checks

```json
{
  "compilerOptions": {
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

## Common Type Errors and Fixes

### Error: Type 'X' is not assignable to type 'Y'

```typescript
// Problem
let num: number = "5";  // Error

// Fix: Correct the type
let num: number = 5;

// Or parse if from string
let num: number = parseInt("5");
```

### Error: Object is possibly 'null' or 'undefined'

```typescript
// Problem
function greet(name: string | null) {
  return name.toUpperCase();  // Error
}

// Fix 1: Type guard
function greet(name: string | null) {
  if (name === null) return "";
  return name.toUpperCase();
}

// Fix 2: Non-null assertion (use cautiously)
function greet(name: string | null) {
  return name!.toUpperCase();
}

// Fix 3: Optional chaining
function greet(name: string | null) {
  return name?.toUpperCase() ?? "";
}
```

### Error: Property 'X' does not exist on type 'Y'

```typescript
// Problem
const obj: { name: string } = { name: "Alice", age: 30 };  // Error

// Fix: Add property to type
interface Person {
  name: string;
  age: number;
}

const obj: Person = { name: "Alice", age: 30 };
```

### Error: Argument of type 'X' is not assignable to parameter of type 'Y'

```typescript
// Problem
function greet(name: string) {
  console.log(name);
}
greet(123);  // Error

// Fix: Pass correct type
greet("Alice");

// Or convert
greet(String(123));
```

## Integration with Build Tools

### Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})
```

### Webpack

```javascript
// webpack.config.js
module.exports = {
  entry: './src/index.ts',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
};
```

### ESLint

```javascript
// .eslintrc.js
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parserOptions: {
    project: './tsconfig.json',
  },
};
```

## Testing with TypeScript

### Jest

```typescript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
};

// __tests__/user.test.ts
import { createUser } from '../src/user';

describe('User', () => {
  it('creates user with valid data', () => {
    const user = createUser({ name: 'Alice', age: 30 });
    expect(user.name).toBe('Alice');
  });
});
```

### Vitest

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
})

// src/user.test.ts
import { describe, it, expect } from 'vitest';
import { createUser } from './user';

describe('createUser', () => {
  it('creates user', () => {
    const user = createUser({ name: 'Alice' });
    expect(user.name).toBe('Alice');
  });
});
```

## Best Practices

1. **Enable Strict Mode**: Always use `"strict": true` in tsconfig.json
2. **Avoid `any`**: Use `unknown` or proper types instead
3. **Use Type Inference**: Let TypeScript infer types when obvious
4. **Prefer Interfaces for Objects**: Use interfaces for object shapes
5. **Use Readonly**: Mark properties readonly when they shouldn't change
6. **Discriminated Unions**: Use for variant types
7. **Type Guards**: Write type guards for runtime type checking
8. **Utility Types**: Leverage built-in utility types

## Common Workflows

### Migration from JavaScript

```bash
# 1. Rename .js to .ts
find src -name "*.js" -exec sh -c 'mv "$1" "${1%.js}.ts"' _ {} \;

# 2. Add tsconfig.json
tsc --init

# 3. Fix type errors gradually
tsc --noEmit --skipLibCheck

# 4. Enable strict mode incrementally
# Start with noImplicitAny, then add others
```

### Type Declaration Files

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

## Examples

### Example 1: API Response Type

```typescript
interface ApiResponse<T> {
  data: T;
  status: number;
  error?: string;
}

async function fetchUser(id: string): Promise<ApiResponse<User>> {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}

// Usage
const result = await fetchUser("123");
if (result.error) {
  console.error(result.error);
} else {
  console.log(result.data.name);
}
```

### Example 2: Form Validation

```typescript
interface FormData {
  email: string;
  password: string;
}

type ValidationErrors = Partial<Record<keyof FormData, string>>;

function validate(data: FormData): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!data.email.includes("@")) {
    errors.email = "Invalid email";
  }

  if (data.password.length < 8) {
    errors.password = "Password too short";
  }

  return errors;
}
```

### Example 3: State Management

```typescript
type State = {
  user: User | null;
  loading: boolean;
  error: string | null;
};

type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; payload: User }
  | { type: "FETCH_ERROR"; payload: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, loading: true };
    case "FETCH_SUCCESS":
      return { ...state, loading: false, user: action.payload };
    case "FETCH_ERROR":
      return { ...state, loading: false, error: action.payload };
    default:
      return state;
  }
}
```

## When to Ask for Help

Ask the user for clarification when:
- The desired type structure is ambiguous
- Multiple valid typing approaches exist
- Migration from JavaScript needs strategy decisions
- Build tool integration specifics are unclear
- Type error resolution requires code refactoring decisions
