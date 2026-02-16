# fzf, zoxide & sd Reference Guide

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
