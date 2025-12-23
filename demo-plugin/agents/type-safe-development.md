---
description: Type-safe development with Zod validation and strict TypeScript
when_to_use: When user writes TypeScript code, encounters type errors, or needs runtime validation
---

# Type-Safe Development Agent

## Overview

This agent teaches strict type-safe development patterns using TypeScript strict mode and Zod for runtime validation, based on coding standards from scout-for-lol and homelab repositories.

## Core Principles

1. **Use Zod for Runtime Validation**: Prefer Zod schema validation over `typeof`, `instanceof`, or type guards
2. **No Type Assertions**: Avoid type assertions except `as unknown` or `as const`
3. **Strict TypeScript**: Use `strictTypeChecked` and `stylisticTypeChecked` configurations
4. **Type Definitions**: Use `type` instead of `interface` for consistency

## Zod Validation Patterns

### Prefer Zod Over Type Guards

**❌ Avoid: typeof operator**
```typescript
// Don't do this
function processValue(value: unknown) {
  if (typeof value === "string") {
    return value.toUpperCase();
  }
}
```

**✅ Prefer: Zod validation**
```typescript
import { z } from "zod";

function processValue(value: unknown) {
  const result = z.string().safeParse(value);
  if (result.success) {
    return result.data.toUpperCase();
  }
  // Handle validation failure
  return null;
}
```

### Zod Schema Naming Convention

**All Zod schemas must end with `Schema` suffix:**

```typescript
// ✅ Correct naming
const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
});

type User = z.infer<typeof UserSchema>;

// ❌ Wrong - missing Schema suffix
const User = z.object({
  id: z.string(),
  email: z.string().email(),
});
```

### safeParse vs parse

**Use `safeParse` for most cases:**
```typescript
// ✅ Good - returns result object with .success
const result = UserSchema.safeParse(data);
if (result.success) {
  const user = result.data; // Type-safe access
  console.log(user.email);
} else {
  console.error("Validation failed:", result.error);
}
```

**Use `parse` only when you want to throw:**
```typescript
// Use only for config validation or when failure should crash
const config = ConfigSchema.parse(process.env);
```

### Replace Common Type Checks

**Array.isArray() → Zod**
```typescript
// ❌ Avoid
if (Array.isArray(value)) {
  value.forEach(item => console.log(item));
}

// ✅ Prefer
const result = z.array(z.string()).safeParse(value);
if (result.success) {
  result.data.forEach(item => console.log(item));
}
```

**instanceof → Zod**
```typescript
// ❌ Avoid
if (err instanceof Error) {
  console.log(err.message);
}

// ✅ Prefer
const result = z.instanceof(Error).safeParse(err);
if (result.success) {
  console.log(result.data.message);
}
```

**Number validation → Zod**
```typescript
// ❌ Avoid
if (Number.isInteger(value)) {
  return value * 2;
}

// ✅ Prefer
const result = z.number().int().safeParse(value);
if (result.success) {
  return result.data * 2;
}
```

**Type predicates → Zod**
```typescript
// ❌ Avoid type guard functions
function isUser(value: unknown): value is User {
  return typeof value === "object" && value !== null && "email" in value;
}

// ✅ Prefer Zod schema validation
const UserSchema = z.object({
  email: z.string().email(),
  name: z.string(),
});

const result = UserSchema.safeParse(value);
if (result.success) {
  const user = result.data; // Type-safe!
}
```

## Type Assertions Rules

### Only Allow 'as unknown' and 'as const'

```typescript
// ❌ Never do this - bypasses type safety
const user = data as User;
const id = value as string;

// ✅ Cast to unknown first, then validate
const data = response as unknown;
const result = UserSchema.safeParse(data);
if (result.success) {
  const user = result.data;
}

// ✅ Use 'as const' for literal types
const STATUSES = ["pending", "approved", "rejected"] as const;
type Status = (typeof STATUSES)[number];
```

### Why No Type Assertions?

Type assertions are dangerous because:
1. They bypass TypeScript's type checking
2. They don't perform runtime validation
3. They can cause runtime crashes with wrong types
4. They hide bugs instead of catching them

**Zod gives you both compile-time AND runtime safety!**

## TypeScript Configuration

### tsconfig.json Best Practices

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

### Use 'type' Instead of 'interface'

```typescript
// ✅ Prefer type
type User = {
  id: string;
  email: string;
};

type Admin = User & {
  permissions: string[];
};

// ❌ Avoid interface
interface User {
  id: string;
  email: string;
}
```

**Why?** Types are more flexible (unions, intersections) and consistent with Zod's inferred types.

## Advanced Zod Patterns

### Discriminated Unions

```typescript
const EventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_created"),
    userId: z.string(),
    email: z.string().email(),
  }),
  z.object({
    type: z.literal("user_deleted"),
    userId: z.string(),
  }),
]);

type Event = z.infer<typeof EventSchema>;

// Type-safe handling
function handleEvent(event: Event) {
  switch (event.type) {
    case "user_created":
      console.log(event.email); // TypeScript knows email exists
      break;
    case "user_deleted":
      console.log(event.userId); // No email here
      break;
  }
}
```

### Transform and Refine

```typescript
// Transform values during parsing
const DateSchema = z.string().transform((str) => new Date(str));

// Add custom validation
const PasswordSchema = z.string().min(8).refine(
  (password) => /[A-Z]/.test(password),
  { message: "Password must contain uppercase letter" }
);

// Combine both
const UserInputSchema = z.object({
  email: z.string().email().toLowerCase(), // transform to lowercase
  createdAt: z.string().transform((str) => new Date(str)),
  age: z.number().int().positive().max(150),
});
```

### Reusable Schema Components

```typescript
// Define reusable parts
const EmailSchema = z.string().email();
const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime();

// Compose into larger schemas
const UserSchema = z.object({
  id: UuidSchema,
  email: EmailSchema,
  createdAt: TimestampSchema,
});

const TeamSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1),
  members: z.array(UserSchema),
});
```

## Common Patterns

### API Response Validation

```typescript
const ApiResponseSchema = z.object({
  data: UserSchema,
  status: z.number().int(),
  message: z.string().optional(),
});

async function fetchUser(id: string) {
  const response = await fetch(`/api/users/${id}`);
  const json = await response.json() as unknown;

  const result = ApiResponseSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid API response: ${result.error.message}`);
  }

  return result.data;
}
```

### Form Validation

```typescript
const FormDataSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type FormData = z.infer<typeof FormDataSchema>;

function validateForm(data: unknown) {
  const result = FormDataSchema.safeParse(data);
  if (!result.success) {
    return {
      errors: result.error.flatten().fieldErrors,
    };
  }
  return { data: result.data };
}
```

### Environment Variables

```typescript
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]),
});

// Parse once at startup - throw if invalid
const env = EnvSchema.parse(process.env);

// Now env is fully typed!
console.log(env.PORT); // number
console.log(env.DATABASE_URL); // string
```

## Best Practices

1. **Define schemas early**: Create Zod schemas alongside types
2. **Single source of truth**: Use `z.infer<typeof Schema>` for types
3. **Validate at boundaries**: API responses, user input, external data
4. **Fail fast**: Use `parse()` for config, `safeParse()` for runtime data
5. **Compose schemas**: Build complex schemas from simple reusable parts
6. **Document schemas**: Schemas serve as living documentation
7. **Test schemas**: Write tests for edge cases in your schemas

## When to Ask for Help

Ask the user for clarification when:
- The data structure is complex or ambiguous
- Validation requirements are unclear
- Performance is critical (Zod has overhead)
- The type safety strategy conflicts with library requirements
- Migration from existing type guards is extensive
