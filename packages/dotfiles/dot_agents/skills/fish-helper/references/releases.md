# Fish release lifecycle

Read this when upgrading Fish, adopting an API introduced after Fish 4.3, or checking a plugin compatibility claim.

## Current version

Fish 4.8.1 is current as of 2026-08-03. Important recent changes:

- 4.5: Vi-mode regressions and permanent removal of old terminfo behavior.
- 4.6: emoji width default 2, prompt environment controls, `set_color` additions, and `|&` support.
- 4.7/4.7.1: noninteractive theme initialization changes, sanitized prompt paths, and fish_config fixes.
- 4.8/4.8.1: `cd -L/-P`, binding source reporting, embedded install-layout changes, and input/completion fixes.

## Research ledger

The following 51 primary pages were fetched and inspected:

1. [Fish documentation](https://fishshell.com/docs/current/index.html)
2. [FAQ](https://fishshell.com/docs/current/faq.html)
3. [Interactive use](https://fishshell.com/docs/current/interactive.html)
4. [Language](https://fishshell.com/docs/current/language.html)
5. [Commands](https://fishshell.com/docs/current/commands.html)
6. [Fish for Bash users](https://fishshell.com/docs/current/fish_for_bash_users.html)
7. [Tutorial](https://fishshell.com/docs/current/tutorial.html)
8. [Completions](https://fishshell.com/docs/current/completions.html)
9. [Prompt](https://fishshell.com/docs/current/prompt.html)
10. [Design](https://fishshell.com/docs/current/design.html)
11. [Release notes](https://fishshell.com/docs/current/relnotes.html)
12. [Terminal compatibility](https://fishshell.com/docs/current/terminal-compatibility.html)
13. [set](https://fishshell.com/docs/current/cmds/set.html)
14. [abbr](https://fishshell.com/docs/current/cmds/abbr.html)
15. [complete](https://fishshell.com/docs/current/cmds/complete.html)
16. [function](https://fishshell.com/docs/current/cmds/function.html)
17. [functions](https://fishshell.com/docs/current/cmds/functions.html)
18. [funcsave](https://fishshell.com/docs/current/cmds/funcsave.html)
19. [funced](https://fishshell.com/docs/current/cmds/funced.html)
20. [bind](https://fishshell.com/docs/current/cmds/bind.html)
21. [read](https://fishshell.com/docs/current/cmds/read.html)
22. [status](https://fishshell.com/docs/current/cmds/status.html)
23. [source](https://fishshell.com/docs/current/cmds/source.html)
24. [emit](https://fishshell.com/docs/current/cmds/emit.html)
25. [fish_add_path](https://fishshell.com/docs/current/cmds/fish_add_path.html)
26. [string](https://fishshell.com/docs/current/cmds/string.html)
27. [string pad](https://fishshell.com/docs/current/cmds/string-pad.html)
28. [math](https://fishshell.com/docs/current/cmds/math.html)
29. [psub](https://fishshell.com/docs/current/cmds/psub.html)
30. [type](https://fishshell.com/docs/current/cmds/type.html)
31. [command](https://fishshell.com/docs/current/cmds/command.html)
32. [eval](https://fishshell.com/docs/current/cmds/eval.html)
33. [argparse](https://fishshell.com/docs/current/cmds/argparse.html)
34. [fish_config](https://fishshell.com/docs/current/cmds/fish_config.html)
35. [set_color](https://fishshell.com/docs/current/cmds/set_color.html)
36. [wait](https://fishshell.com/docs/current/cmds/wait.html)
37. [contains](https://fishshell.com/docs/current/cmds/contains.html)
38. [alias](https://fishshell.com/docs/current/cmds/alias.html)
39. [fish](https://fishshell.com/docs/current/cmds/fish.html)
40. [fish_indent](https://fishshell.com/docs/current/cmds/fish_indent.html)
41. [fish_key_reader](https://fishshell.com/docs/current/cmds/fish_key_reader.html)
42. [Fish website](https://fishshell.com/)
43. [Fish 4.8.1 release](https://github.com/fish-shell/fish-shell/releases/tag/4.8.1)
44. [Fisher](https://github.com/jorgebucaran/fisher)
45. [nvm.fish](https://github.com/jorgebucaran/nvm.fish)
46. [fzf.fish](https://github.com/PatrickF1/fzf.fish)
47. [Tide](https://github.com/IlanCosman/tide)
48. [done](https://github.com/franciscolourenco/done)
49. [autopair.fish](https://github.com/jorgebucaran/autopair.fish)
50. [Fishtape](https://github.com/jorgebucaran/fishtape)
51. [Oh My Fish](https://github.com/oh-my-fish/oh-my-fish)
