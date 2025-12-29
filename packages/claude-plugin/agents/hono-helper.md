---
description: Hono web framework for edge-first, lightweight APIs - routing, middleware, validation, and multi-runtime support
when_to_use: When user works with Hono, builds APIs, creates middleware, uses Zod validation with Hono, or mentions hono patterns
---

# Hono Helper Agent

## What's New in Hono (2024-2025)

- **Multi-runtime**: Runs on Bun, Node.js, Deno, Cloudflare Workers, AWS Lambda, Vercel
- **RPC mode**: End-to-end type safety with `hc` client
- **Zod OpenAPI**: Generate OpenAPI specs from Zod schemas
- **Streaming**: First-class streaming response support
- **JSX middleware**: Server-side JSX rendering
- **Performance**: One of the fastest web frameworks (Bun benchmark leader)

## Installation

```bash
# For Bun
bun add hono

# For Node.js
npm install hono @hono/node-server

# For Cloudflare Workers
npm install hono
```

## Basic Application

### Bun Setup

```typescript
import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.text("Hello Hono!"));

export default app;
```

Bun automatically serves the default export on port 3000.

### Node.js Setup

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/", (c) => c.text("Hello Hono!"));

serve({ fetch: app.fetch, port: 3000 });
```

## Routing

### HTTP Methods

```typescript
app.get("/users", (c) => c.json({ users: [] }));
app.post("/users", (c) => c.json({ created: true }));
app.put("/users/:id", (c) => c.json({ updated: true }));
app.patch("/users/:id", (c) => c.json({ patched: true }));
app.delete("/users/:id", (c) => c.json({ deleted: true }));

// All methods
app.all("/any", (c) => c.text("Any method"));

// Multiple methods
app.on(["GET", "POST"], "/multi", (c) => c.text("GET or POST"));
```

### Path Parameters

```typescript
// Single parameter
app.get("/users/:id", (c) => {
  const id = c.req.param("id");
  return c.json({ id });
});

// Multiple parameters
app.get("/posts/:postId/comments/:commentId", (c) => {
  const { postId, commentId } = c.req.param();
  return c.json({ postId, commentId });
});

// Optional parameter
app.get("/articles/:id?", (c) => {
  const id = c.req.param("id") ?? "default";
  return c.json({ id });
});
```

### Wildcards and Regex

```typescript
// Wildcard - matches any path segment
app.get("/files/*", (c) => {
  const path = c.req.path;
  return c.text(`File path: ${path}`);
});

// Regex constraint
app.get("/users/:id{[0-9]+}", (c) => {
  const id = c.req.param("id"); // Guaranteed to be numeric
  return c.json({ id: Number(id) });
});
```

### Route Grouping

```typescript
const api = new Hono();

api.get("/users", (c) => c.json({ users: [] }));
api.get("/posts", (c) => c.json({ posts: [] }));

const app = new Hono();
app.route("/api/v1", api);

// Routes: GET /api/v1/users, GET /api/v1/posts
```

### Chained Routes

```typescript
app
  .get("/endpoint", (c) => c.text("GET"))
  .post((c) => c.text("POST"))
  .put((c) => c.text("PUT"));
```

## Context API

The `c` (context) object provides request/response utilities:

### Request Access

```typescript
app.get("/info", (c) => {
  // URL and path
  const url = c.req.url;
  const path = c.req.path;
  const method = c.req.method;

  // Query parameters
  const page = c.req.query("page");
  const allQueries = c.req.queries("tag"); // Array for repeated params

  // Headers
  const auth = c.req.header("Authorization");
  const allHeaders = c.req.header(); // All headers

  return c.json({ url, path, method, page, auth });
});
```

### Body Parsing

```typescript
app.post("/data", async (c) => {
  // JSON body
  const json = await c.req.json();

  // Form data
  const form = await c.req.parseBody();

  // Raw text
  const text = await c.req.text();

  // Array buffer
  const buffer = await c.req.arrayBuffer();

  return c.json({ received: true });
});
```

### Response Methods

```typescript
// Text response
app.get("/text", (c) => c.text("Plain text"));

// JSON response
app.get("/json", (c) => c.json({ message: "Hello" }));

// HTML response
app.get("/html", (c) => c.html("<h1>Hello</h1>"));

// Custom status
app.get("/created", (c) => c.json({ id: 1 }, 201));

// Redirect
app.get("/old", (c) => c.redirect("/new"));
app.get("/permanent", (c) => c.redirect("/new", 301));

// Not found
app.get("/missing", (c) => c.notFound());

// Stream response
app.get("/stream", (c) => {
  return c.streamText(async (stream) => {
    await stream.write("Hello ");
    await stream.write("World!");
  });
});
```

### Headers and Status

```typescript
app.get("/custom", (c) => {
  // Set response headers
  c.header("X-Custom-Header", "value");
  c.header("Cache-Control", "max-age=3600");

  // Set status
  c.status(201);

  return c.json({ created: true });
});

