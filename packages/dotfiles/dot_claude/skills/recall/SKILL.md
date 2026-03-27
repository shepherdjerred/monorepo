---
name: toolkit-recall
description: Local RAG search across plans, research, memories, conversations, and fetched docs. Use toolkit fetch to save web pages and toolkit recall search to find them.
user-invocable: false
allowed-tools:
  - Bash
  - Read
---

# Toolkit Recall Skill

Local RAG system for searching across Claude plans, research, memories, fetched docs, and monorepo docs.

## When to Use

- **Before answering knowledge questions**: run `toolkit recall search "<query>"` to check if relevant context exists in plans, research, or previously fetched docs
- **When fetching docs or web pages**: use `toolkit fetch <url>` instead of raw `lightpanda fetch` — it saves and indexes the content for future search
- **When the user creates an important document**: run `toolkit recall add <path>` to index it
- **Periodically**: run `toolkit recall reindex` to pick up new files in watched directories

## Commands

### Fetch Web Pages

```bash
# Fetch a page (lightpanda, fast, handles SPAs)
toolkit fetch <url>

# Fetch with PinchTab CLI (real Chrome, for sites that block lightpanda)
toolkit fetch <url> --browser

# Verbose output (shows timing, engine, save path)
toolkit fetch <url> --verbose

# Crawl a docs site (coming soon)
toolkit fetch <url> --crawl --depth 2
```

Fetched pages are saved to `~/.recall/fetched/<domain>/<slug>.md` with YAML frontmatter.

### Search

```bash
# Hybrid semantic + keyword search
toolkit recall search "vector database embedding"

# Limit results
toolkit recall search "deployment" --limit 5

# Search mode: hybrid (default), semantic, keyword
toolkit recall search "query" --mode keyword
```

### Index Management

```bash
# Index a file or directory
toolkit recall add ~/Documents/notes/

# Remove from index
toolkit recall remove ~/Documents/notes/old-file.md

# Re-scan all watched directories
toolkit recall reindex

# Full re-index (re-embed everything, ignore content hashes)
toolkit recall reindex --full
```

### Status & Debugging

```bash
# Full dashboard: index stats, daemon health, performance
toolkit recall status

# Performance deep-dive (latency histograms, throughput)
toolkit recall status --perf

# Full diagnostic check
toolkit recall debug

# View logs
toolkit recall logs
toolkit recall logs --follow
toolkit recall logs --level error --since 1h
```

### Daemon

```bash
# Manage background watcher (auto-indexes on file changes)
toolkit recall daemon start
toolkit recall daemon stop
toolkit recall daemon status

# Run watcher in foreground (for testing)
toolkit recall watch
```

## Watched Directories

These are automatically indexed by the daemon and `toolkit recall reindex`:

| Directory | Source |
|-----------|--------|
| `~/.claude/plans/` | claude-plan |
| `~/.claude-extra/**` | claude-extra |
| `~/.claude/research/` | claude-research |
| `~/.claude/projects/*/memory/` | claude-memory |
| `~/.recall/fetched/**` | fetched |
| `~/.claude/projects/**` (*.jsonl) | claude-conversation |
| `~/git/monorepo/packages/docs/` | monorepo-docs |

## Troubleshooting

### "toolkit: command not found"

Install the binary:
```bash
cd ~/git/monorepo/packages/toolkit && ./install.sh
```

### Search returns no results

Check if the index has been built:
```bash
toolkit recall status
toolkit recall reindex
```

### Fetch returns empty content

Try PinchTab CLI for sites that block lightpanda:
```bash
toolkit fetch <url> --browser
```
