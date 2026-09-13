---
name: bun-runtime-best-practices
description: Bun runtime APIs and current operational patterns for files, processes, modules, networking, databases, tests, and deployment. Use when writing or reviewing Bun-only TypeScript, selecting Bun versus Web or Node APIs, or migrating Node code to Bun.
---

# Bun Runtime Best Practices

Use Bun APIs when they provide a clear Bun-native capability. Use standard Web APIs for portability and `node:` APIs when Bun does not cover the operation or the code must remain Node-compatible. Do not replace a correct portable API merely because a Bun equivalent exists.

## Current baseline

Verified against Bun 1.3.14 on 2026-08-03. Check the project pin and runtime before relying on a newly added API:

```bash
bun --version
```

Bun 1.3.14 adds `Bun.Image`, faster isolated-linker warm installs, and experimental HTTP/2 and HTTP/3 server support. Features explicitly marked experimental in Bun's documentation are not stable defaults.

Read [references/release-notes-1.3.md](references/release-notes-1.3.md) when upgrading Bun or evaluating a new 1.3 API. Read [references/io-process-modules.md](references/io-process-modules.md) for detailed file, subprocess, shell, environment, module, stream, binary, hashing, and worker patterns. Read [references/data-networking.md](references/data-networking.md) for HTTP, WebSocket, SQL, Redis, SQLite, S3, cookies, CSRF, secrets, and cron guidance.

## Choose the narrowest correct API

| Need | Default | Why |
| --- | --- | --- |
| Read or write a whole file | `Bun.file()` / `Bun.write()` | Concise Bun-native blob and sink APIs |
| Directory traversal, permissions, links, metadata mutation | `node:fs/promises` | Bun documents Node file APIs for uncovered operations |
| Portable HTTP, streams, binary data | Web APIs | `fetch`, `Request`, `Response`, streams, and typed arrays work across runtimes |
| Spawn a program with known arguments | `Bun.spawn()` | Literal argv avoids shell parsing |
| Cross-platform shell pipeline | Bun Shell | Supports pipelines and escapes interpolated strings |
| Path manipulation | `node:path` | Handles separators and normalization correctly |
| Password hashing | `Bun.password` | Argon2 and bcrypt password-specific API |
| General cryptography | Web Crypto or `node:crypto` | Required for cryptographic hashes, signatures, ciphers, and key operations |
| Non-cryptographic hashing | `Bun.hash` | Fast checksums and hash tables; never passwords or signatures |

## Validate system boundaries

Environment variables, request bodies, database results, Redis values, and file JSON are untrusted input. Parse them before assigning domain types.

```typescript
import { z } from "zod";

const Environment = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
});

const environment = Environment.parse(Bun.env);
```

`Bun.env`, `process.env`, and `import.meta.env` expose the same environment. `Bun.env` does not make arbitrary variables statically safe; schema validation does.

## Files and paths

`Bun.file("relative/path")` resolves relative to the process working directory, not the current source file. Anchor source-relative resources explicitly.

```typescript
import { join } from "node:path";
import { z } from "zod";

const Config = z.object({
  name: z.string(),
  retries: z.number().int().min(0),
});

const configPath = join(import.meta.dir, "config.json");
const config = Config.parse(await Bun.file(configPath).json());
await Bun.write(join(import.meta.dir, "generated", "output.json"), JSON.stringify(config), {
  createPath: true,
});
```

Use `node:fs/promises` for directory and metadata operations that `Bun.file` and `Bun.write` do not model.

## Subprocesses

Prefer literal argv. Capture stderr and enforce the exit status before consuming output as successful.

```typescript
const process = Bun.spawn(["git", "status", "--short"], {
  cwd: import.meta.dir,
  stdout: "pipe",
  stderr: "pipe",
});

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(process.stdout).text(),
  new Response(process.stderr).text(),
  process.exited,
]);

if (exitCode !== 0) {
  throw new Error(`git status failed (${exitCode}): ${stderr}`);
}
```

Do not pass dynamic values through `sh -c`. Use `Bun.spawn()` argv or Bun Shell interpolation. Bun Shell escapes interpolated strings, but callers must still prevent option injection when user-controlled values can begin with `-`.

## Modules and compatibility

Prefer ESM for new Bun code, but do not claim CommonJS is unsupported. Bun supports both. Follow the repository's import-extension convention; Bun does not require `.ts` extensions universally.

Use `Buffer` when an API contract requires it. It is a supported `Uint8Array` subclass. Prefer `Uint8Array`, `ArrayBuffer`, `Blob`, and Web streams for portable new interfaces.

Check Bun's Node compatibility table before replacing or adopting a Node API. Compatibility is API-specific, not all-or-nothing.

## Servers and network clients

Use `Bun.serve()` for Bun-native HTTP or WebSocket servers and Web `fetch()` for outbound HTTP. Validate request data before use and make error paths explicit.

```typescript
const server = Bun.serve({
  port: environment.PORT,
  routes: {
    "/health": new Response("ok"),
  },
  fetch(request) {
    return new Response(`Not found: ${new URL(request.url).pathname}`, { status: 404 });
  },
});

console.log(`Listening on ${server.url}`);
```

HTTP/2 and HTTP/3 support added in Bun 1.3.14 is experimental. Do not make production compatibility claims without testing the deployed protocol, TLS, proxy, and client path.

## Data clients

Bun includes SQL, Redis, SQLite, and S3 clients. Their APIs are not interchangeable:

- Create a SQL connection with `new SQL(connectionString)` and execute parameterized queries with the connection's tagged template.
- Use `redis` for the default client or `new RedisClient(url)` for an explicit connection; close explicit clients with `.close()`.
- Use `bun:sqlite` for embedded SQLite and `Bun.s3` / `S3Client` for S3-compatible object storage.
- Parse database and cache values at the boundary; generated TypeScript types are not runtime validation.

See [references/data-networking.md](references/data-networking.md) for current examples and lifecycle details.

## Security rules

- Use `Bun.password` only for password hashing and verification. Its supported password algorithms are Argon2 and bcrypt; do not document scrypt as supported by this API.
- Use Web Crypto or `node:crypto` for cryptographic digests and signatures. `Bun.hash` is non-cryptographic.
- Bind CSRF tokens to a session identifier and verify them at mutation boundaries.
- Treat the secrets API and newly introduced protocol support according to their documented stability level.
- Never log secrets, full environment objects, authorization headers, or raw database URLs.

## Tests and scheduled work

Use the repository's existing test command. Current Bun test capabilities include process isolation, parallel execution, sharding, and changed-file selection; choose flags deliberately so tests remain deterministic. Do not mask missing build artifacts with skipped tests.

Cron expressions schedule callbacks inside a running Bun process. OS cron support creates operating-system schedules. Neither is a durable distributed scheduler; use the system's established orchestration for retryable, observable production workflows.

## Review checklist

- Verify the project's pinned Bun version before using a recent API.
- Keep CWD-relative and module-relative paths distinct.
- Check every subprocess exit code and preserve stderr in failures.
- Validate environment, HTTP, file, cache, and database input.
- Use password and cryptographic hash APIs for their intended purposes.
- Close explicit SQL, Redis, file, worker, and server resources when their lifecycle ends.
- Mark experimental APIs and performance figures as conditional, not universal promises.
- Prefer focused Bun-native APIs without banning supported Web or Node APIs.
