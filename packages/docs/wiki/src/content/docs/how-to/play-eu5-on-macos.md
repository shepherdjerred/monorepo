---
title: Play EU5 on macOS
description: Launch Europa Universalis V and the Steam client on the hand-built Wine stack, recover the display after a crash, and rebuild the patched engine.
sidebar:
  order: 17
---

Europa Universalis V runs on macOS through a self-built Wine 11.16 engine under
`~/Applications/Wine-EU5`. This page is the operating manual. For why the stack
is shaped this way see [Running EU5 on macOS](/explanation/eu5-on-macos/); for
exact versions, paths, and flags see
[the EU5 Wine stack reference](/reference/eu5-wine-stack/).

## Play the game

Double-click `EU5.app` in `~/Applications/Wine-EU5`, or run the launcher:

```sh
~/Applications/Wine-EU5/play-eu5.command
```

The launcher starts Steam headless (it auto-logs-in from the saved token),
switches the built-in display to its notch-excluded mode, launches EU5 on Vulkan,
and restores the display when the game exits. Steam, cloud saves, and Workshop
are all live through the running client while you play.

The first launch after a reboot spends up to a minute bringing Steam up before
the game window appears; that is normal.

## Open just the Steam client

To browse the store, manage Workshop subscriptions, or check downloads without
starting the game:

```sh
~/Applications/Wine-EU5/steam.command
```

The client window renders fully (store, library, friends). One known cosmetic
limit: the store tab's article thumbnails stay dark. The library — which is what
matters for launching and Workshop — is clean.

## The one rule

Never launch Steam from the old CrossOver install. It shares your account, and
each CrossOver login rotates the refresh token and locks the Wine install out
(the symptom is an `Access Denied` on next launch). Use only `play-eu5.command`
and `steam.command`. If the token ever does get invalidated, sign in once through
`steam.command`'s window to refresh it.

## Recover the display after a crash

The launcher restores your normal resolution when EU5 quits. If the game or the
launcher is force-killed, the built-in display can be left in the shorter
notch-excluded mode. Restore it with:

```sh
~/Applications/Wine-EU5/notch-restore.command
```

This is a no-op if the display is already normal or if you are on an external
monitor.

## Subscribe to Workshop mods

Workshop content downloads through the running Steam client. Subscribe either
from the client's Workshop pages (via `steam.command`) or from
`steamcommunity.com` in any browser — the running client picks up the
subscription and downloads it. Mods then appear in EU5's launcher.

## Rebuild the patched engine

The engine is prebuilt and committed to `~/Applications/Wine-EU5/runtime-1116`.
Rebuild it only after a macOS or toolchain change breaks it. The build needs the
toolchain (`brew install bison flex meson ninja mingw-w64 pkgconf`) and an
x86_64 LLVM 15 for DXMT's shader compiler.

1. Fetch and verify the Wine 11.16 source, apply the winemac patches from
   `~/Applications/Wine-EU5/build/scripts`, and build `ntdll.so` plus the patched
   `winemac.so` (unix side, x86_64).
2. Build the patched DXMT `winemetal.so` and its Direct3D DLLs from the DXMT
   v0.80 source with the remote-layer patch.
3. Swap the patched `winemac.so` and `winemetal.so` into a fresh Gcenx Wine 11.16
   runtime, install the DXMT DLLs into the prefix scoped to the web-helper, and
   confirm the font-backend rpath is present on `win32u`, `dwrite`, `crypt32`,
   and `secur32`.

The exact commands, patch names, and verification checks are recorded in the
build notes under `~/Applications/Wine-EU5/build`; the
[reference page](/reference/eu5-wine-stack/) lists the version pins.

## Verify a change

After any change to the engine or launchers, confirm the whole path still works:

- EU5 reaches its main menu and a campaign loads.
- The Steam client library renders with text.
- A save syncs (Steam's cloud log shows `PerformSyncCloud - all sync'd up`).
- Fullscreen on the built-in display clears the notch, and the resolution
  restores after quitting.

## Related

- [Running EU5 on macOS](/explanation/eu5-on-macos/) — why the stack looks like this
- [EU5 Wine stack reference](/reference/eu5-wine-stack/) — versions, paths, flags
