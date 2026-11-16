# `@shepherdjerred/test-postgres`

Shared local PostgreSQL 18 test harness for monorepo packages (`delivery`, `media`, `scout-for-lol`, and `tracker`).

## Responsibilities

- **Single local postmaster (`127.0.0.1:5471` default):** Ensures one PostgreSQL 18 server per developer host or CI pod (`LOCAL_TEST_PG_PORT` or `SCOUT_PG_PORT` override), avoiding System V shared-memory exhaustion (`kern.sysv.shmmni = 32` on macOS) from per-test `initdb` + `pg_ctl` clusters.
- **Cross-platform binary and process discovery:** Locates PostgreSQL 18 binaries via `POSTGRES_BIN_DIR`, `mise`, `PATH`, Homebrew, `/usr/lib/postgresql/*/bin`, and `C:\Program Files\PostgreSQL\*\bin`, and resolves process start times on both Unix (`ps -o lstart=`) and Windows (PowerShell `Win32_Process.CreationDate`).
- **Database ownership and safe sweeping:** Stamps every created database with `COMMENT ON DATABASE ... IS 'monorepo-test-owner/v1 {...}'` (while reading legacy `scout-test-owner/v1` records) and sweeps leaked `*_test_*` / `*_mig_*` databases whose same-host `(pid, processStart)` owner has exited and which have zero active connections (`SET lock_timeout = '250ms'`).
- **Two creation modes:**
  - `createTemplateTestDatabase` / `ensureTemplateDatabase`: Builds `<prefix>_template_<hash16>` once under a PostgreSQL session advisory lock (`pg_advisory_lock`), marks it `IS_TEMPLATE TRUE ALLOW_CONNECTIONS FALSE`, prunes stale templates older than 24 hours with zero connections, and clones `<prefix>_test_<uuid>`.
  - `createEmptyTestDatabase`: Creates an empty owned `<prefix>_mig_<uuid>` database on the shared server for partial-migration ceiling tests without spawning `initdb`.
