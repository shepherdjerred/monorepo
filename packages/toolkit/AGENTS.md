# Toolkit constraints

Toolkit is the stable command surface for monorepo platform passthroughs and
repository-specific workflows. `README.md` owns the command and environment
reference.

## Passthroughs

- Platform commands preserve arguments, `--` boundaries, cwd, environment,
  stdio, exit code, and signals. Explicit user flags override defaults.
- Keep passthroughs thin. Do not reimplement a vendor CLI merely to add a
  default organization, repository, project, or profile.
- Missing executables return a clear failure. Never silently skip a required
  platform tool.
- Do not print tokens while diagnosing configuration or child environments.

## Repository workflows

- `pr health` compares local merge-tree, exact-head Buildkite, and GitHub
  metadata. Exact-head Buildkite wins over lagging status summaries.
- `deployed` keeps merge, image publication, catalog pin, ArgoCD state, running
  digest, and reachability as distinct evidence.
- `screenshot` owns the registered package/port and fails when the port is
  occupied; it must not capture an unrelated server.
- `discord` uses a private session daemon. Every write preserves an explicit
  guild/channel target and authorized payload.
- `history` is a private, rebuildable index. It returns bounded excerpts and
  never treats old conversation as current system truth.
- `pr asset` uploads only explicit files/directories and applies the documented
  retention/content-type behavior. Never upload private logs or secrets.
- `pr review` resolves provider findings with a visible audited reason; it must
  not silently edit review state.

Package-owned runtime skills under `skills/` are toolkit product assets, not
repository-discoverable agent configuration. Keep their paths and frontmatter
compatible with the loader.

```bash
bun run build
bun run typecheck
bun run test
bun run lint
```

When adding a command, update the README in the same change and test argument
forwarding, exit behavior, redaction, and the narrow happy path.
