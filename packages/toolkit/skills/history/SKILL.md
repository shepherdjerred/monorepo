---
name: history
description: Search local Conductor, Claude Code, Codex, Cursor, and OpenCode work history with toolkit.
---

# Local agent history

Use the local index for recollection and prior-work discovery. It is not a
deployment or CI status oracle.

## First-time setup

```bash
toolkit history daemon install
toolkit history daemon status
```

The daemon is a user-scoped macOS LaunchAgent. It polls the source stores every
30 seconds and writes only to `~/.toolkit/history/`. `daemon reindex` requests a
full scan; `daemon stop` unloads the job, and `daemon uninstall` also removes
the plist.

## Search recipes

```bash
# What did I work on last week?
toolkit history recent --since 7d

# Didn't I solve this before? Narrow first, then inspect one selected record.
toolkit history search "argocd prune" --since 90d
toolkit history show <ID_FROM_SEARCH> --query "argocd prune"

# Limit the search to one client or return structured output.
toolkit history search "ingress" --source conductor --json

# Check coverage before interpreting an empty result.
toolkit history sources
toolkit history daemon status --json
```

Supported sources are `conductor`, `claude`, `codex`, `cursor`,
`opencode-conductor`, and `opencode-standalone`. Search uses BM25 relevance;
recency only breaks ties. Unquoted terms are AND-prefix matches. To request an
exact phrase, preserve literal quotes in the query, for example
`toolkit history search '"Bryan Bucks"'`.

Search and recent hide the current Conductor/Codex run and group parallel
sessions that opened with the same normalized prompt. Use `--include-current`
or `--include-duplicates` to override those defaults. `--include-excerpts`
reopens only returned records and adds 360-character dialogue-first excerpts.

`show` is the normal second stage. By default it returns the opening request
plus latest dialogue, bounded to eight messages and 6,000 characters. With
`--query`, it centers on the best dialogue match and admits only matching tool
messages; `--include-tools` admits all nearby tools. System instructions,
reasoning, and compaction records are excluded. Cursor messages use `unknown`
because its flattened index has no roles. IDs are local to the current rebuild;
rerun search if an ID is missing.

Search JSON is `{ query, results, warnings }`, recent JSON is
`{ results, warnings }`, and show JSON is `{ record, messages, truncated }`.
Human-readable source warnings go to stderr. An unavailable source is silent in
an all-source query when it is merely uninstalled, but warns when explicitly
requested.

For “what is the current status?”, use history to find the relevant branch,
PR, or workspace, then verify the live state separately with `toolkit deployed`,
`toolkit pr health`, or the relevant system client. Do not infer merged,
deployed, reachable, or running state from a transcript.

## Privacy and failure boundaries

- The index is a rebuildable contentless FTS5 database at
  `~/.toolkit/history/index.sqlite`; the daemon socket, state, logs, and plist
  are user-private.
- Source SQLite databases and JSONL files are read-only. Schema changes are
  reported per source through `history sources`; they are not silently ignored.
- Standalone OpenCode `~/.local/share/opencode/auth.json` is credentials and is
  never read, printed, copied, indexed, or committed.
- Do not place transcript contents, index databases, daemon state, LaunchAgent
  files, or credentials in the repository or `.context/`.