// Response with headers inline
app.get("/inline", (c) => {
  return c.json(
    { data: "value" },
    200,
    { "X-Custom": "header" }
  );
});
```

### Context Variables

```typescript
// Set variables for downstream handlers
app.use(async (c, next) => {
  c.set("userId", "user-123");
  c.set("requestTime", Date.now());
  await next();
});

app.get("/profile", (c) => {
  const userId = c.get("userId");
  const requestTime = c.get("requestTime");
  return c.json({ userId, requestTime });
});
```

## Middleware

### Inline Middleware

```typescript
app.use(async (c, next) => {
  console.log(`${c.req.method} ${c.req.path}`);
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  c.header("X-Response-Time", `${ms}ms`);
});
```

### Path-Specific Middleware

```typescript
// Apply to specific path
app.use("/api/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

// Apply to specific method
app.use("/admin/*", "POST", async (c, next) => {
  // Only runs for POST requests to /admin/*
  await next();
});
```

### Middleware Factory Pattern

```typescript
const rateLimiter = (limit: number) => {
  const requests = new Map<string, number>();

  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for") ?? "unknown";
    const count = requests.get(ip) ?? 0;

    if (count >= limit) {
      return c.json({ error: "Rate limited" }, 429);
    }

    requests.set(ip, count + 1);
    await next();
  };
};

app.use(rateLimiter(100));
```

### Built-in Middleware

```typescript
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { basicAuth } from "hono/basic-auth";
import { bearerAuth } from "hono/bearer-auth";
import { csrf } from "hono/csrf";
import { timing } from "hono/timing";

// CORS
app.use(cors({
  origin: ["https://example.com"],
  allowMethods: ["GET", "POST", "PUT", "DELETE"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

// Logging
app.use(logger());

// Security headers
app.use(secureHeaders());

// Compression
app.use(compress());

// ETag caching
app.use(etag());

// Basic auth
app.use("/admin/*", basicAuth({
  username: "admin",
  password: "secret",
}));

// Bearer token auth
app.use("/api/*", bearerAuth({
  token: "my-secret-token",
}));

// CSRF protection
app.use(csrf());

// Server timing
app.use(timing());
```

## Validation with Zod

### Setup

```bash
bun add @hono/zod-validator zod
```

### Request Validation

```typescript
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});

app.post(
  "/users",
  zValidator("json", CreateUserSchema),
  (c) => {
    const data = c.req.valid("json");
    // data is typed: { name: string; email: string; age?: number }
    return c.json({ created: data });
  }
);
```

### Multiple Validators

```typescript
const QuerySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(10),
});

const ParamSchema = z.object({
  id: z.string().uuid(),
});

app.get(
  "/users/:id",
  zValidator("param", ParamSchema),
  zValidator("query", QuerySchema),
  (c) => {
    const { id } = c.req.valid("param");
    const { page, limit } = c.req.valid("query");
    return c.json({ id, page, limit });
  }
);
```

### Validation Targets

```typescript
// JSON body
zValidator("json", schema)

// Query parameters
zValidator("query", schema)

// URL parameters
zValidator("param", schema)

// Form data
zValidator("form", schema)

// Headers
zValidator("header", schema)

// Cookies
zValidator("cookie", schema)
```

### Custom Error Handling

```typescript
app.post(
  "/users",
  zValidator("json", CreateUserSchema, (result, c) => {
    if (!result.success) {
      return c.json({
        error: "Validation failed",
        issues: result.error.issues,
      }, 400);
    }
  }),
  (c) => {
    const data = c.req.valid("json");
    return c.json({ created: data });
  }
);
```

## Error Handling

### Global Error Handler

```typescript
app.onError((err, c) => {
  console.error(err);

  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  return c.json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  }, 500);
});
```

### HTTP Exceptions

```typescript
import { HTTPException } from "hono/http-exception";

app.get("/protected", (c) => {
  const auth = c.req.header("Authorization");

  if (!auth) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  return c.json({ data: "secret" });
});
```

### Not Found Handler

```typescript
app.notFound((c) => {
  return c.json({
    error: "Not Found",
    path: c.req.path,
  }, 404);
});
```

## Type-Safe RPC Client

### Server Setup

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono()
  .get("/users", (c) => c.json({ users: [] }))
  .post(
    "/users",
    zValidator("json", z.object({ name: z.string() })),
    (c) => {
      const { name } = c.req.valid("json");
      return c.json({ id: 1, name });
    }
  )
  .get("/users/:id", (c) => {
    const id = c.req.param("id");
    return c.json({ id, name: "John" });
  });

export type AppType = typeof app;
export default app;
```

### Client Usage

