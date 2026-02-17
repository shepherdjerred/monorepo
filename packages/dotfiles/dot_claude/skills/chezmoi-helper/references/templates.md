# Chezmoi Templates Reference

## Go Template Syntax

Chezmoi uses Go's `text/template` package extended with sprig functions. Templates are processed when a file has a `.tmpl` suffix or resides in `.chezmoitemplates/`.

### Actions and Delimiters

Template actions are enclosed in `{{ }}`. Use `{{- }}` and `{{ -}}` to trim surrounding whitespace (left and right respectively).

```
{{ .chezmoi.hostname }}          # Output variable
{{- .chezmoi.hostname -}}        # Trim whitespace both sides
{{ /* This is a comment */ }}     # Comment (not rendered)
```

### Variables

Assign and use variables within templates:

```
{{ $hostname := .chezmoi.hostname }}
{{ $isDarwin := eq .chezmoi.os "darwin" }}
Host: {{ $hostname }}
```

### Pipelines

Chain functions with the pipe operator:

```
{{ .chezmoi.hostname | upper }}
{{ "hello world" | title | quote }}
{{ include "fragment.tmpl" . | indent 4 }}
```

## Conditionals

### if/else/end

```
{{ if eq .chezmoi.os "darwin" -}}
# macOS configuration
{{ else if eq .chezmoi.os "linux" -}}
# Linux configuration
{{ else -}}
# Default configuration
{{ end -}}
```

### Comparison Operators

| Operator | Meaning               |
| -------- | --------------------- |
| `eq`     | Equal                 |
| `ne`     | Not equal             |
| `lt`     | Less than             |
| `le`     | Less than or equal    |
| `gt`     | Greater than          |
| `ge`     | Greater than or equal |

### Boolean Logic

```
{{ if and (eq .chezmoi.os "linux") (eq .chezmoi.arch "amd64") -}}
# Linux AMD64 only
{{ end -}}

{{ if or (eq .chezmoi.os "darwin") (eq .chezmoi.os "linux") -}}
# Unix-like systems
{{ end -}}

{{ if not (eq .chezmoi.os "windows") -}}
# Non-Windows
{{ end -}}
```

### Nested Field Access

```
{{ if hasKey .chezmoi "osRelease" -}}
{{ if eq .chezmoi.osRelease.id "ubuntu" -}}
# Ubuntu-specific
{{ end -}}
{{ end -}}
```

## Range (Iteration)

```
{{ range .packages -}}
{{ . }}
{{ end -}}

{{ range $key, $value := .myMap -}}
{{ $key }}: {{ $value }}
{{ end -}}
```

## Chezmoi Template Variables

### System Variables

| Variable                | Description                | Example Values                          |
| ----------------------- | -------------------------- | --------------------------------------- |
| `.chezmoi.os`           | Operating system           | `darwin`, `linux`, `windows`, `freebsd` |
| `.chezmoi.arch`         | CPU architecture           | `amd64`, `arm64`, `arm`, `386`          |
| `.chezmoi.hostname`     | Hostname (up to first dot) | `macbook`, `server01`                   |
| `.chezmoi.fqdnHostname` | Full hostname              | `macbook.local`, `server01.example.com` |
| `.chezmoi.username`     | Current user               | `jerred`                                |
| `.chezmoi.uid`          | User ID                    | `501`                                   |
| `.chezmoi.gid`          | Group ID                   | `20`                                    |
| `.chezmoi.group`        | Group name                 | `staff`                                 |
| `.chezmoi.homeDir`      | Home directory             | `/Users/jerred`, `/home/jerred`         |

### Path Variables

