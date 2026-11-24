# `@shepherdjerred/test-postgres`

Shared local PostgreSQL 18 test harness for monorepo packages (`delivery`, `golink`, `media`, `scout-for-lol`, `tasknotes-server`, and `tracker`).

## Responsibilities

- **Disposable test cluster (`monorepo-test-pg/18`):** Stores test cluster state under `$XDG_CACHE_HOME/monorepo-test-pg/18` (`~/.cache/monorepo-test-pg/18` by default, `%LOCALAPPDATA%\monorepo-test-pg\18` on Windows, or `$TMPDIR/monorepo-test-pg/18` when running as `root`), completely isolated from Scout's durable local dev cluster (`~/.local/share/scout-for-lol/postgres/18`).
- **Single local postmaster (`127.0.0.1:5471` default) with `postmaster.pid` port discovery:**
  - When neither `LOCAL_TEST_PG_PORT` nor `SCOUT_PG_PORT` is set and `<dataDir>/postmaster.pid` names a live verified PostgreSQL 18 postmaster, `sharedPostgresPort()` and `ensureSharedPostgres()` automatically reuse that running port instead of colliding on `5471`.
  - When `LOCAL_TEST_PG_PORT` or `SCOUT_PG_PORT` is explicitly set to a different port than an active `<dataDir>/postmaster.pid`, `ensureSharedPostgres()` throws a diagnostic naming the active port and PID before `pg_ctl start` without disturbing the running server.
- **Strict scratch isolation (`TEST_POSTGRES_DATA_ROOT` and `XDG_CACHE_HOME`):**
  - `TEST_POSTGRES_DATA_ROOT` overrides the data root directly when set.
  - Setting `XDG_CACHE_HOME` restricts `managedPostgresDataRoots()` exclusively to `$XDG_CACHE_HOME/monorepo-test-pg/18` without falling back to `$HOME/.cache`, so concurrent agents or isolated test runs can pair `XDG_CACHE_HOME=$(mktemp -d)` with `LOCAL_TEST_PG_PORT=<free-port>` to boot a clean scratch cluster alongside an already-running host server.
- **Automatic WAL startup panic recovery:** Because the disposable test cluster runs with `fsync=off` and `full_page_writes=off` for speed, an unclean host stop can corrupt WAL checkpoints (`PANIC: could not locate a valid checkpoint record`). When `pg_ctl start` fails on a verified `.../monorepo-test-pg/18/pgdata` directory with no live postmaster holding `postmaster.pid` and a startup/WAL panic in `server.log`, the harness rotates `server.log` to `server.log.recovered`, deletes `pgdata`, re-runs `initdb`, and retries `pg_ctl start` once.
- **Cross-platform binary and process discovery:** Locates PostgreSQL 18 binaries via `POSTGRES_BIN_DIR`, `mise`, `PATH`, Homebrew, `/usr/lib/postgresql/*/bin`, and `C:\Program Files\PostgreSQL\*\bin`, and resolves process start times on both Unix (`ps -o lstart=`) and Windows (PowerShell `Win32_Process.CreationDate`).
- **Database ownership and safe sweeping:** Stamps every created database with `COMMENT ON DATABASE ... IS 'monorepo-test-owner/v1 {...}'` (while reading legacy `scout-test-owner/v1` records) and sweeps leaked `*_test_*` / `*_mig_*` databases whose same-host `(pid, processStart)` owner has exited and which have zero active connections (`SET lock_timeout = '250ms'`).
- **Two creation modes:**
  - `createTemplateTestDatabase` / `ensureTemplateDatabase`: Builds `<prefix>_template_<hash16>` once under a PostgreSQL session advisory lock (`pg_advisory_lock`), marks it `IS_TEMPLATE TRUE ALLOW_CONNECTIONS FALSE`, prunes stale templates older than 24 hours with zero connections, and clones `<prefix>_test_<uuid>`.
  - `createEmptyTestDatabase`: Creates an empty owned `<prefix>_mig_<uuid>` database on the shared server for partial-migration ceiling tests without spawning `initdb`.
