---
description: Modern Unix command alternatives - faster, more user-friendly tools for everyday tasks
when_to_use: When Claude is about to use legacy tools (find, grep, ls, cat, sed, du, df, ps) OR when user mentions fd, rg, eza, bat, or asks about faster alternatives
---

# Modern CLI Tools Agent

## Overview

This agent teaches modern alternatives to traditional Unix commands that are faster, more user-friendly, and feature-rich. These tools are written in Rust and other modern languages, providing significant performance improvements and better default behaviors.

## For Claude: Tool Selection Guidelines

**When performing file operations, ALWAYS prefer modern tools:**

- ❌ `find` → ✅ `fd` - Faster, simpler syntax, respects .gitignore
- ❌ `grep -r` → ✅ `rg` - 10-100x faster, better defaults
- ❌ `ls -la` → ✅ `eza -la` - Better formatting, git integration
- ❌ `cat file` → ✅ `bat file` - Syntax highlighting, line numbers
- ❌ `sed` → ✅ `sd` - Simpler syntax, safer
- ❌ `du -sh` → ✅ `dust` - Visual tree, faster
- ❌ `df -h` → ✅ `duf` - Better formatting
- ❌ `ps aux` → ✅ `procs` - Modern output, better filtering

**Before using legacy tools, check if modern alternatives are available.**

## Tool Comparison

| Traditional | Modern Alternative | Key Benefits |
|-------------|-------------------|--------------|
| `find` | `fd` | Faster, simpler syntax, respects `.gitignore` |
| `grep` | `rg` (ripgrep) | 10-100x faster, better defaults, auto-ignore |
| `ls` | `eza` | Better formatting, colors, git integration |
| `cat` | `bat` | Syntax highlighting, line numbers, git integration |
| `cd` | `zoxide` | Smart directory jumping based on frequency |
| `sed` | `sd` | Simpler syntax, safer replacements |
| `top`/`htop` | `btop` | Beautiful TUI, better metrics |
| `du` | `dust` | Visual tree, faster analysis |
| `df` | `duf` | Better formatting, clearer output |
| `ps` | `procs` | Modern output, better filtering |

## Installation

### macOS (Homebrew)
```bash
# Install all at once
brew install fd ripgrep eza bat fzf sd zoxide dust duf procs btop

# Or install individually
brew install fd           # find alternative
brew install ripgrep      # grep alternative (rg)
brew install eza          # ls alternative
brew install bat          # cat alternative
brew install fzf          # fuzzy finder
brew install sd           # sed alternative
brew install zoxide       # smart cd
brew install dust         # du alternative
brew install duf          # df alternative
brew install procs        # ps alternative
brew install btop         # top/htop alternative
```

### Linux (cargo - Rust package manager)
```bash
# Install Rust first
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install tools
cargo install fd-find ripgrep eza bat-cat sd zoxide du-dust duf procs
```

## fd - Modern Find

### Basic Usage

```bash
# Find files by name (case-insensitive by default)
fd readme

# Find with extension
fd -e md
fd -e js -e ts

# Find in specific directory
fd pattern ~/projects

# Find directories only
fd -t d config

# Find files only
fd -t f

# Find hidden files
fd -H config

# Exclude patterns
fd -E node_modules -E .git

# Execute command on results
fd -e jpg -x convert {} {.}.png
```

### Advanced Patterns

```bash
# Regex search
fd '^[A-Z].*\.md$'

# Show full path
fd -p src/components

# Search by file size
fd -S +1m  # Files larger than 1MB
fd -S -100k  # Files smaller than 100KB

# Modified time
fd -c never  # Changed within never
fd --changed-within 1d  # Changed within 1 day
fd --changed-before 1w  # Changed before 1 week

# Case sensitive
fd -s README

# Max depth
fd -d 3 config
```

### Common Use Cases

```bash
# Find all TypeScript files excluding node_modules
fd -e ts -E node_modules

# Find config files
fd -g '*config*'

# Find and delete empty directories
fd -t d -x sh -c 'rmdir {} 2>/dev/null'

# List all test files
fd test -e ts -e js

# Find large log files
fd -e log -S +100m
```

