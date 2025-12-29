---
description: Zod schema validation - composable schemas, type inference, transforms, refinements, and error handling patterns
when_to_use: When user works with Zod, validates data, creates schemas, handles form validation, or mentions z.object/z.string patterns
---

# Zod Patterns Agent

## What's New in Zod 4 (2025)

- **Performance**: `z.array()` 7.4x faster, `z.object()` 6.5x faster (compared to Zod v3)
- **Zod Mini**: Tree-shakable functional API variant
- **Metadata API**: Attach custom metadata to schemas
- **JSON Schema**: Built-in JSON Schema generation
- **Locales**: Built-in i18n support for error messages
- **`z.looseObject()`**: Replaces `.passthrough()`
- **`z.strictObject()`**: Replaces `.strict()`

## Installation

```bash
# npm/yarn/pnpm
npm install zod

# Bun
bun add zod
```

Requires TypeScript 5.5+ with `"strict": true` in tsconfig.

## Basic Usage

### Defining and Parsing

```typescript
import { z } from "zod";

// Define a schema
const UserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().positive(),
});

// Parse data (throws on invalid)
const user = UserSchema.parse({
  name: "Alice",
  email: "alice@example.com",
  age: 25,
});

// Safe parse (returns result object)
const result = UserSchema.safeParse(data);
if (result.success) {
  console.log(result.data); // typed as User
} else {
  console.log(result.error.issues); // validation errors
}
```

### Type Inference

```typescript
// Infer TypeScript type from schema
type User = z.infer<typeof UserSchema>;
// { name: string; email: string; age: number }

// For schemas with transforms - input vs output types
type UserInput = z.input<typeof UserSchema>;
type UserOutput = z.output<typeof UserSchema>;
```

## Primitive Types

### Strings

```typescript
z.string()                    // any string
z.string().min(1)             // non-empty
z.string().max(100)           // max length
z.string().length(5)          // exact length
z.string().email()            // email format
z.string().url()              // URL format
z.string().uuid()             // UUID format
z.string().cuid()             // CUID format
z.string().cuid2()            // CUID2 format
z.string().ulid()             // ULID format
z.string().regex(/^[a-z]+$/)  // custom regex
z.string().includes("@")      // contains substring
z.string().startsWith("http") // starts with
z.string().endsWith(".com")   // ends with
z.string().datetime()         // ISO datetime
z.string().date()             // ISO date
z.string().time()             // ISO time
z.string().ip()               // IP address
z.string().trim()             // trim whitespace (transform)
z.string().toLowerCase()      // lowercase (transform)
z.string().toUpperCase()      // uppercase (transform)
```

### Numbers

```typescript
z.number()                    // any number
z.number().int()              // integer only
z.number().positive()         // > 0
z.number().nonnegative()      // >= 0
z.number().negative()         // < 0
z.number().nonpositive()      // <= 0
z.number().min(5)             // >= 5
z.number().max(100)           // <= 100
z.number().gt(5)              // > 5
z.number().gte(5)             // >= 5 (alias for min)
z.number().lt(100)            // < 100
z.number().lte(100)           // <= 100 (alias for max)
z.number().multipleOf(5)      // divisible by 5
z.number().finite()           // not Infinity
z.number().safe()             // within safe integer range
```

### Other Primitives

```typescript
z.boolean()                   // true or false
z.bigint()                    // BigInt values
z.date()                      // Date objects
z.undefined()                 // undefined only
z.null()                      // null only
z.void()                      // undefined (for function returns)
z.any()                       // bypass validation
z.unknown()                   // any, but type-safe usage
z.never()                     // always fails
```

## Coercion

Automatically convert input types before validation:

```typescript
// String coercion
z.coerce.string()   // String(input)
z.coerce.number()   // Number(input)
z.coerce.boolean()  // Boolean(input)
z.coerce.bigint()   // BigInt(input)
z.coerce.date()     // new Date(input)

// With validation
const ageSchema = z.coerce.number().int().positive();
ageSchema.parse("25"); // 25
ageSchema.parse("abc"); // throws - NaN is not positive

// Common pitfall: empty string becomes 0
z.coerce.number().parse(""); // 0 (might not be desired)

// Fix: preprocess to handle empty strings
const safeNumber = z.preprocess(
  (val) => (val === "" ? undefined : val),
  z.coerce.number()
);
```

