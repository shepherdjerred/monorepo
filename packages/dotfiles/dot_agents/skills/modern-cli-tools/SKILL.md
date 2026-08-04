---
name: modern-cli-tools
description: Safe, current usage of ripgrep, fd, bat, eza, fzf, zoxide, sd, jq, yq, hyperfine, delta, bottom, dust, duf, procs, btop, and tldr. Use when selecting or invoking modern Unix CLI tools, especially instead of fragile shell pipelines.
---

# Modern CLI Tools

Prefer a tool because its semantics fit the task, not because it is newer. Preserve filenames as data, use machine-readable output, validate empty selections, and never turn filenames into shell source.

## Current baseline

Verified 2026-08-03:

| Tool | Current release | Primary use |
| --- | --- | --- |
| ripgrep | 15.2.0 | Recursive text/regex search |
| fd | 10.4.2 | Filesystem path search |
| bat | 0.26.1 | Syntax-aware file viewing |
| eza | 0.23.5 | Interactive directory listing |
| fzf | 0.74.2 | Interactive fuzzy selection |
| zoxide | 0.10.0 | Frecency directory navigation |
| sd | 1.1.0 | Search/replace with regex or fixed strings |
| jq | 1.8.2 | JSON filtering/transformation |
| yq | 4.53.3 | YAML and structured-data transformation |
| hyperfine | 1.20.0 | Reproducible command benchmarking |
| delta | 0.19.2 | Git diff/pager rendering |
| bottom | 0.14.7 | Terminal process/system monitor (`btm`) |

Read [references/releases.md](references/releases.md) for the 34-page research ledger. Read [references/search-files-and-text.md](references/search-files-and-text.md) for ripgrep, fd, eza, bat, and sd semantics. Read [references/data-benchmarks-and-git.md](references/data-benchmarks-and-git.md) for jq, yq, hyperfine, and delta. Read [references/interactive-and-system-tools.md](references/interactive-and-system-tools.md) for fzf, zoxide, bottom/btop, dust, duf, procs, and tldr.

## Filename safety

Filenames can contain spaces, newlines, leading dashes, quotes, and shell metacharacters. Prefer:

- native `fd --exec` / `--exec-batch`,
- argv arrays in the current language/shell,
- NUL-producing and NUL-consuming options only when every pipeline stage supports them,
- `--` before path operands,
- machine-readable output instead of parsing decorated tables.

Do not interpolate `{}` into `sh -c`. Do not pipe newline-delimited paths into `xargs rm`, command substitution, or a shell loop that reparses text.

## ripgrep

```bash
rg 'pattern' src
rg --hidden --glob '!.git/**' 'pattern'
rg --count-matches 'pattern'
rg --multiline --multiline-dotall 'start.*end'
```

- `rg -c` counts matching lines; `--count-matches` counts occurrences.
- `-U` / `--multiline` permits matches across lines, but dot still excludes newline unless dotall is enabled.
- `-u` disables ignore rules but still omits hidden files; `-uu` includes hidden, and `-uuu` additionally searches binary data.
- `--no-ignore --hidden` searches the working tree, not Git history. Use Git history commands for commit history.

## fd

```bash
fd --absolute-path 'pattern' root
fd --full-path 'src/.+\.ts$'
fd --changed-within 2d
fd --type d --empty --exec rmdir -- {}
```

- `-p` means match against the full path, not print an absolute path; use `-a` / `--absolute-path` for output.
- `-S +1m` means greater than or equal to one MiB.
- `-c` is color control; use `--changed-within` and `--changed-before` for time filters.
- Native exec preserves argv and avoids shell injection.

## eza and bat

Use eza for interactive display, not as a parser input. `-h` enables the column header row. `--color-scale` color-scales age/size fields; it is not a custom-theme loader. Use documented theme or `EZA_COLORS` configuration.

Use bat for human viewing. In pipelines or scripts, disable decoration/color or use the underlying file directly so control sequences do not become data.

## sd

Current sd processes line by line by default. Use `-A` / `--across` for cross-line replacements, `-F` for fixed strings, `-p` for preview, and `--` before operands that can begin with `-`.

Review replacements before in-place mutation. Regex replacement syntax is not identical to every sed dialect.

## jq

```bash
jq -e -r '.items[]?.name' input.json
jq --arg name "$NAME" '.name = $name' input.json
jq --argjson config "$CONFIG_JSON" '.config = $config' input.json
```

- `-r` emits strings without JSON quoting.
- `-e` makes false/null/no-result affect exit status.
- `--arg` passes a string; `--argjson` parses JSON.
- Shell-quote jq programs so the shell does not consume `$`, brackets, or quotes.
- Slurp loads all inputs; streaming changes the data model. Consider memory before using either on large input.

## yq

This skill refers to Mike Farah's Go `yq`, not the separate Python wrapper with the same name.

```bash
yq eval '.services.api.image' compose.yaml
yq eval --inplace '.version = "2"' config.yaml
```

Treat in-place editing as a local mutation and inspect the diff. Configure input/output format when extension detection is ambiguous. Preserve null and missing-value semantics deliberately; YAML round trips can change representation.

## fzf

Fuzzy selection can return no value and can return text beginning with `-`. Capture the result without word splitting, validate cancellation/empty output, then pass it as one argument with `--` where supported.

Do not use `vim $(fzf)`, `cd $(...)`, or `git checkout $(...)`. Prefer shell arrays/read primitives or native NUL protocols.

## hyperfine

Replace invented performance numbers with a reproducible local benchmark:

```bash
hyperfine --warmup 3 --runs 20 \
  --export-json benchmark.json \
  'rg pattern corpus' \
  'grep -R pattern corpus'
```

Record tool versions, corpus, hardware, filesystem, cache state, warmup, and environment. Hyperfine commands run through a shell; do not interpolate untrusted input. A local result is not a universal speed or memory claim.

## Git delta

Configure delta as a Git pager through reviewed Git config. Side-by-side, navigation, line numbers, syntax themes, and pager environment all affect output. Do not feed decorated pager output into automation.

## System tools

- `btm` is bottom; `btop` is a different monitor.
- dust visualizes disk usage; duf summarizes filesystem space.
- procs presents process data; do not parse its human table for process control.
- tldr clients implement a specification and vary by language/version; verify the installed client.

Use system-native structured interfaces for destructive process/storage operations. A fuzzy human selection is not authorization to kill or delete without exact target resolution.

## Interactive aliases

Do not transparently alias `cat`, `ls`, `find`, or `grep` in automation: replacements are not CLI-compatible. Distinct interactive abbreviations/functions are fine when the user wants them.

Install through a trusted package manager or reviewed release artifact. Do not pipe a mutable installer into a shell. If Cargo installation is intentionally used, select the exact crate and use its locked package graph.

## Review checklist

- Verify the installed tool and release before using recent flags.
- Preserve filenames with native argv/NUL mechanisms and `--`.
- Distinguish ripgrep matching lines, occurrences, multiline, hidden, ignored, and binary semantics.
- Use fd absolute-path and time flags correctly.
- Keep human decoration out of machine pipelines.
- Use jq `-e`, typed args, and deliberate raw/slurp/stream behavior.
- Confirm the intended yq implementation before scripting.
- Validate fzf cancellation and exact selection.
- Benchmark a fixed corpus instead of repeating universal speed claims.
- Keep destructive process/file actions outside brittle text pipelines.
