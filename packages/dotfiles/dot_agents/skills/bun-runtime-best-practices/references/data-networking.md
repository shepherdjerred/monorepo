# Bun data and networking APIs

Read this when building Bun HTTP or WebSocket services, using SQL, Redis, SQLite, or S3, or implementing cookies, CSRF, secrets, and scheduled work.

## HTTP, WebSocket, and fetch

`Bun.serve()` is Bun's native server API. Use `routes` for static or parameterized routes and `fetch` for the fallback handler. WebSocket upgrades attach server-defined data to the socket; validate it before use.

Outbound HTTP uses Web `fetch()`. Check `response.ok` or the expected status before parsing a success body.

HTTP/2 and HTTP/3 server support introduced in Bun 1.3.14 is experimental. Verify protocol negotiation and the real proxy/client route before enabling it in production.

## SQL

Create a connection, then use that connection as the tagged-template function:

```typescript
import { SQL } from "bun";
import { z } from "zod";

const Environment = z.object({ DATABASE_URL: z.string().url() });
const { DATABASE_URL } = Environment.parse(Bun.env);

const UserRow = z.object({ id: z.number().int(), email: z.string().email() });
const sql = new SQL(DATABASE_URL);

try {
  const rows = await sql`SELECT id, email FROM users WHERE active = ${true}`;
  const users = z.array(UserRow).parse(rows);
  console.log(users.length);
} finally {
  await sql.close();
}
```

Validate the connection URL before constructing the client. `new SQL(undefined)` does not throw — Bun falls back to implicit connection defaults — so a missing required `DATABASE_URL` silently connects to the wrong database instead of failing fast.

Do not call `Bun.SQL` itself as a query tag. Do not interpolate SQL fragments or identifiers as values. Use the documented helpers for bulk inserts and transactions rather than inventing a `prepare()` contract.

## Redis

Use the default `redis` export when one shared default connection matches the application. Use `new RedisClient(url)` for an explicit endpoint and close it with `.close()`.

```typescript
import { RedisClient } from "bun";
import { z } from "zod";

const Environment = z.object({ REDIS_URL: z.string().url() });
const { REDIS_URL } = Environment.parse(Bun.env);

const client = new RedisClient(REDIS_URL);
try {
  await client.set("health:last", new Date().toISOString());
} finally {
  client.close();
}
```

Validate the URL before constructing an explicit-endpoint client, same as `SQL`
above: `new RedisClient(undefined)` does not throw, it silently falls through
to Bun's default Redis connection instead of failing on a missing required
`REDIS_URL`.

Do not document `.connect(url)` or `.disconnect()` as the URL and lifecycle API.

## SQLite and S3

Use `bun:sqlite` for embedded databases and finalize statements or close databases when their lifecycle ends. Use `Bun.s3` for the environment-configured S3 client or construct `S3Client` for an explicit S3-compatible endpoint. Bound uploads and validate object keys, content types, and access policy.

## Cookies and CSRF

Bun exposes cookie parsing and serialization helpers. Configure `HttpOnly`, `Secure`, and `SameSite` according to the application's threat model.

CSRF token generation and verification must bind the token to session-specific data. A token that is not tied to the authenticated session can be replayed across users.

## Secrets

Bun's secrets API is experimental. Treat it as platform credential storage, not as a replacement for the deployed secret-management system, access controls, rotation, or audit logging.

## Cron

The cron API schedules callbacks in a running Bun process; OS cron support installs native schedules. Use them for work whose lifecycle matches that process or host. Use the repository's durable scheduler for distributed retries, history, and operator visibility.

## Primary documentation

- [HTTP server](https://bun.sh/docs/runtime/http/server)
- [WebSockets](https://bun.sh/docs/runtime/http/websockets)
- [Fetch](https://bun.sh/docs/api/fetch)
- [SQL](https://bun.sh/docs/runtime/sql)
- [Redis](https://bun.sh/docs/runtime/redis)
- [SQLite](https://bun.sh/docs/runtime/sqlite)
- [S3](https://bun.sh/docs/runtime/s3)
- [Secrets](https://bun.sh/docs/runtime/secrets)
- [Cookies](https://bun.sh/docs/runtime/cookies)
- [CSRF](https://bun.sh/docs/runtime/csrf)
- [Cron](https://bun.sh/docs/runtime/cron)