## Objects

### Basic Objects

```typescript
const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email().optional(),
});

// By default, unknown keys are stripped
PersonSchema.parse({ name: "Bob", age: 30, extra: "ignored" });
// { name: "Bob", age: 30 }
```

### Object Modes (Zod 4)

```typescript
// Standard - strips unknown keys
z.object({ name: z.string() })

// Loose - passes through unknown keys
z.looseObject({ name: z.string() })

// Strict - rejects unknown keys
z.strictObject({ name: z.string() })
```

### Object Manipulation

```typescript
const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  password: z.string(),
  createdAt: z.date(),
});

// Pick specific fields
const PublicUser = UserSchema.pick({ id: true, name: true, email: true });

// Omit sensitive fields
const SafeUser = UserSchema.omit({ password: true });

// Make all fields optional
const PartialUser = UserSchema.partial();

// Make specific fields optional
const UpdateUser = UserSchema.partial({ name: true, email: true });

// Make all fields required
const RequiredUser = UserSchema.required();

// Extend with additional fields
const AdminSchema = UserSchema.extend({
  role: z.literal("admin"),
  permissions: z.array(z.string()),
});

// Merge schemas (Zod 4 - use extend instead)
const Combined = BaseSchema.extend(ExtraSchema.shape);
```

### Nested Objects

```typescript
const AddressSchema = z.object({
  street: z.string(),
  city: z.string(),
  country: z.string(),
  zip: z.string().optional(),
});

const CompanySchema = z.object({
  name: z.string(),
  address: AddressSchema,
  employees: z.array(z.object({
    name: z.string(),
    department: z.string(),
  })),
});
```

## Arrays and Collections

### Arrays

```typescript
z.array(z.string())              // string[]
z.array(z.string()).min(1)       // at least 1 element
z.array(z.string()).max(10)      // at most 10 elements
z.array(z.string()).length(5)    // exactly 5 elements
z.array(z.string()).nonempty()   // same as .min(1)

// Access element schema
const arr = z.array(z.string());
arr.element; // z.string()
```

### Tuples

```typescript
// Fixed-length array with specific types
const PointSchema = z.tuple([z.number(), z.number()]);
type Point = z.infer<typeof PointSchema>; // [number, number]

// With rest elements
const ArgsSchema = z.tuple([z.string(), z.number()]).rest(z.boolean());
// [string, number, ...boolean[]]
```

### Records and Maps

```typescript
// Record<string, T>
z.record(z.string(), z.number())     // { [key: string]: number }
z.record(z.number())                 // shorthand for string keys

// Map<K, V>
z.map(z.string(), z.number())        // Map<string, number>

// Set<T>
z.set(z.string())                    // Set<string>
z.set(z.number()).min(1).max(10)     // with size constraints
```

## Unions and Enums

### Unions

```typescript
// Basic union
const StringOrNumber = z.union([z.string(), z.number()]);
type SN = z.infer<typeof StringOrNumber>; // string | number

// Shorthand
const StringOrNumber2 = z.string().or(z.number());
```

### Discriminated Unions

```typescript
// More efficient parsing with discriminator key
const ResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    data: z.object({ id: z.string() }),
  }),
  z.object({
    status: z.literal("error"),
    message: z.string(),
  }),
]);

type Result = z.infer<typeof ResultSchema>;
// { status: "success"; data: { id: string } } | { status: "error"; message: string }

// TypeScript narrows based on discriminator
const result = ResultSchema.parse(data);
if (result.status === "success") {
  console.log(result.data.id); // typed correctly
}
```

### Enums

