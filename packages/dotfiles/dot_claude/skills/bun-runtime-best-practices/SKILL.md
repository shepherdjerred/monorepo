---
name: bun-runtime-best-practices
description: "Convert Node.js APIs to Bun equivalents (Bun.file(), Bun.write(), Bun.serve(), Bun.spawn(), Bun.env), optimize file I/O operations, configure HTTP servers with WebSocket support, manage subprocesses, and use Bun-native crypto, testing, and module patterns. Use when working with Bun, bun run, bunx, bunfig.toml, bun:test, bun:sqlite, Bun.SQL, Bun.redis, import.meta.dir, or migrating from Node.js fs/child_process to Bun equivalents."
---

# Bun Runtime Best Practices

Prefer Bun APIs over Node.js imports for better performance and modern patterns. Bun 1.3+ includes built-in database clients, 8x faster startup than Node.js, and 145k req/s HTTP throughput.

## File I/O — Bun.file() and Bun.write()

Replace `fs`/`fs/promises` with Bun's native file API.

```typescript
// Reading files
const file = Bun.file("file.txt");
const content = await file.text();
const json = await file.json();
const arrayBuffer = await file.arrayBuffer();
const stream = file.stream();

// Writing files
await Bun.write("output.txt", "Hello, world!");
await Bun.write("data.json", JSON.stringify({ foo: "bar" }));
await Bun.write("binary.dat", new Uint8Array([1, 2, 3]));
await Bun.write("file.txt", "content", { createPath: true });
```

### File metadata and streaming

```typescript
const file = Bun.file("file.txt");
const exists = await file.exists();
const size = file.size;
const type = file.type; // MIME type

for await (const chunk of file.stream()) {
  console.log(chunk);
}
```

## Environment Variables — Bun.env

Replace `process.env` with `Bun.env`.

```typescript
const apiKey = Bun.env.API_KEY;
const port = Bun.env.PORT ?? "3000";
```

### Validation with Zod

```typescript
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]),
});

const env = EnvSchema.parse(Bun.env);
```

## Process Spawning — Bun.spawn()

Replace `child_process` with `Bun.spawn()`.

```typescript
const proc = Bun.spawn(["ls", "-la"]);
const output = await new Response(proc.stdout).text();
```

```typescript
// With options
const proc = Bun.spawn(["git", "status"], {
  cwd: "/path/to/repo",
  env: { ...Bun.env, GIT_AUTHOR_NAME: "Bot" },
  stdout: "pipe",
  stderr: "pipe",
});

const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
const exitCode = await proc.exited;
```

### Piping commands

```typescript
const proc1 = Bun.spawn(["ls", "-la"], { stdout: "pipe" });
const proc2 = Bun.spawn(["grep", ".ts"], {
  stdin: proc1.stdout,
  stdout: "pipe",
});
const result = await new Response(proc2.stdout).text();
```

### Shell API — Bun.$

```typescript
import { $ } from "bun";

const output = await $`ls -la`.text();
const filtered = await $`ls -la | grep .ts`.text();

try {
  await $`some-failing-command`;
} catch (error) {
  console.error("Command failed:", error);
}
```

## Path Handling — import.meta

Replace `__dirname`/`__filename` with `import.meta`.

```typescript
const currentDir = import.meta.dir;
const currentFile = import.meta.path;
const configPath = `${import.meta.dir}/config.json`;
const config = Bun.file("./config.json");
```

## Cryptography — Bun.password, Bun.hash(), Web Crypto

Replace `crypto`/`node:crypto` with Bun's native APIs.

```typescript
// Password hashing
const hashed = await Bun.password.hash("my-password");
const isValid = await Bun.password.verify("my-password", hashed);
```

```typescript
// Password hashing with options
const hashed = await Bun.password.hash("my-password", {
  algorithm: "argon2id",
  memoryCost: 65536,
  timeCost: 3,
});
```

```typescript
// General hashing (hex output)
const hasher = new Bun.CryptoHasher("sha256");
hasher.update("data");
const hash = hasher.digest("hex");
```

```typescript
// Fast integer hash
const hash = Bun.hash("data");
```

## Binary Data — Uint8Array over Buffer

```typescript
const encoder = new TextEncoder();
const bytes = encoder.encode("hello");

const file = Bun.file("image.png");
const arrayBuffer = await file.arrayBuffer();
const imageBytes = new Uint8Array(arrayBuffer);

await Bun.write("output.bin", imageBytes);
```

## Module System — ESM with .ts Extensions

Always use ESM imports with explicit `.ts` extensions.

```typescript
import { helper } from "./utils/helper.ts";
import type { User } from "./types/user.ts";
const module = await import("./dynamic-module.ts");
```

## HTTP Server — Bun.serve()

```typescript
Bun.serve({
  port: 3000,
  fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/users") {
      return Response.json({ users: [] });
    }

    if (url.pathname === "/health") {
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  },
});

// WebSocket support
Bun.serve({
  port: 3000,
  fetch(request, server) {
    if (server.upgrade(request)) return;
    return new Response("HTTP response");
  },
  websocket: {
    message(ws, message) {
      ws.send(`Echo: ${message}`);
    },
  },
});
```

## Bun Utilities

```typescript
// Sleep
await Bun.sleep(1000);

// Find executable in PATH
const git = Bun.which("git"); // "/usr/bin/git" or null

// Peek at stream without consuming — stream remains readable after peek
const proc = Bun.spawn(["echo", "hello"], { stdout: "pipe" });
const peeked = await Bun.peek(proc.stdout); // Uint8Array — stream is still readable
const full = await new Response(proc.stdout).text(); // proc.stdout still consumable after peek
```

## Testing — bun:test

```typescript
import { test, expect, describe, beforeAll, afterAll } from "bun:test";

describe("User validation", () => {
  test("validates email format", () => {
    expect(validateEmail("test@example.com")).toBe(true);
  });

  test("rejects invalid email", () => {
    expect(validateEmail("invalid")).toBe(false);
  });
});
```

```bash
bun test                    # Run all tests
bun test --watch            # Watch mode
bun test user.test.ts       # Specific file
bun test --coverage         # With coverage
```

## Database and Redis

For Bun.SQL (PostgreSQL, MySQL, SQLite), bun:sqlite, and Bun.redis usage, see [references/databases.md](references/databases.md).

## Quick Reference

| Node.js | Bun Equivalent |
|---------|---------------|
| `fs.readFile()` / `fs.writeFile()` | `Bun.file()` / `Bun.write()` |
| `process.env` | `Bun.env` |
| `child_process.spawn()` | `Bun.spawn()` |
| `__dirname` / `__filename` | `import.meta.dir` / `import.meta.path` |
| `crypto.createHash()` | `new Bun.CryptoHasher()` |
| `bcrypt` / `argon2` | `Bun.password.hash()` / `.verify()` |
| `Buffer.from()` | `new TextEncoder().encode()` |
| `require()` | ESM `import` with `.ts` extensions |
| `jest` / `vitest` | `bun:test` |
| `pg` / `mysql2` / `better-sqlite3` | `Bun.SQL` |
| `ioredis` | `Bun.redis` |
| `express` / `fastify` | `Bun.serve()` |
| `setTimeout` (for delay) | `Bun.sleep()` |
