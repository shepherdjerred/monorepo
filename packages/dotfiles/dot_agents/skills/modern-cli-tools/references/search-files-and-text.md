# Search, files, and text tools

Read this when using ripgrep, fd, eza, bat, or sd.

## ripgrep

Ripgrep follows ignore rules by default. Unlocking behavior is cumulative: one `-u` disables ignores, two include hidden files, three include binary searching. Multiline and dotall are separate controls. Use `--count-matches` for occurrences.

## fd

`--full-path` changes matching; `--absolute-path` changes printed paths. Native exec/batch forms preserve filenames and avoid injecting them into shell code.

## eza

Eza is a display tool. Use its documented JSON/structured alternative where one exists elsewhere rather than parsing colored columns. Themes use current eza configuration; `--color-scale` is field visualization.

## bat

Bat adds paging, syntax highlighting, line numbers, and decorations for humans. Use `--style=plain --color=never --paging=never` when its output must remain plain, or read the original file in automation.

## sd

sd 1.1 streams line by line. Cross-line replacement requires `--across`. Fixed strings avoid regex interpretation. Preview before in-place edits.

## Primary projects

- [ripgrep](https://github.com/BurntSushi/ripgrep)
- [fd](https://github.com/sharkdp/fd)
- [bat](https://github.com/sharkdp/bat)
- [eza](https://github.com/eza-community/eza)
- [sd](https://github.com/chmln/sd)
