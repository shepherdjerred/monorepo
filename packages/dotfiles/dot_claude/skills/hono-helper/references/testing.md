# Testing Hono Applications

## app.request() — Direct Request Testing

The primary testing approach in Hono. No server startup needed — `app.request()` returns a standard `Response`.

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

  test("returns 401 without auth header", async () => {
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
  });

  test("returns 200 with valid auth", async () => {
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer token" },
    });
    expect(res.status).toBe(200);
  });
});
```

## testClient — Typed Client Testing

Uses the RPC client internally for fully typed test requests. Requires chained route definitions and `AppType` export.

```typescript
import { testClient } from "hono/testing";
import app from "./app";

describe("API with testClient", () => {
  test("typed client testing", async () => {
    const client = testClient(app);

    const res = await client.users.$get();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.users).toEqual([]);
  });

  test("POST with typed body", async () => {
    const client = testClient(app);

    const res = await client.users.$post({
      json: { name: "John" },
    });
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.name).toBe("John");
  });

  test("GET with typed params", async () => {
    const client = testClient(app);

    const res = await client.users[":id"].$get({
      param: { id: "123" },
    });
    expect(res.status).toBe(200);
  });
});
```

## Testing Validation Errors

```typescript
test("returns 400 for invalid input", async () => {
  const res = await app.request("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "" }), // fails min(1) validation
  });
  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe("Validation failed");
  expect(json.issues).toBeDefined();
});
```

## Testing Middleware

```typescript
test("CORS headers are set", async () => {
  const res = await app.request("/api/data", {
    headers: { Origin: "https://example.com" },
  });
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
});

test("rate limiter blocks after limit", async () => {
  // Send requests up to the limit
  for (let i = 0; i < 100; i++) {
    await app.request("/api/data");
  }
  // Next request should be rate limited
  const res = await app.request("/api/data");
  expect(res.status).toBe(429);
});
```
