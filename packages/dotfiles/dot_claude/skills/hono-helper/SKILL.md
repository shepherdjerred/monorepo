---
name: hono-helper
description: "Hono web framework expert — define route handlers with chained methods, validate requests with zValidator and Zod schemas, set up type-safe RPC clients with hc, configure middleware stacks, generate OpenAPI specs from Zod schemas, and deploy to Workers/Deno/Bun/Node.js runtimes"
---

# Hono Helper

## When to Use

Activate when building APIs with Hono, setting up Zod validation, configuring RPC clients, creating middleware, generating OpenAPI specs, or deploying to edge runtimes.

## Runtime Setup

### Bun (default export auto-serves on port 3000)

```typescript
import { Hono } from "hono";
const app = new Hono();
app.get("/", (c) => c.text("Hello Hono!"));
export default app;
```

### Node.js (requires @hono/node-server)

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
const app = new Hono();
serve({ fetch: app.fetch, port: 3000 });
```

### Cloudflare Workers

```typescript
import { Hono } from "hono";
const app = new Hono();
export default app; // Workers runtime picks up the fetch handler
```

## Hono-Specific Patterns

### Chained Route Definitions (enables RPC type inference)

```typescript
// IMPORTANT: chain routes on a single app instance for RPC type export
const app = new Hono()
  .get("/users", (c) => c.json({ users: [] }))
  .post("/users", zValidator("json", CreateUserSchema), (c) => {
    const data = c.req.valid("json");
    return c.json({ id: 1, ...data }, 201);
  })
  .get("/users/:id", (c) => {
    return c.json({ id: c.req.param("id"), name: "John" });
  });

export type AppType = typeof app; // Required for RPC client
export default app;
```

### Route Grouping with .route()

```typescript
const users = new Hono()
  .get("/", (c) => c.json({ users: [] }))
  .post("/", zValidator("json", schema), (c) => c.json(c.req.valid("json"), 201));

const app = new Hono();
app.route("/api/v1/users", users);
```

### Context Variables (typed shared state)

```typescript
type Env = { Variables: { userId: string; requestTime: number } };

const app = new Hono<Env>();
app.use(async (c, next) => {
  c.set("userId", "user-123");
  await next();
});
app.get("/me", (c) => c.json({ userId: c.get("userId") }));
```

## Zod Validation with zValidator

```bash
bun add @hono/zod-validator zod
```

### Validation Targets

```typescript
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

// Validate multiple targets on a single route
app.get(
  "/users/:id",
  zValidator("param", z.object({ id: z.string().uuid() })),
  zValidator("query", z.object({ page: z.coerce.number().default(1) })),
  (c) => {
    const { id } = c.req.valid("param");
    const { page } = c.req.valid("query");
    return c.json({ id, page });
  },
);

// Available targets: "json", "query", "param", "form", "header", "cookie"
```

### Custom Validation Error Response

```typescript
app.post(
  "/users",
  zValidator("json", CreateUserSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "Validation failed", issues: result.error.issues }, 400);
    }
  }),
  (c) => c.json({ created: c.req.valid("json") }),
);
```

## RPC Client (End-to-End Type Safety)

```typescript
import { hc } from "hono/client";
import type { AppType } from "./server";

const client = hc<AppType>("http://localhost:3000");

// Fully typed — params, body, and response inferred from server routes
const res = await client.users.$get();
const data = await res.json(); // typed as { users: [] }

const created = await client.users.$post({ json: { name: "John" } });
const user = await client.users[":id"].$get({ param: { id: "1" } });
```

## Error Handling

```typescript
import { HTTPException } from "hono/http-exception";

// Throw typed HTTP errors anywhere in handlers
throw new HTTPException(401, { message: "Unauthorized" });

// Global error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  return c.json({ error: "Internal Server Error" }, 500);
});

// Custom 404
app.notFound((c) => c.json({ error: "Not Found", path: c.req.path }, 404));
```

## Workflow: Build a New Hono API

### Step 1: Scaffold and install

```bash
bun add hono @hono/zod-validator zod
# For OpenAPI: bun add @hono/zod-openapi
```

### Step 2: Define schemas first

```typescript
import { z } from "zod";
export const CreateItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
export type CreateItem = z.infer<typeof CreateItemSchema>;
```

### Step 3: Build routes with chained methods + validation

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { CreateItemSchema } from "./schemas";

const app = new Hono()
  .get("/items", (c) => c.json({ items: [] }))
  .post("/items", zValidator("json", CreateItemSchema), (c) => {
    const data = c.req.valid("json");
    return c.json({ id: crypto.randomUUID(), ...data }, 201);
  });

export type AppType = typeof app;
export default app;
```

**Checkpoint:** Run `bun run --hot src/index.ts` and test with `curl`.

### Step 4: Add middleware stack

```typescript
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

app.use(logger());
app.use(cors({ origin: ["https://example.com"], credentials: true }));
app.use(secureHeaders());
```

**Checkpoint:** Verify headers in response with `curl -v`.

### Step 5: Add error handling + tests

```typescript
// See references/testing.md for full test patterns
const res = await app.request("/items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Test" }),
});
expect(res.status).toBe(201);
```

**Checkpoint:** Run `bun test` — all routes return expected status codes.

### Step 6: Export RPC client type and wire up frontend

```typescript
// Client-side — fully typed from the server definition
import { hc } from "hono/client";
import type { AppType } from "./server";
const api = hc<AppType>("http://localhost:3000");
```

## Reference Files

- `references/middleware-patterns.md` — Built-in middleware catalog, factory pattern, auth patterns, static files
- `references/openapi-rpc.md` — OpenAPI route definitions with @hono/zod-openapi, Swagger UI setup
- `references/testing.md` — app.request() testing, testClient typed testing patterns

## Key Hono Conventions

1. **Chain routes** on a single `Hono()` instance for RPC type export
2. **Always export `AppType`** (`typeof app`) for end-to-end type safety
3. **Use `zValidator`** for all input validation — never parse manually
4. **Use `createMiddleware` from `hono/factory`** for reusable typed middleware
5. **Use `HTTPException`** for error control flow — never return error responses directly from middleware
6. **Pick the right `serveStatic` import** for your runtime (`hono/bun`, `hono/cloudflare-workers`, etc.)
