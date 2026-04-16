# Bun Database Access (Bun 1.3+)

## Unified SQL API — PostgreSQL, MySQL, SQLite

Bun 1.3 provides `Bun.SQL` for PostgreSQL, MySQL/MariaDB, and SQLite with zero external dependencies.

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

## PostgreSQL — Full Example

```typescript
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

// Prepared statements
const getUser = db.prepare`SELECT * FROM users WHERE id = ${0}`;
const user1 = await getUser(123);
const user2 = await getUser(456);

await db.close();
```

## MySQL / MariaDB — Full Example

```typescript
const db = await Bun.SQL`mysql://root:password@localhost:3306/testdb`;

await db`
  INSERT INTO products (name, price)
  VALUES (${productName}, ${price})
`;

const products = await db`
  SELECT * FROM products
  WHERE category = ${category}
  AND price < ${maxPrice}
`;

// Bulk insert
const values = products.map((p) => [p.name, p.price]);
await db`INSERT INTO products (name, price) VALUES ${values}`;

await db.close();
```

## SQLite — Unified API vs bun:sqlite

```typescript
// Option 1: Unified SQL API (async)
const db = await Bun.SQL`sqlite:///mydb.sqlite`;
const users = await db`SELECT * FROM users WHERE active = ${true}`;

// Option 2: bun:sqlite (synchronous)
import { Database } from "bun:sqlite";

const db = new Database("mydb.sqlite");

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
  )
`);

const insert = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
insert.run("Alice", "alice@example.com");

const query = db.prepare("SELECT * FROM users WHERE email = ?");
const user = query.get("alice@example.com");

db.close();
```

Use `Bun.SQL` for unified async workflows across PostgreSQL/MySQL/SQLite. Use `bun:sqlite` for synchronous operations and lower-level control.

## Built-in Redis Client

```typescript
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

await redis.disconnect();
```
