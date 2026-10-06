# How to persist higher file limits

Install this boot configuration to give newly launched apps a soft open-file limit of at least 8,192.
It preserves the existing kernel file caps. Existing processes retain their inherited limits.

## Install or update

From this directory, validate and install the configuration:

```sh
/bin/bash install.sh --validate
sudo /bin/bash install.sh
```

The installer copies the helper and plist into root-owned system locations and loads the one-shot launchd job.
Repeat the install command after changing these source files. The macOS bootstrap also invokes this installer.
Ordinary chezmoi applies do not install this directory or request admin access.

Log out and back in, or reboot. Open a fresh terminal from the Dock and check:

```sh
launchctl limit maxfiles
/bin/zsh -c 'ulimit -Sn'
/bin/bash install.sh --check
```

The launchd and fresh-shell soft limits must both be at least 8,192.
In a new Codex chat, ask it to run `/bin/zsh -c 'ulimit -Sn'` and confirm the same result.
Repeat the Codex check after a normal daemon restart and after an updater replaces the daemon.

For temporary recovery before logging out, restart the daemon with a higher inherited limit:

```sh
/bin/zsh -c 'ulimit -S -n 8192 && /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex app-server daemon restart'
```

This interrupts active Codex chats. It does not change the limit inherited by an already-running updater.

## Diagnose a failed installation

Read the helper log and launchd status:

```sh
cat /var/log/com.jerred.maxfiles.log
launchctl print system/com.jerred.maxfiles
sysctl kern.maxfiles kern.maxfilesperproc
```

The job must report `last exit code = 0`. Its log records the launchd limits and preserved kernel caps.
If the current hard limit or kernel per-process ceiling is below 8,192, installation fails without raising that ceiling.
If a fresh Codex daemon still inherits 256, verify the fresh-login step before declaring the configuration effective.

## Remove

```sh
sudo /bin/bash install.sh --uninstall
```

Reboot to restore the system's default launchd limits. Removal retains the log for diagnosis.
