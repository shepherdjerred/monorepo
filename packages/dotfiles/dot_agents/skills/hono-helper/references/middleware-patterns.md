# Middleware, Error Handling, and Common Patterns

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
app.use(
  cors({
    origin: ["https://example.com"],
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Logging
app.use(logger());

// Security headers
app.use(secureHeaders());

// Compression
app.use(compress());

// ETag caching
app.use(etag());

// Basic auth
app.use(
  "/admin/*",
  basicAuth({
    username: "admin",
    password: "secret",
  }),
);

// Bearer token auth
app.use(
  "/api/*",
  bearerAuth({
    token: "my-secret-token",
  }),
);

// CSRF protection
app.use(csrf());

// Server timing
app.use(timing());
```

## Error Handling

### Global Error Handler

```typescript
app.onError((err, c) => {
  console.error(err);

  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  return c.json(
    {
      error: "Internal Server Error",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    },
    500,
  );
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
  return c.json(
    {
      error: "Not Found",
      path: c.req.path,
    },
    404,
  );
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

app.post("/users", zValidator("json", CreateUserSchema), async (c) => {
  const data = c.req.valid("json");
  const user = await prisma.user.create({ data });
  return c.json(user, 201);
});
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
    process.env.JWT_SECRET!,
  );

  return c.json({ token });
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
