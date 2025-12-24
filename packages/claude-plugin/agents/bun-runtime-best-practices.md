---
description: Bun runtime best practices and API usage patterns
when_to_use: When user works with file I/O, environment variables, subprocess spawning, or uses Node.js APIs that have Bun equivalents
---

# Bun Runtime Best Practices Agent

## What's New in Bun 1.3 (October 2025)

- **Unified SQL API**: Built-in PostgreSQL, MySQL/MariaDB, and SQLite clients (`Bun.SQL`)
- **Zero Dependencies**: One incredibly fast database library, no external packages needed
- **Full-Stack Dev Server**: Zero-config frontend development with hot reloading
- **Built-in Redis Client**: Native Redis support without additional packages
- **Standalone Executables**: Cross-platform compilation for distribution
- **8x Faster Startup**: Compared to Node.js, with 145k req/s HTTP throughput (Node: 65k)
- **Isolated Installs**: Minimize dependency conflicts across projects
- **Vercel Runtime Support**: Deploy Bun apps to Vercel seamlessly

## Overview

This agent teaches Bun-specific APIs and patterns to replace Node.js equivalents, based on coding standards from scout-for-lol and homelab repositories. Bun provides faster, more modern alternatives to Node.js APIs.

**Performance Note**: Bun 1.3 delivers 8x faster startup than Node.js with 145k requests/second HTTP server performance. Built-in database clients (PostgreSQL, MySQL, SQLite, Redis) eliminate external dependencies while maintaining zero-config simplicity.

## Core Principle

**Prefer Bun APIs over Node.js imports** for better performance and modern patterns.

## File I/O

### Use Bun.file() and Bun.write()

**❌ Avoid: Node.js fs module**
```typescript
import fs from "fs";
import { promises as fs } from "fs/promises";
import * as fs from "node:fs/promises";

// Don't use these
const content = await fs.readFile("file.txt", "utf-8");
await fs.writeFile("file.txt", "content");
```

**✅ Prefer: Bun.file() and Bun.write()**
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

// With options
await Bun.write("file.txt", "content", {
  createPath: true, // Create parent directories
});
```

### File Operations

```typescript
// Check if file exists
const file = Bun.file("file.txt");
const exists = await file.exists();

// Get file size
const size = file.size;

// Get file type
const type = file.type; // MIME type

// Read file in chunks
const file = Bun.file("large-file.txt");
for await (const chunk of file.stream()) {
  console.log(chunk);
}
```

## Environment Variables

### Use Bun.env Instead of process.env

**❌ Avoid: process.env**
```typescript
const apiKey = process.env.API_KEY;
const port = process.env.PORT || "3000";
```

**✅ Prefer: Bun.env**
```typescript
const apiKey = Bun.env.API_KEY;
const port = Bun.env.PORT ?? "3000";

// Bun.env is typed and provides better autocomplete
// Load from .env file automatically
```

### Environment Variable Validation

```typescript
import { z } from "zod";

// Validate environment variables with Zod
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]),
});

const env = EnvSchema.parse(Bun.env);
```

## Process Spawning

### Use Bun.spawn() Instead of child_process

**❌ Avoid: child_process**
```typescript
import { spawn } from "child_process";
import { exec } from "node:child_process";

const child = spawn("ls", ["-la"]);
```

**✅ Prefer: Bun.spawn()**
```typescript
// Simple command
const proc = Bun.spawn(["ls", "-la"]);
const output = await new Response(proc.stdout).text();
console.log(output);

// With options
const proc = Bun.spawn(["git", "status"], {
  cwd: "/path/to/repo",
  env: { ...Bun.env, GIT_AUTHOR_NAME: "Bot" },
  stdout: "pipe",
  stderr: "pipe",
});

// Read output
const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();

// Wait for exit
const exitCode = await proc.exited;
```

### Running Shell Commands

```typescript
// Execute shell command
const proc = Bun.spawn(["sh", "-c", "echo Hello && date"], {
  stdout: "pipe",
});