```typescript
import { hc } from "hono/client";
import type { AppType } from "./server";

const client = hc<AppType>("http://localhost:3000");

// Fully typed API calls
const users = await client.users.$get();
const json = await users.json(); // { users: [] }

const newUser = await client.users.$post({
  json: { name: "John" },
});
const created = await newUser.json(); // { id: 1, name: "John" }

const user = await client.users[":id"].$get({
  param: { id: "1" },
});
```

## Testing

### Using app.request()

```typescript
import { describe, test, expect } from "bun:test";
import app from "./app";

describe("API", () => {
  test("GET / returns hello", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello Hono!");
  });

  test("POST /users creates user", async () => {
    const res = await app.request("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "John", email: "john@example.com" }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.name).toBe("John");
  });

  test("GET /users/:id returns user", async () => {
    const res = await app.request("/users/123");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("123");
  });

  test("returns 401 without auth", async () => {
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
  });

  test("returns 200 with auth", async () => {
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer token" },
    });
    expect(res.status).toBe(200);
  });
});
```

### Testing with Context

```typescript
import { testClient } from "hono/testing";

describe("API with testClient", () => {
  test("typed client testing", async () => {
    const client = testClient(app);

    const res = await client.users.$get();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.users).toEqual([]);
  });
});
```

## Static Files (Bun)

```typescript
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const app = new Hono();

// Serve static files from ./public
app.use("/static/*", serveStatic({ root: "./public" }));

// Serve index.html for root
app.get("/", serveStatic({ path: "./public/index.html" }));

// SPA fallback
app.use("*", serveStatic({ root: "./public" }));
app.use("*", serveStatic({ path: "./public/index.html" }));

export default app;
```

## OpenAPI Integration

### Setup

```bash
bun add @hono/zod-openapi
```

### Define Routes with OpenAPI

```typescript
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const app = new OpenAPIHono();

const getUserRoute = createRoute({
  method: "get",
  path: "/users/{id}",
  request: {
    params: z.object({
      id: z.string().openapi({ example: "123" }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            name: z.string(),
          }),
        },
      },
      description: "User found",
    },
    404: {
      description: "User not found",
    },
  },
});

app.openapi(getUserRoute, (c) => {
  const { id } = c.req.valid("param");
  return c.json({ id, name: "John" });
});

// Generate OpenAPI spec
app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: { title: "My API", version: "1.0.0" },
});

// Swagger UI
app.get("/docs", (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" />
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
        <script>
          SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });
        </script>
      </body>
    </html>
  `);
});
```

## Common Patterns

### API Versioning

```typescript
const v1 = new Hono();
v1.get("/users", (c) => c.json({ version: "v1", users: [] }));

const v2 = new Hono();
v2.get("/users", (c) => c.json({ version: "v2", data: { users: [] } }));

const app = new Hono();
app.route("/api/v1", v1);
app.route("/api/v2", v2);
```

### Request ID Middleware

```typescript
import { createMiddleware } from "hono/factory";

const requestId = createMiddleware(async (c, next) => {
  const id = crypto.randomUUID();
  c.set("requestId", id);
  c.header("X-Request-ID", id);
  await next();
});

app.use(requestId);
```

### Database Integration

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

app.get("/users", async (c) => {
  const users = await prisma.user.findMany();
  return c.json({ users });
});

app.post(
  "/users",
  zValidator("json", CreateUserSchema),
  async (c) => {
    const data = c.req.valid("json");
    const user = await prisma.user.create({ data });
    return c.json(user, 201);
  }
);
```

### Authentication Pattern

```typescript
import { jwt } from "hono/jwt";

// JWT middleware
app.use("/api/*", jwt({ secret: process.env.JWT_SECRET! }));

app.get("/api/me", (c) => {
  const payload = c.get("jwtPayload");
  return c.json({ userId: payload.sub });
});

// Login endpoint (outside protected routes)
app.post("/login", async (c) => {
  const { email, password } = await c.req.json();

  // Validate credentials...
  const token = await sign(
    { sub: user.id, exp: Math.floor(Date.now() / 1000) + 60 * 60 },
    process.env.JWT_SECRET!
  );

  return c.json({ token });
});
```

## Best Practices Summary

1. **Use route grouping** to organize related endpoints
2. **Apply middleware at appropriate scopes** - global vs path-specific
3. **Validate all inputs** with Zod validators
4. **Handle errors globally** with `app.onError()`
5. **Use typed RPC client** for frontend-backend type safety
6. **Test with `app.request()`** for fast, isolated tests
7. **Export `AppType`** for end-to-end type inference
8. **Use factory pattern** for configurable middleware
9. **Set security headers** with `secureHeaders()` middleware
10. **Keep handlers thin** - delegate to service functions

## When to Ask for Help

- WebSocket integration patterns
- Complex authentication flows (OAuth, SAML)
- Streaming and SSE implementations
- Edge runtime-specific configurations
- GraphQL integration with Hono
- Performance optimization for high-traffic APIs
