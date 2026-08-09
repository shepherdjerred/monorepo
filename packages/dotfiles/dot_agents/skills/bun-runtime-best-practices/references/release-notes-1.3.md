# Bun 1.3 release lifecycle

Read this when upgrading Bun, adopting an API added during the 1.3 line, or checking whether an existing release claim is still current.

## Verified status

As of 2026-08-03, the current stable release is Bun 1.3.14, released 2026-05-13. Confirm the actual project pin with `bun --version`, `mise`, or the repository toolchain configuration before changing code.

## Notable 1.3 changes

| Release | Notable additions relevant to this skill |
| --- | --- |
| 1.3 | Unified SQL support, Redis client, full-stack development, isolated installs, executable improvements |
| 1.3.10 | REPL improvements, single-HTML-file applications, decorator support, Windows ARM progress |
| 1.3.11 | OS cron integration and ANSI utilities |
| 1.3.12 | WebView and Markdown APIs, cron additions, async-stack improvements |
| 1.3.13 | Test isolation, parallel execution, sharding, and changed-file selection |
| 1.3.14 | `Bun.Image`, isolated-linker warm-install improvements, experimental HTTP/2 and HTTP/3 |

Release posts describe capabilities, not universal performance guarantees. Preserve benchmark context, platform, workload, and version whenever quoting a number. Bun's current runtime overview reports a Linux Hello World comparison; it does not justify a blanket “8x startup” or fixed requests-per-second claim for every application.

## Adoption procedure

1. Read every release note between the project's current pin and the target.
2. Check the API reference for stability markers and lifecycle semantics.
3. Update the pinned toolchain and lockfile through the repository's normal version workflow.
4. Run focused build, typecheck, test, and lint tasks.
5. Exercise runtime-specific behavior on the deployed operating system and architecture.
6. Keep experimental features opt-in until their failure and rollback path is proven.

## Research ledger

The following 31 official pages were fetched and inspected for this refresh:

1. [Runtime overview](https://bun.sh/docs/runtime)
2. [File I/O](https://bun.sh/docs/runtime/file-io)
3. [Environment variables](https://bun.sh/docs/runtime/environment-variables)
4. [Child processes](https://bun.sh/docs/runtime/child-process)
5. [Bun Shell](https://bun.sh/docs/runtime/shell)
6. [Module resolution](https://bun.sh/docs/runtime/modules)
7. [Node.js compatibility](https://bun.sh/docs/runtime/nodejs-compat)
8. [Binary data](https://bun.sh/docs/runtime/binary-data)
9. [Streams](https://bun.sh/docs/runtime/streams)
10. [Hashing](https://bun.sh/docs/runtime/hashing)
11. [Utilities](https://bun.sh/docs/runtime/utils)
12. [HTTP server](https://bun.sh/docs/runtime/http/server)
13. [WebSockets](https://bun.sh/docs/runtime/http/websockets)
14. [Fetch](https://bun.sh/docs/api/fetch)
15. [SQL](https://bun.sh/docs/runtime/sql)
16. [Redis](https://bun.sh/docs/runtime/redis)
17. [SQLite](https://bun.sh/docs/runtime/sqlite)
18. [S3](https://bun.sh/docs/runtime/s3)
19. [Secrets](https://bun.sh/docs/runtime/secrets)
20. [Cookies](https://bun.sh/docs/runtime/cookies)
21. [CSRF](https://bun.sh/docs/runtime/csrf)
22. [Cron](https://bun.sh/docs/runtime/cron)
23. [Workers](https://bun.sh/docs/runtime/workers)
24. [Web APIs](https://bun.sh/docs/runtime/web-apis)
25. [Bun 1.3](https://bun.com/blog/bun-v1.3)
26. [Bun 1.3.14](https://bun.com/blog/bun-v1.3.14)
27. [Bun 1.3.13](https://bun.com/blog/bun-v1.3.13)
28. [Bun 1.3.12](https://bun.com/blog/bun-v1.3.12)
29. [Bun 1.3.11](https://bun.com/blog/bun-v1.3.11)
30. [Bun 1.3.10](https://bun.com/blog/bun-v1.3.10)
31. [Installation](https://bun.sh/docs/installation)
