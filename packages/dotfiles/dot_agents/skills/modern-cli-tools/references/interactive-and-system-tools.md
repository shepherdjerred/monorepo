# Interactive and system tools

Read this when using fzf, zoxide, bottom, btop, dust, duf, procs, or tldr.

## fzf

fzf outputs selected text and uses exit status for selection/cancellation. Preserve the exact value and validate empty output. Preview and execute bindings can run shell commands; never interpolate untrusted entries into source text.

## zoxide

Zoxide integrates with the current shell and tracks directory frecency. Initialize it using the shell-specific documented hook. Treat its database as user-local navigation history.

## Monitors and storage viewers

Bottom runs as `btm`; btop is separate. dust, duf, and procs optimize human presentation. Do not parse their decorated tables for deletion, kill, or capacity automation.

## tldr

The tldr project publishes pages and a client specification. Clients have independent releases and caches. Verify the installed client's update/offline syntax.

## Primary projects

- [fzf](https://github.com/junegunn/fzf)
- [zoxide](https://github.com/ajeetdsouza/zoxide)
- [bottom](https://github.com/ClementTsang/bottom)
- [btop](https://github.com/aristocratos/btop)
- [dust](https://github.com/bootandy/dust)
- [duf](https://github.com/muesli/duf)
- [procs](https://github.com/dalance/procs)
- [tldr](https://github.com/tldr-pages/tldr)