| Variable                     | Description                             |
| ---------------------------- | --------------------------------------- |
| `.chezmoi.sourceDir`         | Source directory absolute path          |
| `.chezmoi.destDir`           | Destination directory (usually `~`)     |
| `.chezmoi.cacheDir`          | Cache directory path                    |
| `.chezmoi.configFile`        | Config file path                        |
| `.chezmoi.sourceFile`        | Current template's relative source path |
| `.chezmoi.targetFile`        | Current template's absolute target path |
| `.chezmoi.workingTree`       | Source directory working tree           |
| `.chezmoi.executable`        | Path to chezmoi binary                  |
| `.chezmoi.pathSeparator`     | `/` or `\`                              |
| `.chezmoi.pathListSeparator` | `:` or `;`                              |

### Version Variables

| Variable                   | Description            |
| -------------------------- | ---------------------- |
| `.chezmoi.version.version` | Chezmoi version string |
| `.chezmoi.version.commit`  | Git commit hash        |
| `.chezmoi.version.date`    | Build timestamp        |
| `.chezmoi.version.builtBy` | Builder identifier     |

### Linux-Specific Variables

```
{{ .chezmoi.osRelease.id }}           # "ubuntu", "fedora", "arch"
{{ .chezmoi.osRelease.idLike }}       # "debian" (for Ubuntu)
{{ .chezmoi.osRelease.versionID }}    # "22.04"
{{ .chezmoi.osRelease.name }}         # "Ubuntu"
{{ .chezmoi.kernel.ostype }}          # "Linux"
{{ .chezmoi.kernel.osrelease }}       # Kernel version
```

### Execution Variables

```
{{ .chezmoi.args }}                   # Command line arguments (array)
```

## Template Data Sources

Template data merges from multiple sources (later overrides earlier):

1. **Built-in `.chezmoi.*` variables** (always available)
2. **`.chezmoidata.$FORMAT` files** (read alphabetically: `.chezmoidata.json`, `.chezmoidata.toml`, `.chezmoidata.yaml`)
3. **Config file `[data]` section**

### .chezmoidata.yaml Example

```yaml
# ~/.local/share/chezmoi/.chezmoidata.yaml
email: user@example.com
git:
  name: "User Name"
  signingkey: "ABC123"
packages:
  - git
  - vim
  - tmux
machines:
  work:
    proxy: "http://proxy.corp.com:8080"
  home:
    proxy: ""
```

Access in templates: `{{ .email }}`, `{{ .git.name }}`, `{{ range .packages }}`.

### Config File Data Section

```toml
# ~/.config/chezmoi/chezmoi.toml
[data]
    email = "user@example.com"
    codespaces = false

[data.git]
    name = "User Name"
```

### View All Template Data

```bash
chezmoi data
chezmoi data --format=yaml
```

## Chezmoi Template Functions

### Data Conversion

| Function       | Description                 |
| -------------- | --------------------------- |
| `fromJson`     | Parse JSON string to object |
| `fromJsonc`    | Parse JSONC (with comments) |
| `fromToml`     | Parse TOML string           |
| `fromYaml`     | Parse YAML string           |
| `fromIni`      | Parse INI string            |
| `toJson`       | Convert to JSON string      |
| `toToml`       | Convert to TOML string      |
| `toYaml`       | Convert to YAML string      |
| `toIni`        | Convert to INI string       |
| `toPrettyJson` | Convert to indented JSON    |

### File and Path Operations

| Function   | Description                                     |
| ---------- | ----------------------------------------------- |
| `include`  | Include another file's contents                 |
| `glob`     | Match files by pattern                          |
| `stat`     | Get file info (size, mode, etc.)                |
| `lstat`    | Get file info (don't follow symlinks)           |
| `joinPath` | Join path components                            |
| `lookPath` | Find executable in PATH (returns path or empty) |
| `output`   | Run command and return stdout                   |
| `exec`     | Run command with exit code checking             |

### Text Processing

| Function           | Description                          |
| ------------------ | ------------------------------------ |
| `comment`          | Prefix each line with comment string |
| `replaceAllRegex`  | Replace regex matches                |
| `quoteList`        | Quote each element of a list         |
| `ensureLinePrefix` | Ensure lines have prefix             |
| `trimSuffix`       | Remove suffix from string            |
| `trimPrefix`       | Remove prefix from string            |

### Cryptographic

| Function    | Description       |
| ----------- | ----------------- |
| `decrypt`   | Decrypt data      |
| `encrypt`   | Encrypt data      |
| `hexEncode` | Hex-encode bytes  |
| `hexDecode` | Hex-decode string |
| `sha256sum` | SHA-256 hash      |

### GitHub Functions

| Function              | Description                   |
| --------------------- | ----------------------------- |
| `gitHubLatestRelease` | Get latest release for a repo |
| `gitHubLatestTag`     | Get latest tag                |
| `gitHubKeys`          | Get user's public SSH keys    |

### Init Functions (for `.chezmoi.toml.tmpl`)

| Function       | Description                  |
| -------------- | ---------------------------- |
| `promptString` | Prompt user for string input |
| `promptBool`   | Prompt for boolean           |
| `promptChoice` | Prompt with choices          |
| `promptInt`    | Prompt for integer           |
| `stdinIsATTY`  | Check if stdin is terminal   |

### JQ Integration

```
{{ output "curl" "-s" "https://api.example.com/data" | fromJson | jq ".items[0].name" }}
```

## Password Manager Functions

### 1Password

```
{{ onepassword "item-name" }}                          # Full item
{{ onepasswordRead "op://vault/item/field" }}          # Read specific field
{{ onepasswordDocument "document-uuid" }}               # Read document
{{ onepasswordDetailsFields "item-name" }}              # Detail fields
{{ onepasswordItemFields "item-name" }}                 # Item fields
```

### Bitwarden

```
{{ bitwarden "item" "item-id" }}
{{ bitwardenSecrets "secret-id" }}
{{ rbw "item-name" }}                                   # Bitwarden via rbw
```

### Pass

```
{{ pass "path/to/secret" }}
{{ passFields "path/to/secret" }}
```

### Vault (HashiCorp)

```
{{ vault "secret/data/myapp" }}
```

### Keyring (OS keychain)

```
{{ keyring "service" "user" }}
```

### Generic Secret Command

```
{{ secret "key" }}
{{ secretJSON "key" }}
```

## Reusable Templates (.chezmoitemplates)

Place template fragments in `.chezmoitemplates/` directory. Include them by relative path:

```
# In .chezmoitemplates/ssh-config-block.tmpl:
Host {{ .host }}
    User {{ .user }}
    IdentityFile ~/.ssh/{{ .key }}

