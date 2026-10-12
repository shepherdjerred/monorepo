---
title: Mac + Windows crossplay
description: Compatibility reference for Apple silicon Macs and Windows amd64 PCs playing multiplayer and Zombies together.
---

This section covers **MW2 multiplayer** and **Black Ops I, II, and III
multiplayer and Zombies**, with Apple silicon Macs and Windows x64 (amd64) PCs
in the same session. Each player needs the game and the selected maps.

## Choose your setup page

- [Windows setup](/docs/crossplay/windows/) — clients and Windows game walkthroughs.
- [macOS setup (Apple silicon)](/docs/crossplay/macos/) — Mac installation routes and limitations.
- [Play together](/docs/crossplay/play-together/) — shared joining steps and crossplay checks, after setup.

## Client compatibility

| Game             | Windows amd64       | Apple silicon macOS            |
| ---------------- | ------------------- | ------------------------------ |
| MW2 MP           | IW4x                | IW4x via Wine + Rosetta        |
| BO1 MP + Zombies | Plutonium T5        | T5 via CrossOver               |
| BO2 MP + Zombies | Plutonium T6        | T6 via CrossOver               |
| BO3 MP + Zombies | Steam BO3 + T7Patch | Steam BO3 + BO3MacFix, Rosetta |

**No row is a locally verified crossplay result.** Upstream instructions describe
a route; community reports are narrower evidence that depends on the game,
mode, client version, Mac model, and macOS release.

### Modern Warfare 2

IW4x publishes [Mac instructions](https://docs.iw4x.io/get-started/manual-install/macos-guide/)
for running its Windows client through Wine and Rosetta. The wrapper installation
names in that guide are older; the [macOS page](/docs/crossplay/macos/#modern-warfare-2)
explains the current wrapper project and the untested combination.

### Black Ops I and II

Plutonium's [official requirements](https://plutonium.pw/docs/system-requirements/)
cover Windows. Its [Mac discussion](https://forum.plutonium.pw/topic/17976/plutonium-on-macos/4)
includes an M2 CrossOver success report alongside crashes and a later BO2 failure.
[Older reports](https://forum.plutonium.pw/topic/9652/plutonium-bo2-waw-linux-tutorial/103?page=3)
mention T5/T6 running through CrossOver with mouse stuttering. These do not
establish current support for both modes on Apple silicon. The Mac route remains
**experimental**.

### Black Ops III

The [BO3MacFix installation guide](https://github.com/InvoxiPlayGames/BO3MacFix/wiki/Installing-BO3MacFix)
documents joining Windows T7Patch players with matching network passwords.
This section uses that Steam-based route. Compatibility with Ezz BOIII has not
been established, so BOIII is outside this mixed-platform setup.

An open [M4 match-loading report](https://github.com/InvoxiPlayGames/BO3MacFix/issues/71)
describes online login working while maps fail to start, including without the
patch. Test a base map on the intended Mac before adding Workshop content.

World at War remains an additional [Windows Zombies walkthrough](/docs/t4/).
Its Apple silicon compatibility has not been established here.
