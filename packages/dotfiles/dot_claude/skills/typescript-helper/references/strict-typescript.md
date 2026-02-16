# Strict TypeScript Development

Type-safe development patterns using strict TypeScript and Zod for runtime validation, based on coding standards from scout-for-lol and homelab repositories.

## Core Principles

1. **Use Zod for Runtime Validation**: Prefer Zod schema validation over `typeof`, `instanceof`, or type guards
2. **No Type Assertions**: Avoid type assertions except `as unknown` or `as const`
3. **Strict TypeScript**: Use `strictTypeChecked` and `stylisticTypeChecked` configurations
4. **Type Definitions**: Use `type` instead of `interface` for consistency

## Prefer Zod Over Type Guards

**Avoid: typeof operator**
```typescript
// Don't do this
function processValue(value: unknown) {
  if (typeof value === "string") {
    return value.toUpperCase();
  }
}
```

**Prefer: Zod validation**
```typescript
import { z } from "zod";

function processValue(value: unknown) {
  const result = z.string().safeParse(value);
  if (result.success) {
    return result.data.toUpperCase();
  }
  return null;
}
```

## Replace Common Type Checks with Zod

**Array.isArray() -> Zod**
```typescript
// Avoid
if (Array.isArray(value)) {
  value.forEach(item => console.log(item));
}

// Prefer
const result = z.array(z.string()).safeParse(value);
if (result.success) {
  result.data.forEach(item => console.log(item));
}
```

**instanceof -> Zod**
```typescript
// Avoid
if (err instanceof Error) {
  console.log(err.message);
}

// Prefer
const result = z.instanceof(Error).safeParse(err);
if (result.success) {
  console.log(result.data.message);
}
```

**Number validation -> Zod**
```typescript
// Avoid
if (Number.isInteger(value)) {
  return value * 2;
}

// Prefer
const result = z.number().int().safeParse(value);
if (result.success) {
  return result.data * 2;
}
```

**Type predicates -> Zod**
```typescript
// Avoid type guard functions
function isUser(value: unknown): value is User {
  return typeof value === "object" && value !== null && "email" in value;
}

// Prefer Zod schema validation
const UserSchema = z.object({
  email: z.string().email(),
  name: z.string(),
});

const result = UserSchema.safeParse(value);
if (result.success) {
  const user = result.data; // Type-safe!
}
```

## Type Assertion Rules

### Only Allow 'as unknown' and 'as const'

```typescript
// Never do this - bypasses type safety
const user = data as User;
const id = value as string;

// Cast to unknown first, then validate
const data = response as unknown;
const result = UserSchema.safeParse(data);
if (result.success) {
  const user = result.data;
}

// Use 'as const' for literal types
const STATUSES = ["pending", "approved", "rejected"] as const;
type Status = (typeof STATUSES)[number];
```

### Why No Type Assertions?

Type assertions are dangerous because:
1. They bypass TypeScript's type checking
2. They don't perform runtime validation
3. They can cause runtime crashes with wrong types
4. They hide bugs instead of catching them

Zod provides both compile-time AND runtime safety.

## Use 'type' Instead of 'interface'

```typescript
// Prefer type
type User = {
  id: string;
  email: string;
};

type Admin = User & {
  permissions: string[];
};

// Avoid interface
interface User {
  id: string;
  email: string;
}
```

**Why?** Types are more flexible (unions, intersections) and consistent with Zod's inferred types.

## Strict tsconfig.json

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

## Best Practices

1. **Define schemas early**: Create Zod schemas alongside types
2. **Single source of truth**: Use `z.infer<typeof Schema>` for types
3. **Validate at boundaries**: API responses, user input, external data
4. **Fail fast**: Use `parse()` for config, `safeParse()` for runtime data
5. **Compose schemas**: Build complex schemas from simple reusable parts