# In dot_ssh/config.tmpl:
{{ template "ssh-config-block.tmpl" dict "host" "github.com" "user" "git" "key" "id_ed25519" }}
{{ template "ssh-config-block.tmpl" dict "host" "gitlab.com" "user" "git" "key" "id_ed25519" }}
```

### Passing Data to Templates

Pass the entire data context:

```
{{ template "fragment.tmpl" . }}
```

Pass a dictionary:

```
{{ template "fragment.tmpl" dict "key1" "value1" "key2" "value2" }}
```

Pass a single value:

```
{{ template "font-size.tmpl" 14 }}
```

## .chezmoiignore Templates

The `.chezmoiignore` file supports template syntax for OS-conditional ignoring:

```
README.md
LICENSE

{{ if ne .chezmoi.os "darwin" }}
Library/
{{ end }}

{{ if ne .chezmoi.os "windows" }}
AppData/
{{ end }}
```

## Debugging Templates

```bash
# Test template expression
chezmoi execute-template '{{ .chezmoi.os }}'

# Test template from file
chezmoi execute-template < ~/.local/share/chezmoi/dot_bashrc.tmpl

# View all available data
chezmoi data

# Diff before applying
chezmoi diff

# Dry run
chezmoi apply --dry-run --verbose
```

## Common Patterns

### OS-Conditional Includes

```
{{- if eq .chezmoi.os "darwin" -}}
{{-   include ".Brewfile_darwin" -}}
{{- else if eq .chezmoi.os "linux" -}}
{{-   include ".Brewfile_linux" -}}
{{- end -}}
```

### Guard with lookPath

Check if a tool exists before using its template function:

```
{{ if lookPath "op" -}}
export SECRET='{{ onepasswordRead "op://vault/item/field" }}'
{{ else -}}
# 1Password CLI not available
{{ end -}}
```

### Onchange Trigger via Hash Comment

Force `run_onchange_` scripts to re-run when a dependency changes:

```bash
#!/bin/bash
# {{ include "path/to/dependency" | sha256sum }}
# Script body runs when the dependency file changes
```

### Empty Template Skips Script Execution

A templated script that resolves to empty/whitespace-only content is not executed:

```
{{ if eq .chezmoi.os "darwin" -}}
#!/bin/bash
# macOS-only script body
{{ end -}}
```

### Modify Scripts with Template Output

Modify scripts receive existing file content on stdin and write the new content to stdout:

```python
#!/usr/bin/env python3
import sys, json
data = json.load(sys.stdin)
data["newKey"] = {{ template "values.json.tmpl" . }}
json.dump(data, sys.stdout, indent=2)
```

### Dynamic Binary Downloads

Use `gitHubLatestRelease` and OS/arch detection for dynamic binary URLs:

```
{{ $release := gitHubLatestRelease "cli/cli" -}}
{{ $version := trimPrefix "v" $release.TagName -}}
{{ $url := printf "https://github.com/cli/cli/releases/download/%s/gh_%s_%s_%s.tar.gz" $release.TagName $version .chezmoi.os .chezmoi.arch -}}
```

### Authorized SSH Keys from GitHub

Populate `~/.ssh/authorized_keys` from GitHub public keys:

```
{{ range gitHubKeys "username" -}}
{{ .Key }}
{{ end -}}
```

### Multi-Value Conditionals with switch

Go templates support `with` for scoped variables:

```
{{ with .chezmoi.os -}}
{{ if eq . "darwin" -}}
# macOS settings
{{ else if eq . "linux" -}}
# Linux settings
{{ end -}}
{{ end -}}
```

### Default Values with Sprig

Use sprig's `default` to provide fallback values:

```
{{ .myOptionalVar | default "fallback-value" }}
{{ .editor | default "vim" }}
```

## Sprig Functions Reference

Chezmoi includes the full sprig function library. Key categories:

### String Functions

| Function          | Description           | Example                                       |
| ----------------- | --------------------- | --------------------------------------------- |
| `trim`            | Remove whitespace     | `{{ " hello " \| trim }}`                     |
| `trimAll`         | Remove specific chars | `{{ trimAll "$" "$hello$" }}`                 |
| `upper`           | Uppercase             | `{{ "hello" \| upper }}`                      |
| `lower`           | Lowercase             | `{{ "HELLO" \| lower }}`                      |
| `title`           | Title case            | `{{ "hello world" \| title }}`                |
| `repeat`          | Repeat string         | `{{ repeat 3 "ha" }}`                         |
| `substr`          | Substring             | `{{ substr 0 5 "hello world" }}`              |
| `nospace`         | Remove whitespace     | `{{ nospace "h e l l o" }}`                   |
| `contains`        | Check contains        | `{{ if contains "ell" "hello" }}`             |
| `hasPrefix`       | Check prefix          | `{{ if hasPrefix "he" "hello" }}`             |
| `hasSuffix`       | Check suffix          | `{{ if hasSuffix "lo" "hello" }}`             |
| `quote`           | Wrap in quotes        | `{{ "hello" \| quote }}`                      |
| `squote`          | Single-quote          | `{{ "hello" \| squote }}`                     |
| `replace`         | Replace string        | `{{ replace "old" "new" .input }}`            |
| `regexMatch`      | Regex match           | `{{ if regexMatch "^[a-z]+$" .input }}`       |
| `regexReplaceAll` | Regex replace         | `{{ regexReplaceAll "[0-9]+" .input "NUM" }}` |
| `indent`          | Indent lines          | `{{ .content \| indent 4 }}`                  |
| `nindent`         | Newline + indent      | `{{ .content \| nindent 4 }}`                 |

### List Functions

| Function    | Description         | Example                       |
| ----------- | ------------------- | ----------------------------- |
| `list`      | Create list         | `{{ list "a" "b" "c" }}`      |
| `first`     | First element       | `{{ first .myList }}`         |
| `last`      | Last element        | `{{ last .myList }}`          |
| `rest`      | All but first       | `{{ rest .myList }}`          |
| `initial`   | All but last        | `{{ initial .myList }}`       |
| `append`    | Append element      | `{{ append .myList "d" }}`    |
| `prepend`   | Prepend element     | `{{ prepend .myList "z" }}`   |
| `concat`    | Concatenate lists   | `{{ concat .list1 .list2 }}`  |
| `has`       | Contains element    | `{{ if has "item" .myList }}` |
| `without`   | Remove elements     | `{{ without .myList "bad" }}` |
| `uniq`      | Unique elements     | `{{ .myList \| uniq }}`       |
| `sortAlpha` | Sort strings        | `{{ .myList \| sortAlpha }}`  |
| `join`      | Join with separator | `{{ join "," .myList }}`      |

### Dictionary Functions

| Function | Description       | Example                         |
| -------- | ----------------- | ------------------------------- |
| `dict`   | Create dictionary | `{{ dict "key" "value" }}`      |
| `get`    | Get value         | `{{ get .myDict "key" }}`       |
| `set`    | Set value         | `{{ set .myDict "key" "val" }}` |
| `hasKey` | Check key exists  | `{{ if hasKey .myDict "key" }}` |
| `keys`   | Get all keys      | `{{ keys .myDict }}`            |
| `values` | Get all values    | `{{ values .myDict }}`          |
| `merge`  | Merge dicts       | `{{ merge .dict1 .dict2 }}`     |
| `pick`   | Select keys       | `{{ pick .myDict "k1" "k2" }}`  |
| `omit`   | Exclude keys      | `{{ omit .myDict "k1" "k2" }}`  |

### Type Conversion Functions

| Function       | Description               |
| -------------- | ------------------------- |
| `toString`     | Convert to string         |
| `toInt`        | Convert to integer        |
| `toFloat64`    | Convert to float          |
| `toBool`       | Convert to boolean        |
| `toJson`       | Convert to JSON string    |
| `toPrettyJson` | Convert to formatted JSON |
| `toYaml`       | Convert to YAML           |
| `toToml`       | Convert to TOML           |

### Math Functions

| Function | Description    |
| -------- | -------------- |
| `add`    | Addition       |
| `sub`    | Subtraction    |
| `mul`    | Multiplication |
| `div`    | Division       |
| `mod`    | Modulo         |
| `max`    | Maximum        |
| `min`    | Minimum        |
| `ceil`   | Ceiling        |
| `floor`  | Floor          |
| `round`  | Round          |

### Date Functions

| Function     | Description  | Example                           |
| ------------ | ------------ | --------------------------------- |
| `now`        | Current time | `{{ now \| date "2006-01-02" }}`  |
| `date`       | Format date  | `{{ .date \| date "Mon Jan 2" }}` |
| `dateModify` | Modify date  | `{{ now \| dateModify "24h" }}`   |

### Encoding Functions

| Function | Description   |
| -------- | ------------- |
| `b64enc` | Base64 encode |
| `b64dec` | Base64 decode |
| `b32enc` | Base32 encode |
| `b32dec` | Base32 decode |

### OS Functions

| Function    | Description             | Example                       |
| ----------- | ----------------------- | ----------------------------- |
| `env`       | Read env variable       | `{{ env "HOME" }}`            |
| `expandenv` | Expand `$VAR` in string | `{{ expandenv "$HOME/bin" }}` |

## Complete Template Examples

### SSH Config with Multiple Hosts

```
# ~/.local/share/chezmoi/private_dot_ssh/config.tmpl
{{ range $host := list "github.com" "gitlab.com" "bitbucket.org" -}}
Host {{ $host }}
    User git
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes

{{ end -}}

{{ if eq .chezmoi.hostname "work-laptop" -}}
Host internal-git
    User {{ .chezmoi.username }}
    Hostname git.internal.corp.com
    IdentityFile ~/.ssh/id_work
    ProxyCommand ssh -W %h:%p bastion.corp.com
{{ end -}}
```

### Shell Profile with Conditional Tool Setup

```
# ~/.local/share/chezmoi/dot_profile.tmpl
export EDITOR="{{ .editor | default "vim" }}"
export LANG="en_US.UTF-8"

{{ if eq .chezmoi.os "darwin" -}}
eval "$(/opt/homebrew/bin/brew shellenv)"
{{ else if eq .chezmoi.os "linux" -}}
{{ if stat "/home/linuxbrew/.linuxbrew/bin/brew" -}}
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
{{ end -}}
{{ end -}}

{{ if lookPath "mise" -}}
eval "$(mise activate bash)"
{{ end -}}

{{ if lookPath "starship" -}}
eval "$(starship init bash)"
{{ end -}}
```

### JSON Config with Templated Values

```json
# ~/.local/share/chezmoi/dot_config/myapp/config.json.tmpl
{
  "version": 2,
  "hostname": {{ .chezmoi.hostname | toJson }},
  "os": {{ .chezmoi.os | toJson }},
  "paths": {
    "home": {{ .chezmoi.homeDir | toJson }},
    "data": {{ joinPath .chezmoi.homeDir ".local" "share" "myapp" | toJson }}
  }{{ if eq .machineType "work" }},
  "proxy": {{ .workProxy | toJson }}{{ end }}
}
```

### INI Config File with Sections

```ini
# ~/.local/share/chezmoi/dot_config/tool/settings.ini.tmpl
[general]
username = {{ .chezmoi.username }}
home = {{ .chezmoi.homeDir }}

{{ if eq .chezmoi.os "darwin" -}}
[macos]
keychain = true
browser = open
{{ else if eq .chezmoi.os "linux" -}}
[linux]
keychain = false
browser = xdg-open
{{ end -}}
```