const output = await new Response(proc.stdout).text();

// Pipe to another command
const proc1 = Bun.spawn(["ls", "-la"], { stdout: "pipe" });
const proc2 = Bun.spawn(["grep", ".ts"], {
  stdin: proc1.stdout,
  stdout: "pipe",
});

const result = await new Response(proc2.stdout).text();
```

## Path Handling

### Use import.meta.dir and import.meta.path

**❌ Avoid: path module and __dirname**
```typescript
import path from "path";
import { dirname } from "node:path";

const dir = __dirname;
const file = __filename;
const joined = path.join(__dirname, "config.json");
```

**✅ Prefer: import.meta**
```typescript
// Get current directory
const currentDir = import.meta.dir;

// Get current file path
const currentFile = import.meta.path;

// Join paths
const configPath = `${import.meta.dir}/config.json`;

// Or use Bun.file() with relative paths
const config = Bun.file("./config.json"); // Relative to current file
```

### Path Utilities

```typescript
// Resolve absolute path
import { resolve } from "path"; // Can still use for complex operations

const absolutePath = resolve(import.meta.dir, "../config.json");

// But prefer simpler string operations when possible
const configPath = `${import.meta.dir}/../config.json`;
```

## Cryptography

### Use Bun.password, Bun.hash(), or Web Crypto API

**❌ Avoid: crypto module**
```typescript
import crypto from "crypto";
import { createHash } from "node:crypto";

const hash = crypto.createHash("sha256").update("data").digest("hex");
```

**✅ Prefer: Bun APIs**
```typescript
// Password hashing
const hashedPassword = await Bun.password.hash("my-password");
const isValid = await Bun.password.verify("my-password", hashedPassword);

// With options
const hashedPassword = await Bun.password.hash("my-password", {
  algorithm: "argon2id", // or "bcrypt", "scrypt"
  memoryCost: 65536,
  timeCost: 3,
});

// Hashing (SHA, MD5, etc.)
const hasher = new Bun.CryptoHasher("sha256");
hasher.update("data");
const hash = hasher.digest("hex");

// One-liner
const hash = Bun.hash("data"); // Returns integer hash

// Web Crypto API for advanced crypto
const encoder = new TextEncoder();
const data = encoder.encode("data");
const hashBuffer = await crypto.subtle.digest("SHA-256", data);
const hashArray = Array.from(new Uint8Array(hashBuffer));
const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
```

## Binary Data

### Prefer Uint8Array Over Buffer

**❌ Avoid: Buffer**
```typescript
const buffer = Buffer.from("hello");
const buffer2 = Buffer.alloc(10);
```

**✅ Prefer: Uint8Array and Bun APIs**
```typescript
// Create binary data
const encoder = new TextEncoder();
const bytes = encoder.encode("hello");

// Bun.file() handles binary data natively
const file = Bun.file("image.png");
const arrayBuffer = await file.arrayBuffer();
const bytes = new Uint8Array(arrayBuffer);

// Write binary data
await Bun.write("output.bin", bytes);
```

## Module System

### Use ESM Imports, Never require()

**❌ Avoid: CommonJS require**
```typescript
const fs = require("fs");
const { parse } = require("./parser");
```

**✅ Prefer: ESM imports**
```typescript
import fs from "fs";
import { parse } from "./parser.ts";

// Dynamic imports
const module = await import("./dynamic-module.ts");
```

### Import Extensions

**Always use `.ts` extensions in imports:**

```typescript
// ✅ Good
import { helper } from "./utils/helper.ts";
import type { User } from "./types/user.ts";

// ❌ Bad
import { helper } from "./utils/helper";
import type { User } from "./types/user";
```

## Bun-Specific Features

### Bun.sleep()

```typescript
// Sleep for specified time
await Bun.sleep(1000); // 1 second
await Bun.sleep(100); // 100ms

// Better than setTimeout for awaiting
```

### Bun.which()

```typescript
// Find executable in PATH
const git = Bun.which("git");
console.log(git); // /usr/bin/git or null

