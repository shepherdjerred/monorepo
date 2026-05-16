# eza & bat Reference Guide

## eza - Modern ls (Maintained Fork of exa)

**Important**: eza is the actively maintained fork of exa. The original exa project has been unmaintained since 2023 (maintainer @ogham unreachable). Use **eza** for latest features and bug fixes.

### What's New in eza v0.23.0+ (July 2025)

- **Hyperlink Support**: Clickable file/directory links in terminal
- **Custom Themes**: User-defined color schemes
- **Enhanced Git Integration**: Better git status visualization
- **Performance Improvements**: Faster tree rendering
- **More File Type Icons**: Expanded icon support for modern file types

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

### Advanced Features (v0.23.0+)

```bash
# Git status integration (enhanced in v0.23)
eza -l --git

# Hyperlinks (clickable in compatible terminals)
eza -l --hyperlink

# Custom theme
eza -l --color-scale

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

### Git Integration (2025)

bat now includes enhanced Git integration showing changes in the sidebar:

```bash
# View file with Git changes
bat modified-file.js
# Shows:
# + for line additions (green plus sign in left margin)
# ~ for line modifications (yellow tilde in left margin)
# Unchanged lines have no symbol

# Compare with git diff
git diff file.js | bat --language diff

# View staged changes
git diff --staged file.js | bat -l diff
```

**Benefits of Git Integration:**

- Visual indicators for all changes
- No need to run `git diff` separately
- Works automatically with any Git repository
- Color-coded for easy scanning

### Integration with Other Tools

```bash
# Use bat as previewer for fzf
fzf --preview 'bat --color=always {}'

# Use bat with ripgrep (batgrep)
rg -l "pattern" | xargs bat

# View git show output
git show HEAD:file.js | bat -l js

# View git diff with syntax highlighting
git diff | bat -l diff

# Use bat as MANPAGER
export MANPAGER="sh -c 'col -bx | bat -l man -p'"
man ls  # Beautiful manual pages

# Tail with syntax highlighting
tail -f /var/log/app.log | bat --paging=never -l log
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
