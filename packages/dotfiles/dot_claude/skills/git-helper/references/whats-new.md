# What's New in Git (2024-2026)

## Git 2.52 (2025)

- **`git last-modified`**: New command to determine which commit most recently modified each file in a directory (5.5x faster than ls-tree + log)
- **`git refs list` / `git refs exists`**: Consolidated reference operations
- **`git repo`**: Experimental command for retrieving repository information
- **`git maintenance` geometric task**: Alternative to all-into-one repacks
- **`git sparse-checkout clean`**: Recover from difficult checkout state transitions
- **Default branch change**: Git 3.0 will default to "main" instead of "master"
- **Rust integration**: Optional Rust code for variable-width integer operations
- **`git describe` 30% faster**, `git log -L` faster for merge commits

## Git 2.51 (2025)

- **Stash interchange format**: `git stash export` and `git stash import` subcommands for cross-machine stash migration
- **`--path-walk` repacking**: Significantly smaller pack files by emitting all objects from a given path simultaneously
- **Cruft-free multi-pack indexes**: 38% smaller MIDXs, 35% faster writes, 5% better read performance at GitHub
- **`git switch` / `git restore`**: No longer experimental after six years
- **`git whatchanged`**: Marked for removal in Git 3.0

## Git 2.50 (2025)

- **ORT merge engine**: Completely replaced the older recursive merge engine
- **`git merge-tree --quiet`**: Check mergeability without writing objects
- **`git maintenance` new tasks**: `worktree-prune`, `rerere-gc`, `reflog-expire`
- **Incremental multi-pack bitmap support**: Fast reachability bitmaps for extremely large repos
- **`git cat-file` object filtering**: Filter objects by type using partial clone mechanisms
- **Bundle URI**: Faster fill-in fetches by advertising all known references from bundles

## Git 2.49 (2025)

- **Name-hash v2**: Dramatically improved packing (fluentui: 96s to 34s, 439 MiB to 160 MiB)
- **`git backfill`**: Batch-fault missing blobs in `--filter=blob:none` partial clones
- **zlib-ng support**: ~25% speed improvement for compression
- **`git clone --revision`**: Clone specific commits without branch/tag references
- **`git gc --expire-to`**: Manage pruned objects by moving them elsewhere
- **First Rust code integration** via libgit-sys and libgit crates

## Git 2.48 (2025)

- **Faster checksums**: 10-13% performance improvement in serving fetches/clones using non-collision-detecting SHA-1 for trailing checksums
- **`range-diff --remerge-diff`**: Review merge conflict resolutions during rebase
- **Remote HEAD tracking**: Fetch auto-updates `refs/remotes/origin/HEAD` if missing; configure `remote.origin.followRemoteHead`
- **Meson build system**: Alternative build system alongside Make/CMake/Autoconf
- **Memory leak elimination**: Entire test suite passes with leak checking
- **`BreakingChanges.txt`**: Documents anticipated deprecations for future versions

## Git 2.47 (2024)

- **Incremental multi-pack indexes**: Layered MIDX chains for faster object addition
- **Separate hash function for checksums**: 10-13% serving performance improvement

## Git 2.46 (2024)

- **Pseudo-merge bitmaps**: Faster reachability queries
- **`git config list` / `git config get`**: New sub-command interface
- **Reftable migration**: `git refs migrate --ref-format=reftable` for faster reference operations
- **Enhanced credential helpers**: authtype/credential fields, multi-round auth (NTLM, Kerberos)

## Git 2.45 (2024)

- **Reftable backend**: New reference storage with faster lookups, reads, and writes

## Git 2.44 (2024)

- **Multi-pack reuse optimization**: Faster fetches and clones
- **`builtin_objectmode` pathspec**: Filter paths by mode