## rg (ripgrep) - Modern Grep

### Basic Usage

```bash
# Search for pattern
rg "TODO"

# Case insensitive
rg -i "readme"

# Whole word match
rg -w "config"

# Show line numbers (default)
rg "error"

# Show context (3 lines before and after)
rg -C 3 "function"

# Search specific file types
rg -t ts "interface"
rg -t md "# Heading"

# Exclude file types
rg -T js "pattern"

# Search hidden files
rg -. "secret"

# Search without ignoring (.gitignore)
rg -u "pattern"
```

### Advanced Patterns

```bash
# Regex search
rg '^\s*function\s+\w+'

# Multiple patterns (OR)
rg -e "error" -e "warning"

# Invert match (show non-matching lines)
rg -v "test"

# Count matches
rg -c "import"

# Show only filenames
rg -l "TODO"

# Show only matching parts
rg -o '\b[A-Z]{3,}\b'

# Replace (preview only)
rg "old" -r "new"

# Multiline search
rg -U 'function.*\{.*\}'
```

### Common Use Cases

```bash
# Find all TODOs in code
rg "TODO|FIXME|HACK"

# Find imports of a specific module
rg "import.*from.*'react'"

# Find function definitions
rg "function\s+\w+\s*\("

# Search in specific directories
rg "API_KEY" src/

# Find unused exports
rg -w "export" | rg -v "import"

# Case-insensitive search in markdown files
rg -i -t md "claude code"

# Find potential secrets (be careful!)
rg -i "(password|secret|api[_-]?key)\s*[:=]"

# Search git history
rg --no-ignore --hidden "sensitive_data"
```

## eza - Modern ls

### Basic Usage

```bash
# List files (basic)
eza

# Long format
eza -l

# All files including hidden
eza -a

# Long format with all files
eza -la

# Tree view
eza -T

# Tree with depth limit
eza -T -L 2

# Sort by time
eza -l --sort modified

# Sort by size
eza -l --sort size

# Reverse sort
eza -lr
```

### Advanced Features

```bash
# Git status integration
eza -l --git

# Show file headers
eza -lh

# Group directories first
eza -l --group-directories-first

# Show icons (with nerd fonts)
eza -l --icons

# Color scale for file ages
eza -l --color-scale

# Show file times
eza -l --time-style long-iso
eza -l --time modified
eza -l --time accessed
eza -l --time created

# Binary size units
eza -l --binary

# Show inode
eza -li

# Only directories
eza -lD

# Only files
eza -lf
```

### Common Use Cases

```bash
# Beautiful tree with git status
eza -T --git-ignore --icons

# Recently modified files
eza -l --sort modified -r | head -10

# Largest files in directory
eza -l --sort size -r

# Show all with git status and icons
eza -la --git --icons --group-directories-first

# Tree excluding node_modules
eza -T --ignore-glob "node_modules|.git"

# Quick overview with icons
eza -1 --icons
```

## bat - Modern cat

### Basic Usage

```bash
# Display file with syntax highlighting
bat README.md

# Display multiple files
bat file1.js file2.ts

# Display with line numbers
bat -n file.py

# Disable paging
bat -P config.json

# Show non-printable characters
bat -A file.txt

# Specify language
bat -l rust file.txt
```

### Advanced Features

```bash
# Display specific lines
bat -r 10:20 large-file.log

# Show git diff
bat --diff file.js

# Different theme
bat --theme="Dracula" file.md

# List available themes
bat --list-themes

# Plain output (no decorations)
bat -p file.txt

# Show decorations
bat --decorations=always file.js

# Style options
bat --style=numbers,grid file.py
bat --style=plain file.txt
```

### Common Use Cases

```bash
# Quick preview of markdown
bat README.md

# View logs with syntax highlighting
bat -l log application.log

# Compare files side by side (with diff)
diff -u old.js new.js | bat -l diff

# Paginated output for large files
bat large-file.json

# View JSON with highlighting
bat package.json

# Pipe with syntax
curl -s https://api.example.com | bat -l json

# Preview file before editing
bat config.yaml && vim config.yaml
```