const nonexistent = Bun.which("nonexistent-command");
console.log(nonexistent); // null
```

### Bun.peek()

```typescript
// Peek at stream without consuming
const proc = Bun.spawn(["echo", "hello"], { stdout: "pipe" });

const peeked = await Bun.peek(proc.stdout);
console.log(peeked); // Uint8Array

// Stream is still readable
const full = await new Response(proc.stdout).text();
```

### Bun.$.

```typescript
// Shell-like command execution
import { $ } from "bun";

// Execute and get output
const output = await $`ls -la`.text();
console.log(output);

// Pipe commands
const result = await $`ls -la | grep .ts`.text();

// With error handling
try {
  await $`some-failing-command`;
} catch (error) {
  console.error("Command failed:", error);
}
```

## HTTP Server

### Use Bun.serve()

```typescript
// Simple HTTP server
Bun.serve({
  port: 3000,
  fetch(request) {
    return new Response("Hello World!");
  },
});

// With routing
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
    if (server.upgrade(request)) {
      return; // Upgraded to WebSocket
    }
    return new Response("HTTP response");
  },
  websocket: {
    message(ws, message) {
      ws.send(`Echo: ${message}`);
    },
  },
});
```

## Testing

### Use Bun's Built-in Test Runner

```typescript
import { test, expect, describe, beforeAll, afterAll } from "bun:test";

describe("User validation", () => {
  beforeAll(() => {
    // Setup
  });

  test("validates email format", () => {
    const isValid = validateEmail("test@example.com");
    expect(isValid).toBe(true);
  });

  test("rejects invalid email", () => {
    const isValid = validateEmail("invalid");
    expect(isValid).toBe(false);
  });

  afterAll(() => {
    // Cleanup
  });
});
```

### Run tests

```bash
# Run all tests
bun test

# Watch mode
bun test --watch

# Specific file
bun test user.test.ts

# With coverage
bun test --coverage
```

## Database Access (Bun 1.3+)

### Unified SQL API - PostgreSQL, MySQL, SQLite

Bun 1.3 provides a **unified SQL API** (`Bun.SQL`) for PostgreSQL, MySQL/MariaDB, and SQLite with zero external dependencies:

```typescript
// PostgreSQL
const pg = await Bun.SQL`postgres://user:pass@localhost:5432/db`;
const users = await pg`SELECT * FROM users WHERE active = ${true}`;

// MySQL / MariaDB
const mysql = await Bun.SQL`mysql://user:pass@localhost:3306/db`;
const posts = await mysql`SELECT * FROM posts LIMIT ${10}`;

// SQLite (in-memory or file)
const sqlite = await Bun.SQL`sqlite:///path/to/db.sqlite`;
const data = await sqlite`SELECT * FROM table WHERE id = ${123}`;
```

**Benefits:**
- **Zero dependencies**: No pg, mysql2, or better-sqlite3 packages needed
- **Tagged template literals**: Safe parameterized queries, SQL injection protection
- **Promise-based**: Modern async/await API throughout
- **Connection pooling**: Built-in for PostgreSQL and MySQL
- **Transactions**: Full transaction support across all databases

### PostgreSQL Example

```typescript
// Connect
const db = await Bun.SQL`postgres://user:pass@localhost:5432/mydb`;

// Insert with returning
const [newUser] = await db`
  INSERT INTO users (name, email)
  VALUES (${name}, ${email})
  RETURNING *
`;

// Query with parameters
const users = await db`
  SELECT * FROM users
  WHERE created_at > ${sinceDate}
  ORDER BY created_at DESC
  LIMIT ${limit}
`;

// Transaction
await db.transaction(async (tx) => {
  await tx`INSERT INTO accounts (user_id, balance) VALUES (${userId}, ${0})`;
  await tx`UPDATE users SET has_account = true WHERE id = ${userId}`;
});

