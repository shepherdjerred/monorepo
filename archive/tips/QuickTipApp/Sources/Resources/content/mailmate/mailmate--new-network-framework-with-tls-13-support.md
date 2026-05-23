---
app: MailMate
icon: envelope.fill
color: "#2D6BE4"
website: https://freron.com
category: New in 2.0 Beta
---

- MailMate 2.0 beta added optional support for Apple's Network.framework as an alternative to the legacy CFNetwork stack.
- Network.framework enables TLS 1.3 connections to mail servers that require it.
- Enable it by running: defaults write com.freron.MailMate MmNetworkFrameworkEnabled -bool YES