```typescript
// Zod enum (recommended)
const StatusSchema = z.enum(["pending", "active", "inactive"]);
type Status = z.infer<typeof StatusSchema>; // "pending" | "active" | "inactive"

// Access values
StatusSchema.options; // ["pending", "active", "inactive"]
StatusSchema.enum;    // { pending: "pending", active: "active", ... }

// Extract or exclude values
StatusSchema.extract(["pending", "active"]); // only these
StatusSchema.exclude(["inactive"]);          // all except these

// Native enum
enum NativeStatus { Pending, Active, Inactive }
const NativeStatusSchema = z.nativeEnum(NativeStatus);
```

### Literals

```typescript
z.literal("hello")        // exactly "hello"
z.literal(42)             // exactly 42
z.literal(true)           // exactly true
z.null()                  // exactly null
z.undefined()             // exactly undefined
```

## Optional, Nullable, Default

```typescript
// Optional - allows undefined
z.string().optional()     // string | undefined

// Nullable - allows null
z.string().nullable()     // string | null

// Nullish - allows null or undefined
z.string().nullish()      // string | null | undefined

// Default values
z.string().default("N/A")                    // static default
z.number().default(() => Math.random())      // dynamic default
z.date().default(() => new Date())           // current date

// Catch - use default on any parse error
z.number().catch(0)                          // returns 0 on error
z.string().catch((ctx) => `Error: ${ctx.error.message}`)

// Unwrap optional/nullable
const optStr = z.string().optional();
optStr.unwrap(); // z.string()
```

## Refinements and Transforms

### Refinements (Custom Validation)

```typescript
// Basic refine
const PasswordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .refine(
    (val) => /[A-Z]/.test(val),
    "Password must contain uppercase letter"
  )
  .refine(
    (val) => /[0-9]/.test(val),
    "Password must contain number"
  );

// With custom error path
const FormSchema = z.object({
  password: z.string(),
  confirmPassword: z.string(),
}).refine(
  (data) => data.password === data.confirmPassword,
  {
    message: "Passwords don't match",
    path: ["confirmPassword"], // error appears on this field
  }
);
```

### SuperRefine (Multiple Issues)

```typescript
const ComplexSchema = z.string().superRefine((val, ctx) => {
  if (val.length < 8) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 8,
      type: "string",
      inclusive: true,
      message: "Too short",
    });
  }
  if (!/[A-Z]/.test(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Missing uppercase",
    });
  }
});
```

### Transforms

```typescript
// Transform output type
const TrimmedString = z.string().transform((val) => val.trim());

const NumberFromString = z.string()
  .transform((val) => parseInt(val, 10))
  .pipe(z.number().int());

const DateFromISO = z.string()
  .datetime()
  .transform((val) => new Date(val));

// Transform with validation
const PositiveFromString = z.string()
  .transform((val, ctx) => {
    const num = parseInt(val, 10);
    if (isNaN(num)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Not a number",
      });
      return z.NEVER;
    }
    return num;
  })
  .pipe(z.number().positive());
```

### Preprocess

```typescript
// Transform BEFORE parsing
const TrimmedEmail = z.preprocess(
  (val) => (typeof val === "string" ? val.trim().toLowerCase() : val),
  z.string().email()
);

// Handle empty strings
const OptionalNumber = z.preprocess(
  (val) => (val === "" ? undefined : val),
  z.coerce.number().optional()
);
```

### Pipe (Chaining Schemas)

```typescript
// Chain multiple schemas
const ParsedInt = z.string()
  .transform((val) => parseInt(val, 10))
  .pipe(z.number().int().positive());

// With intermediate validation
const EmailDomain = z.string()
  .email()
  .pipe(z.string().endsWith("@company.com"));
```

## Error Handling

### Custom Error Messages

```typescript
// Per-validator messages
z.string().min(5, "Must be at least 5 characters");
z.string().min(5, { message: "Too short" });

// Schema-level errors
z.string("Expected a string");
z.string({
  error: (issue) => issue.input === undefined
    ? "Field is required"
    : "Must be a string",
});
```

### Parsing Errors

