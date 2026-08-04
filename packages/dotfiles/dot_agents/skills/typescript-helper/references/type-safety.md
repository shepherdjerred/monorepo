# TypeScript type safety

Read this when designing domain types, narrowing unknown values, using generics, or reviewing assertion-heavy code.

## Boundaries

TypeScript types disappear at runtime. Parse HTTP, JSON, database, cache, environment, file, and message-queue data before assigning a domain type.

Use `unknown` for untrusted values and narrow it with control flow or a schema. `any` disables the checking you need most at a boundary.

## Narrowing

Useful built-in guards include:

- `typeof` for primitives,
- `instanceof` for runtime classes,
- `Array.isArray` for arrays,
- equality and truthiness when those states are semantically valid,
- discriminant properties for unions,
- property checks for object shapes.

Use an exhaustive `never` branch for closed discriminated unions. Avoid a default that returns existing state, because it hides newly introduced variants.

## Generics

A generic parameter should relate multiple values or preserve a relationship through the return type. Prefer inference when it stays clear. A generic used once is often a constraint that should be an ordinary type.

Conditional types distribute over unions unless the checked type is wrapped. `infer` extracts a related component. `NoInfer<T>` prevents an input from contributing to inference without otherwise changing `T`.

## Object types

- `readonly` is shallow compile-time assignment protection, not runtime freezing.
- Interfaces can reopen and merge; aliases can represent unions, primitives, tuples, and composed types.
- Use primitive lowercase types rather than boxed object types.
- Optional callback parameters mean the implementation may omit an argument when invoking the callback.

## Assertions

An `as` cast, non-null assertion, or assertion-style branded constructor does not validate anything. Prefer a schema that returns the validated domain value, or redesign the API so the type follows from control flow.