## fzf - Fuzzy Finder

### Basic Usage

```bash
# Interactive file search
fzf

# Search and open in editor
vim $(fzf)

# Multi-select mode
fzf -m

# Preview files
fzf --preview 'bat --color=always {}'

# Search command history
history | fzf

# Search processes
ps aux | fzf

# Search git branches
git branch | fzf
```

### Integration with Other Tools

```bash
# Change directory interactively
cd $(fd -t d | fzf)

# Edit file interactively
vim $(fd -t f | fzf --preview 'bat --color=always {}')

# Git checkout branch
git checkout $(git branch -a | fzf)

# Kill process interactively
kill $(ps aux | fzf | awk '{print $2}')

# SSH to host
ssh $(cat ~/.ssh/config | grep "^Host " | awk '{print $2}' | fzf)
```

## zoxide - Smart cd

### Setup

```bash
# Install
brew install zoxide

# Add to shell (choose your shell)
echo 'eval "$(zoxide init bash)"' >> ~/.bashrc
echo 'eval "$(zoxide init zsh)"' >> ~/.zshrc
echo 'zoxide init fish | source' >> ~/.config/fish/config.fish
```

### Usage

```bash
# Jump to directory (after visiting once)
z projects

# Jump to directory with multiple matches
z doc

# Jump to subdirectory
z proj/my-app

# Interactive selection
zi

# Add directory manually
zoxide add /path/to/directory

# Remove directory
zoxide remove /path/to/directory

# Query scores
zoxide query --list
```

## sd - Modern sed

### Basic Usage

```bash
# Simple replacement
sd 'old' 'new' file.txt

# Regex replacement
sd '\d+' 'NUMBER' file.txt

# In-place editing
sd 'foo' 'bar' file.txt

# Preview changes
sd 'pattern' 'replacement' file.txt --preview

# Multiple files
sd 'old' 'new' *.txt

# Case insensitive
sd -f i 'pattern' 'replacement' file.txt
```

### Common Use Cases

```bash
# Rename variable across files
sd 'oldVarName' 'newVarName' **/*.ts

# Update import paths
sd "from './old'" "from './new'" src/**/*.js

# Fix common typos
sd 'teh' 'the' **/*.md

# Update version in files
sd 'version: \d+\.\d+\.\d+' 'version: 2.0.0' package.json

# Remove trailing whitespace
sd '\s+$' '' **/*.ts
```

## Combining Tools

### Powerful Workflows

```bash
# Find and edit files interactively
fd -t f | fzf --preview 'bat --color=always {}' | xargs -o vim

# Search code and preview results
rg -l "TODO" | fzf --preview 'rg -C 3 "TODO" {}'

# Find large files and review
fd -t f -S +1m | fzf --preview 'eza -l {} && bat {}'

# Search and replace across files
rg -l "old_pattern" | xargs sd "old_pattern" "new_pattern"

# Tree view of git modified files
eza -T $(git status --short | awk '{print $2}')

# Interactive git file selector
git diff --name-only | fzf --preview 'bat --color=always {}'

# Find and delete old files
fd -t f --changed-before 30d | fzf -m | xargs rm -i

# Quick directory navigation
cd "$(fd -t d | fzf)"
```

### Alias Suggestions

Add to your `.zshrc` or `.bashrc`:

```bash
# Override traditional commands (careful!)
alias cat='bat'
alias ls='eza'
alias find='fd'
alias grep='rg'

# Or use different names
alias c='bat'
alias l='eza -la --git --icons'
alias lt='eza -T --git-ignore'
alias f='fd'
alias g='rg'

# Useful combinations
alias preview="fzf --preview 'bat --color=always {}'"
alias tree="eza -T --git-ignore --icons"
alias lt2="eza -T -L 2 --git-ignore --icons"
alias lt3="eza -T -L 3 --git-ignore --icons"

# Interactive selections
alias vf='vim $(fzf --preview "bat --color=always {}")'
alias cdf='cd $(fd -t d | fzf)'
```