```typescript
const result = UserSchema.safeParse(input);

if (!result.success) {
  // Formatted errors
  const formatted = result.error.format();
  // { name: { _errors: ["Required"] }, email: { _errors: ["Invalid email"] } }

  // Flattened errors
  const flat = result.error.flatten();
  // { formErrors: [], fieldErrors: { name: ["Required"], email: ["Invalid email"] } }

  // Raw issues
  result.error.issues.forEach((issue) => {
    console.log(issue.path, issue.message, issue.code);
  });
}
```

### Error Maps

```typescript
// Per-parse error customization
schema.parse(data, {
  error: (issue) => `Custom error: ${issue.code}`,
});

// Global configuration
z.config({
  customError: (issue) => {
    if (issue.code === "invalid_type") {
      return `Expected ${issue.expected}, got ${issue.received}`;
    }
    return issue.message;
  },
});

// Localization
import { en } from "zod/v4/locales/en";
z.config(en());
```

## Advanced Patterns

### Branded Types

```typescript
const UserId = z.string().uuid().brand<"UserId">();
const PostId = z.string().uuid().brand<"PostId">();

type UserId = z.infer<typeof UserId>;
type PostId = z.infer<typeof PostId>;

function getUser(id: UserId) { /* ... */ }

const userId = UserId.parse("550e8400-e29b-41d4-a716-446655440000");
const postId = PostId.parse("550e8400-e29b-41d4-a716-446655440000");

getUser(userId); // OK
getUser(postId); // Type error!
```

### Recursive Types

```typescript
interface Category {
  name: string;
  subcategories: Category[];
}

const CategorySchema: z.ZodType<Category> = z.lazy(() =>
  z.object({
    name: z.string(),
    subcategories: z.array(CategorySchema),
  })
);
```

### JSON Type

```typescript
// Generic JSON value
const JsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(JsonValue),
  ])
);
```

### Function Schemas

```typescript
const FnSchema = z.function()
  .args(z.string(), z.number())
  .returns(z.boolean());

type Fn = z.infer<typeof FnSchema>;
// (args_0: string, args_1: number) => boolean

const validated = FnSchema.implement((name, age) => {
  return age > 18;
});
```

### Async Validation

```typescript
const UniqueEmailSchema = z.string()
  .email()
  .refine(
    async (email) => {
      const exists = await checkEmailExists(email);
      return !exists;
    },
    "Email already taken"
  );

// Must use async parse
const result = await UniqueEmailSchema.safeParseAsync("test@example.com");
```

## Integration Patterns

### Form Validation

```typescript
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

const FormSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "At least 8 characters"),
});

function MyForm() {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(FormSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("email")} />
      {errors.email && <span>{errors.email.message}</span>}
      {/* ... */}
    </form>
  );
}
```

### API Validation

```typescript
// Hono example
import { zValidator } from "@hono/zod-validator";

const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

app.post(
  "/users",
  zValidator("json", CreateUserSchema),
  async (c) => {
    const data = c.req.valid("json");
    // data is fully typed
  }
);
```

### Environment Variables

```typescript
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_KEY: z.string().min(1),
});

export const env = EnvSchema.parse(process.env);
```

## Best Practices Summary

1. **Use `safeParse()`** - avoid throwing in production code
2. **Infer types** - let Zod generate TypeScript types
3. **Compose schemas** - use `extend`, `pick`, `omit` for reuse
4. **Prefer coercion** over preprocess for type conversion
5. **Add custom messages** - improve user-facing errors
6. **Use discriminated unions** - for efficient tagged unions
7. **Brand sensitive types** - prevent accidental ID swapping
8. **Validate at boundaries** - API inputs, env vars, external data
9. **Use transforms sparingly** - keep schemas focused on validation
10. **Test edge cases** - empty strings, null, undefined

## When to Ask for Help

- Complex recursive schema patterns
- Performance optimization for high-throughput validation
- Integration with specific ORMs or frameworks
- Migration from other validation libraries
- Custom error formatting requirements
- Schema generation from external sources
