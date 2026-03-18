---
app: Ghostty
icon: terminal.fill
color: "#1C1C1E"
website: https://ghostty.org
category: New in 1.2.0
---

- Enable `ssh-terminfo = true` in your config to automatically copy Ghostty's terminfo to remote machines when SSHing.
- Enable `ssh-env = true` to set the correct TERM environment variable on remote machines that lack the Ghostty terminfo.
- These opt-in features eliminate "unknown terminal" errors when connecting to servers that don't have Ghostty installed.