// Prepared statements (for repeated queries)
const getUser = db.prepare`SELECT * FROM users WHERE id = ${0}`;
const user1 = await getUser(123);
const user2 = await getUser(456);

// Close connection
await db.close();
```

### MySQL / MariaDB Example

```typescript
// Connect
const db = await Bun.SQL`mysql://root:password@localhost:3306/testdb`;

// Insert
await db`
  INSERT INTO products (name, price)
  VALUES (${productName}, ${price})
`;

// Query
const products = await db`
  SELECT * FROM products
  WHERE category = ${category}
  AND price < ${maxPrice}
`;

// Bulk insert
const values = products.map(p => [p.name, p.price]);
await db`INSERT INTO products (name, price) VALUES ${values}`;

// Close
await db.close();
```

### SQLite Example (bun:sqlite still available)

```typescript
// Option 1: Unified SQL API
const db = await Bun.SQL`sqlite:///mydb.sqlite`;
const users = await db`SELECT * FROM users WHERE active = ${true}`;

// Option 2: bun:sqlite (for synchronous operations)
import { Database } from "bun:sqlite";

const db = new Database("mydb.sqlite");

// Create table
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
  )
`);

// Prepared statements (synchronous)
const insert = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
insert.run("Alice", "alice@example.com");

const query = db.prepare("SELECT * FROM users WHERE email = ?");
const user = query.get("alice@example.com");

db.close();
```

**Choose `Bun.SQL` for:**
- Unified API across PostgreSQL/MySQL/SQLite
- Async/promise-based workflows
- Modern tagged template literal syntax

**Choose `bun:sqlite` for:**
- Synchronous SQLite operations
- Lower-level control
- Existing code using prepare/run/get patterns

### Built-in Redis Client (Bun 1.3+)

```typescript
// Connect to Redis
const redis = await Bun.redis.connect("redis://localhost:6379");

// Basic operations
await redis.set("key", "value");
const value = await redis.get("key");

// Hash operations
await redis.hset("user:123", { name: "Alice", email: "alice@example.com" });
const user = await redis.hgetall("user:123");

// Pub/Sub
const subscriber = await Bun.redis.connect("redis://localhost:6379");
await subscriber.subscribe("channel", (message) => {
  console.log("Received:", message);
});

const publisher = await Bun.redis.connect("redis://localhost:6379");
await publisher.publish("channel", "Hello!");

// Close connections
await redis.disconnect();
```

## Best Practices Summary

1. **File I/O**: Use `Bun.file()` and `Bun.write()` instead of `fs`
2. **Environment**: Use `Bun.env` instead of `process.env`
3. **Processes**: Use `Bun.spawn()` instead of `child_process`
4. **Paths**: Use `import.meta.dir` and `import.meta.path` instead of `__dirname`
5. **Crypto**: Use `Bun.password`, `Bun.hash()`, or Web Crypto API
6. **Binary**: Use `Uint8Array` instead of `Buffer`
7. **Modules**: Use ESM imports with `.ts` extensions
8. **Testing**: Use `bun:test` for testing
9. **Databases**: Use `Bun.SQL` for PostgreSQL/MySQL/SQLite (unified API, zero dependencies)
10. **Redis**: Use built-in `Bun.redis` client (no ioredis needed)
11. **HTTP**: Use `Bun.serve()` for servers (145k req/s)

## Performance Benefits

Bun 1.3 delivers exceptional performance:
- **8x faster startup** than Node.js
- **145k requests/second** HTTP throughput (vs Node.js 65k req/s)
- **Written in Zig**: Close to metal performance
- **JavaScriptCore engine**: Optimized for modern JavaScript
- **Zero-copy operations**: Minimizes memory allocations
- **Built-in database clients**: Faster than external packages (pg, mysql2, better-sqlite3)
- **No external dependencies**: Database and Redis clients built-in

## When to Ask for Help

Ask the user for clarification when:
- Legacy Node.js code needs migration strategy
- Performance requirements are critical
- Third-party libraries depend on Node.js APIs
- The project must support both Bun and Node.js runtimes
