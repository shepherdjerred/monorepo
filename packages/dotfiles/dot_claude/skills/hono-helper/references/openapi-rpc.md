# Type-Safe RPC Client, OpenAPI Integration, and Testing

## Type-Safe RPC Client

### Server Setup

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono()
  .get("/users", (c) => c.json({ users: [] }))
  .post("/users", zValidator("json", z.object({ name: z.string() })), (c) => {
    const { name } = c.req.valid("json");
    return c.json({ id: 1, name });
  })
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
