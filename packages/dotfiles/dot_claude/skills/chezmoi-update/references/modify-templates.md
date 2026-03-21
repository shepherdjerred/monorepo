# Modify Template Inventory

All modify templates in the chezmoi dotfiles repo at
`/Users/jerred/git/monorepo/packages/dotfiles/`.

## Template Index

| Source Path | Target File | Format | Merge Strategy | Shared Template Dep |
|---|---|---|---|---|
| `modify_private_dot_claude.json.tmpl` | `~/.claude.json` | JSON/jq | bash + jq merge | `claude-mcp-servers.json.tmpl` |
| `dot_claude/modify_private_settings.json.tmpl` | `~/.claude/settings.json` | JSON/jq | bash + jq merge | None |
| `dot_gemini/modify_private_settings.json.tmpl` | `~/.gemini/settings.json` | JSON/jq | bash + jq merge | `claude-mcp-servers.json.tmpl` |
| `private_dot_cursor/modify_mcp.json.tmpl` | `~/.cursor/mcp.json` | JSON/jq | bash + jq merge | `claude-mcp-servers.json.tmpl` |
| `Library/Application Support/private_Claude/modify_claude_desktop_config.json.tmpl` | `~/Library/Application Support/Claude/claude_desktop_config.json` | JSON/jq | bash + jq merge | `claude-mcp-servers.json.tmpl` |
| `private_dot_aws/modify_config` | `~/.aws/config` | INI | chezmoi-native `fromIni`/`toIni` | None (uses 1Password) |
| `private_dot_codex/modify_config.toml` | `~/.codex/config.toml` | TOML | chezmoi-native `fromToml`/`toToml` | None |

## Shared Template Dependencies

The shared template `.chezmoitemplates/claude-mcp-servers.json.tmpl` is included by:

1. `modify_private_dot_claude.json.tmpl` (wraps in `{"mcpServers": ...}`)
2. `dot_gemini/modify_private_settings.json.tmpl` (wraps in `{"mcpServers": ...}`)
3. `private_dot_cursor/modify_mcp.json.tmpl` (wraps in `{"mcpServers": ...}`)
4. `Library/.../modify_claude_desktop_config.json.tmpl` (wraps in `{"mcpServers": ...}`)

Changes to this shared template affect ALL four files. Always run `chezmoi diff` (no path
args) after editing it.

## Pattern: JSON/jq Merge (Bash Script)

The most common pattern. The template is a bash script that:
1. Defines a `DESIRED` variable containing a JSON blob (rendered from Go template `dict` calls)
2. If stdin has content (existing file), merges with `jq -s '.[0] * .[1]'`
3. If no stdin (new file), outputs DESIRED as-is

```bash
#!/bin/bash
DESIRED='{{ dict "key1" "value1" "nested" (dict "a" true "b" false) | toPrettyJson }}'
if [ -s /dev/stdin ]; then
  jq -s '.[0] * .[1]' /dev/stdin <(echo "$DESIRED")
else
  echo "$DESIRED" | jq .
fi
```

**Merge semantics of `jq -s '.[0] * .[1]'`:**
- Keys in DESIRED (.[1]) overwrite same keys in existing (.[0])
- Keys only in existing are preserved (not deleted)
- Keys only in DESIRED are added
- Nested objects are recursively merged

**To update live-to-repo:** Edit the Go template `dict` calls inside the `DESIRED` variable.
The `dict` function takes alternating key-value pairs. Nested dicts use parenthesized `(dict ...)`.

Example — changing a value:
```
# Before (template wants model opus)
"model" "opus"

# After (match live which has no model key — remove the line)
# (simply delete the "model" "opus" line from the dict call)
```

## Pattern: Chezmoi-Native INI Modify

Uses `chezmoi:modify-template` directive, no bash script. Works directly in Go template:

```
{{- /* chezmoi:modify-template */ -}}
{{- $data := dict -}}
{{- if ne .chezmoi.stdin "" -}}
{{-   $data = fromIni .chezmoi.stdin -}}
{{- end -}}
{{ $data |
  setValueAtPath "profile myprofile.endpoint_url" "https://example.com" |
  setValueAtPath "profile myprofile.region" "us-east-1" |
  toIni -}}
```

**To update live-to-repo:** Edit, add, or remove `setValueAtPath` calls. Each call sets a
dotted path in the INI structure.

## Pattern: Chezmoi-Native TOML Modify

Same as INI but uses `fromToml`/`toToml`. Supports nested paths via `list`:

```
{{- /* chezmoi:modify-template */ -}}
{{- $data := dict -}}
{{- if ne .chezmoi.stdin "" -}}
{{-   $data = fromToml .chezmoi.stdin -}}
{{- end -}}
{{ $data |
  setValueAtPath "key" "value" |
  setValueAtPath (list "section" "subsection" "key") "value" |
  toToml -}}
```

**To update live-to-repo:** Edit, add, or remove `setValueAtPath` calls.

## Debugging

If `chezmoi diff` still shows changes after editing a template:

```bash
# See what chezmoi would produce
chezmoi cat ~/.target/file

# Compare with live
diff <(chezmoi cat ~/.target/file) ~/.target/file
```

For JSON/jq templates, test the jq merge locally:

```bash
# Simulate what the modify script does
echo '{"existing": true}' | jq -s '.[0] * .[1]' - <(echo '{"desired": true}')
```
