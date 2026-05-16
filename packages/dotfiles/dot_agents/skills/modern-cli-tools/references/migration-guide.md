# Migration Guide & Advanced Usage

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
