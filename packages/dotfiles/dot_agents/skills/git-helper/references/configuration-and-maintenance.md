# Git configuration and maintenance

Read this when changing Git configuration, hooks, credentials, maintenance, refs, garbage collection, or repository storage.

## Configuration provenance

Inspect value, scope, and origin:

```bash
git config --get --show-origin --show-scope <key>
git config --list --show-origin --show-scope
```

Use the `--get`/`--list` flag forms, not the newer `git config get`/`git config list` subcommand syntax — the subcommand form does not exist before Git 2.46.

Conditional includes are useful for identity and repository-family policy. Keep predicates narrow and test the effective value inside an affected repository.

Do not configure `merge=ours` and claim Git will always keep the current file. A merge driver, attributes, and merge semantics are separate concerns; verify the actual driver and intended policy.

## Ignored files

Use `git check-ignore -v <path>` to explain why a path is ignored. Do not rely on invalid combinations of `ls-files` flags copied from older skill text.

## Hooks

`core.hooksPath` may redirect all hook lookup. Inspect it with `git config --get core.hooksPath` before assuming `.git/hooks` is authoritative; do not assume that path is correct. `git hook list <hook-name>` (added in Git 2.54) prints the resolved hook chain for one named hook and requires that argument — it does not enumerate every hook. For a portable listing of what's actually installed, inspect the hooks directory directly: `ls -la "$(git rev-parse --git-path hooks)"`.

Hook scripts must quote filenames, propagate failures, and avoid blanket stderr suppression. Stage explicit paths; never stage the entire repository indiscriminately in automation.

## Credentials and URLs

Use credential helpers and `GIT_ASKPASS`. `git credential` is plumbing for approved helpers. `git url-parse` provides current URL parsing where supported; treat new subcommands as version-gated.

Never embed a token in a remote URL or persist one in a generated config file.

## References

The current `git refs` command provides consolidated ref operations such as list and exists. Use `git update-ref` for atomic scripted ref changes, including transactions. Do not edit files under `.git/refs` directly.

## Maintenance

Register background maintenance only when the host and repository lifecycle support it:

```bash
git maintenance register
git maintenance start
git maintenance run --task=commit-graph
git maintenance run --task=geometric-repack
```

`geometric-repack` is the task; `geometric` is a repack strategy. Use `git maintenance is-needed` on versions that support it. Do not assume incremental maintenance is always better; select tasks from repository size, fetch/write workload, and host scheduling.

## Object health and collection

`git fsck`, `git gc`, pack, multi-pack-index, commit-graph, and reflog expiry operate at different layers. Diagnose before collecting. Aggressive pruning can make reflog recovery impossible.

`git gc --auto` uses repository thresholds. `git pack-objects --path-walk` and newer pack/MIDX strategies are specialized optimization tools, not universal local defaults.

## Primary documentation

- [git-config](https://git-scm.com/docs/git-config)
- [githooks](https://git-scm.com/docs/githooks)
- [git-hook](https://git-scm.com/docs/git-hook)
- [git-credential](https://git-scm.com/docs/git-credential)
- [git-refs](https://git-scm.com/docs/git-refs)
- [git-update-ref](https://git-scm.com/docs/git-update-ref)
- [git-maintenance](https://git-scm.com/docs/git-maintenance)
- [git-gc](https://git-scm.com/docs/git-gc)
- [git-fsck](https://git-scm.com/docs/git-fsck)
- [git-pack-objects](https://git-scm.com/docs/git-pack-objects)
