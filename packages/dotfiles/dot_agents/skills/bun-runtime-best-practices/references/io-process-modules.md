# Bun I/O, processes, and modules

Read this when implementing file or binary I/O, subprocesses, shell pipelines, environment handling, modules, streams, hashing, or workers in Bun.

## File I/O

`Bun.file(path)` creates a lazy `BunFile`; read it with `.text()`, `.json()`, `.arrayBuffer()`, `.bytes()`, or `.stream()`. `Bun.write(destination, data)` accepts strings, blobs, buffers, typed arrays, responses, and files.

Relative string paths use the process working directory. Use `import.meta.dir` plus `node:path` for source-relative assets.

Use `node:fs/promises` for directory traversal, permissions, ownership, symbolic links, and operations not represented by Bun's whole-file APIs.

## Subprocesses and Bun Shell

`Bun.spawn([program, ...arguments])` avoids shell parsing. Always await `.exited`; a readable stdout does not imply success.

Bun Shell provides cross-platform pipelines and throws on a non-zero exit by default. Interpolated strings are escaped, but option injection is still possible when a called program interprets a value beginning with `-`. Use `--` when the program supports it, or validate the argument domain.

```typescript
import { $ } from "bun";

const revision = "HEAD";
const result = await $`git rev-parse --verify ${revision}`.text();
```

Do not add a catch handler that converts command failure into an empty result.

## Environment

`Bun.env`, `process.env`, and `import.meta.env` are aliases for environment access. Bun loads supported `.env` files automatically according to its documented precedence. TypeScript autocomplete does not validate deployment values; use a runtime schema.

Pass a complete environment intentionally to subprocesses. Spreading `Bun.env` forwards secrets, so prefer the minimum set when launching untrusted or third-party programs.

## Modules

Bun supports ESM and CommonJS. ESM is the clearer default for new code, but migration should follow package and consumer contracts. Extensionless imports and TypeScript extensions are supported by Bun; the repository's compiler and publishing setup decides which convention is correct.

Use the compatibility table for Node APIs. Bun's own documentation explicitly recommends `node:fs` and other Node modules for operations its native APIs do not cover.

## Binary data and streams

Web `ReadableStream`, `ArrayBuffer`, `Uint8Array`, `Blob`, `Request`, and `Response` are portable defaults. `Buffer` is supported and is appropriate at Node-compatible boundaries.

`Bun.peek(promise)` inspects a promise's current state synchronously. It is not a stream peeking API and must not be described as reading a stream without consuming it.

## Hashing and passwords

- `Bun.password.hash()` and `.verify()` support password hashing with Argon2 or bcrypt.
- `Bun.hash()` provides fast non-cryptographic hashes and may return a 64-bit `bigint` depending on the selected algorithm.
- Web Crypto and `node:crypto` provide cryptographic hashes, signatures, ciphers, and key management.

Never substitute a general fast hash for password hashing or a cryptographic digest.

## Workers

Workers follow Web Worker concepts with Bun-specific support. Worker termination behavior introduced during Bun 1.3 remains documented as experimental; test cleanup and termination on the pinned runtime before depending on it.

## Primary documentation

- [File I/O](https://bun.sh/docs/runtime/file-io)
- [Environment variables](https://bun.sh/docs/runtime/environment-variables)
- [Child processes](https://bun.sh/docs/runtime/child-process)
- [Bun Shell](https://bun.sh/docs/runtime/shell)
- [Module resolution](https://bun.sh/docs/runtime/modules)
- [Node.js compatibility](https://bun.sh/docs/runtime/nodejs-compat)
- [Binary data](https://bun.sh/docs/runtime/binary-data)
- [Streams](https://bun.sh/docs/runtime/streams)
- [Hashing](https://bun.sh/docs/runtime/hashing)
- [Utilities](https://bun.sh/docs/runtime/utils)
- [Workers](https://bun.sh/docs/runtime/workers)
