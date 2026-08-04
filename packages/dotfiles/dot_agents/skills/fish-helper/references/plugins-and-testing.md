# Fish plugins and testing

Read this when installing a plugin manager, selecting Fish plugins, or testing functions/configuration.

## Installation safety

Upstream quick installs sometimes pipe a mutable remote script into Fish. For automation, download a reviewed release or commit, verify it, and source the local file. Plugin installation runs third-party code and mutates Fish configuration/state.

Required plugin managers and tools should fail fast. Optional integrations may be conditional, but label them optional and keep their absence from changing required environment setup.

## Plugin scope

- Fisher is a small Fish plugin manager.
- nvm.fish supports current aliases such as `lts`, `latest`, `.nvmrc`, and `.node-version`; avoid hard-coding a stale Node major in generic guidance.
- fzf.fish requires current Fish/fzf and platform helpers and can conflict with other fzf plugins.
- Tide supplies a prompt; verify its current Fish compatibility rather than repeating stale README version prose.
- done, autopair.fish, and Oh My Fish have distinct platform and startup behavior; use them only when the project/user wants that functionality.

Avoid popularity and “zero overhead” comparisons without current measurements.

## Tests

Fishtape is one Fish-native test option. Test exact stdout, stderr, status, environment changes, and file effects. Keep required commands available; do not turn missing tools into silent skips.

Format/check scripts with `fish_indent --check` where supported by the installed Fish release, and execute representative interactive/noninteractive startup paths.

## Primary projects

- [Fisher](https://github.com/jorgebucaran/fisher)
- [nvm.fish](https://github.com/jorgebucaran/nvm.fish)
- [fzf.fish](https://github.com/PatrickF1/fzf.fish)
- [Tide](https://github.com/IlanCosman/tide)
- [done](https://github.com/franciscolourenco/done)
- [autopair.fish](https://github.com/jorgebucaran/autopair.fish)
- [Fishtape](https://github.com/jorgebucaran/fishtape)
- [Oh My Fish](https://github.com/oh-my-fish/oh-my-fish)
