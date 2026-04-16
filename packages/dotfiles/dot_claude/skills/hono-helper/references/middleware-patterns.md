# Middleware, Error Handling, and Common Patterns

## Custom Middleware

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
app.use("/api/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

// Method-specific
app.use("/admin/*", "POST", async (c, next) => {
  // Only POST requests to /admin/*
  await next();
});
```

### Middleware Factory Pattern (createMiddleware)

```typescript
import { createMiddleware } from "hono/factory";

// Typed, reusable middleware
const requestId = createMiddleware(async (c, next) => {
  const id = crypto.randomUUID();
  c.set("requestId", id);
  c.header("X-Request-ID", id);
  await next();
});

app.use(requestId);
```

### Configurable Factory

```typescript
const rateLimiter = (limit: number) => {
  const requests = new Map<string, number>();
  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for") ?? "unknown";
    const count = requests.get(ip) ?? 0;
    if (count >= limit) return c.json({ error: "Rate limited" }, 429);
    requests.set(ip, count + 1);
    await next();
  };
};

app.use(rateLimiter(100));
```

## Built-in Middleware Catalog

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
import { jwt } from "hono/jwt";

// CORS
app.use(cors({
  origin: ["https://example.com"],
  allowMethods: ["GET", "POST", "PUT", "DELETE"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

// Logging, security, compression, caching
app.use(logger());
app.use(secureHeaders());
app.use(compress());
app.use(etag());

// Auth variants
app.use("/admin/*", basicAuth({ username: "admin", password: "secret" }));
app.use("/api/*", bearerAuth({ token: "my-secret-token" }));
app.use("/api/*", jwt({ secret: process.env.JWT_SECRET! }));

// CSRF and timing
app.use(csrf());
app.use(timing());
```

## Authentication Pattern (JWT)

```typescript
import { jwt } from "hono/jwt";
import { sign } from "hono/jwt";

// Protect API routes
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
    process.env.JWT_SECRET!,
  );
  return c.json({ token });
});
```

## Error Handling

```typescript
import { HTTPException } from "hono/http-exception";

// Throw typed exceptions
throw new HTTPException(401, { message: "Unauthorized" });

// Global error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  }, 500);
});

// Custom 404
app.notFound((c) => c.json({ error: "Not Found", path: c.req.path }, 404));
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

### Database Integration

```typescript
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

app.get("/users", async (c) => {
  const users = await prisma.user.findMany();
  return c.json({ users });
});

app.post("/users", zValidator("json", CreateUserSchema), async (c) => {
  const data = c.req.valid("json");
  const user = await prisma.user.create({ data });
  return c.json(user, 201);
});
```

### Static Files (runtime-specific imports)

```typescript
// Bun
import { serveStatic } from "hono/bun";
// Cloudflare Workers
import { serveStatic } from "hono/cloudflare-workers";
// Deno
import { serveStatic } from "npm:hono/deno";

app.use("/static/*", serveStatic({ root: "./public" }));
app.get("/", serveStatic({ path: "./public/index.html" }));

// SPA fallback
app.use("*", serveStatic({ root: "./public" }));
app.use("*", serveStatic({ path: "./public/index.html" }));
```
