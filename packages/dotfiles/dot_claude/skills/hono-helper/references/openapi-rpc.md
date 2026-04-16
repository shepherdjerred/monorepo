# OpenAPI Integration and RPC Client

## Type-Safe RPC Client

### Server Setup (chain routes for type inference)

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

// CRITICAL: export the type for client inference
export type AppType = typeof app;
export default app;
```

### Client Usage

```typescript
import { hc } from "hono/client";
import type { AppType } from "./server";

const client = hc<AppType>("http://localhost:3000");

// All calls are fully typed — params, body, response
const users = await client.users.$get();
const json = await users.json(); // { users: [] }

const newUser = await client.users.$post({
  json: { name: "John" },
});
const created = await newUser.json(); // { id: 1, name: "John" }

// Dynamic path params use bracket notation
const user = await client.users[":id"].$get({
  param: { id: "1" },
});
```

### Client with Custom Fetch (e.g., for auth headers)

```typescript
const client = hc<AppType>("http://localhost:3000", {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

// Or per-request with init
const res = await client.users.$get(undefined, {
  headers: { "X-Custom": "value" },
});
```

## OpenAPI with @hono/zod-openapi

### Setup

```bash
bun add @hono/zod-openapi
```

### Define Routes with OpenAPI Metadata

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
```

### Generate Spec and Serve Swagger UI

```typescript
// Serve OpenAPI JSON spec
app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: { title: "My API", version: "1.0.0" },
});

// Swagger UI endpoint
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

### Reusable OpenAPI Schemas

```typescript
// Define reusable schemas with .openapi()
const UserSchema = z.object({
  id: z.string().openapi({ example: "user-123" }),
  name: z.string().openapi({ example: "John Doe" }),
  email: z.string().email().openapi({ example: "john@example.com" }),
}).openapi("User");

const CreateUserSchema = z.object({
  name: z.string().min(1).openapi({ example: "John Doe" }),
  email: z.string().email().openapi({ example: "john@example.com" }),
}).openapi("CreateUser");

// Use in route definitions
const createUserRoute = createRoute({
  method: "post",
  path: "/users",
  request: {
    body: {
      content: { "application/json": { schema: CreateUserSchema } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: UserSchema } },
      description: "User created",
    },
  },
});
```