## Performance Comparisons

### Real-World Benchmarks

```bash
# Search large codebase
time grep -r "pattern" .     # ~30 seconds
time rg "pattern"             # ~1 second

# Find files
time find . -name "*.js"      # ~5 seconds
time fd -e js                 # ~0.5 seconds

# List directory tree
time tree -L 3                # ~2 seconds
time eza -T -L 3              # ~0.3 seconds
```

### Memory Usage

Modern tools are generally more memory efficient:
- `rg` uses less memory than `grep -r`
- `fd` is more memory efficient than `find`
- `bat` lazy-loads files for better memory usage

## Best Practices

### 1. Start with Safe Aliases

```bash
# Don't override immediately, use new names first
alias f='fd'
alias g='rg'
alias l='eza -la'
alias c='bat'

# After comfortable, then override
# alias find='fd'
# alias grep='rg'
```

### 2. Use Appropriate Tool for Task

```bash
# For simple tasks, traditional tools are fine
ls -la  # Quick listing

# For complex tasks, use modern tools
eza -la --git --icons --group-directories-first  # Detailed view
```

### 3. Leverage Ignore Files

```bash
# Modern tools respect .gitignore by default
rg "pattern"           # Ignores .gitignore
fd "file"              # Ignores .gitignore

# Disable when needed
rg -u "pattern"        # Search all files
fd -u "file"           # Search all files
```

### 4. Use Preview Functions

```bash
# Always preview before bulk operations
fd -e log -S +100m --exec-batch rm -i

# Use fzf for interactive selection
fd -e log | fzf -m --preview 'bat {}' | xargs rm -i
```

## Configuration Files

### bat Configuration

`~/.config/bat/config`:
```bash
--theme="Monokai Extended"
--style="numbers,grid,changes"
--paging=auto
--map-syntax "*.conf:INI"
```

### eza Configuration

Create aliases in shell config:
```bash
# ~/.zshrc or ~/.bashrc
export EZA_COLORS="uu=36:gu=37:sn=32:sb=32:da=34:ur=34:uw=35:ux=36:ue=36:gr=34:gw=35:gx=36:tr=34:tw=35:tx=36"
```

### fzf Configuration

`~/.fzf.zsh` or `~/.fzf.bash`:
```bash
export FZF_DEFAULT_OPTS='
  --height 40%
  --layout=reverse
  --border
  --preview "bat --color=always {}"
  --preview-window=right:60%
'

export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow --exclude .git'
```

## Troubleshooting

### Issue: Colors not showing

```bash
# Ensure terminal supports 256 colors
echo $TERM  # Should be xterm-256color or similar

# Force color output
bat --color=always file.txt
eza --color=always
```

### Issue: Icons not showing in eza

```bash
# Install a Nerd Font
brew tap homebrew/cask-fonts
brew install font-hack-nerd-font

# Configure terminal to use the font
# Then use:
eza --icons
```

### Issue: Tool not found

```bash
# Check installation
which fd
which rg
which eza

# Add to PATH if needed
export PATH="$HOME/.cargo/bin:$PATH"
```

## Migration Guide

### From find to fd

```bash
# Before
find . -name "*.js" -type f

# After
fd -e js

# Before
find . -name "test*" -not -path "*/node_modules/*"

# After
fd "^test" -E node_modules
```

### From grep to rg

```bash
# Before
grep -r "pattern" .

# After
rg "pattern"

# Before
grep -i "pattern" **/*.js

# After
rg -i -t js "pattern"
```

### From ls to eza

```bash
# Before
ls -la

# After
eza -la

# Before
ls -lt | head

# After
eza -l --sort modified -r | head
```

## When to Ask for Help

Ask the user for clarification when:
- Unsure which tool is best for their specific use case
- Need to perform complex regex transformations
- Working with very large files (>1GB)
- Custom configuration needed for their workflow
- Integration with existing scripts or tools
- Performance optimization for specific scenarios
