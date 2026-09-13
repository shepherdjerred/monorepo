---
title: EU5 Wine stack
description: Versions, file layout, launch flags, and registry keys for the Europa Universalis V macOS setup under ~/Applications/Wine-EU5.
sidebar:
  order: 8
---

Lookup for the Europa Universalis V macOS setup. Rationale is in
[Running EU5 on macOS](/explanation/eu5-on-macos/); procedures are in
[Play EU5 on macOS](/how-to/play-eu5-on-macos/). Everything lives under
`~/Applications/Wine-EU5`.

## Versions

| Component       | Version / build                                              |
| --------------- | ------------------------------------------------------------ |
| Wine engine     | 11.16 (Gcenx base, self-built patched `winemac.so`)          |
| DXMT            | v0.80 + remote-layer patch (patched `winemetal.so`)          |
| MoltenVK        | 1.4.1 (bundled in the Gcenx runtime)                         |
| Game            | EU5, Steam app id `3450310` (1.3 "Pavia")                    |
| Fallback engine | Wine 11.13 (Gcenx, unused; kept as `Wine Devel.app` at root) |
| Patch source    | github.com/macgameport/cities-skylines-2-macos               |

## File layout

| Path (under `~/Applications/Wine-EU5`) | What it is                                             |
| -------------------------------------- | ------------------------------------------------------ |
| `runtime-1116/Wine Devel.app`          | The patched Wine 11.16 engine (the one in use)         |
| `clone/`                               | The Wine prefix (cloned from the CrossOver bottle)     |
| `clone/.../steamapps/`                 | The game files (~15 GB), moved out of the bottle       |
| `build/`                               | Clone of the macgameport repo (patches, shim src)      |
| `bin/notchmode`                        | Display-mode helper (source in `diag/notchmode.swift`) |
| `play-eu5.command`                     | Launch Steam + game, with notch switch/restore         |
| `steam.command`                        | Launch the Steam client only                           |
| `notch-restore.command`                | Manual display recovery                                |
| `EU5.app`                              | Double-click wrapper that runs `play-eu5.command`      |
| `Wine Devel.app`                       | Unused 11.13 fallback engine (removable)               |

## Run environment

The engine must run as the Windows user `crossover` so Steam's DPAPI-encrypted
refresh token decrypts:

- `WINEPREFIX=~/Applications/Wine-EU5/clone`
- `USER=crossover`
- Wine binaries: `runtime-1116/Wine Devel.app/Contents/Resources/wine/bin`
- Steam token: `clone/drive_c/users/crossover/AppData/Local/Steam/local.vdf`
  (`ConnectCache`)
- Game launch argument: `-vulkan`

## Steam client render flags

Injected into `steamwebhelper.exe` by the shim via the `SHIM_ARGS` environment
variable (Steam strips them from its own command line otherwise):

| Flag                         | Purpose                                             |
| ---------------------------- | --------------------------------------------------- |
| `--use-angle=vulkan`         | Route ANGLE to MoltenVK/Metal (D3D11 + GL fail)     |
| `--in-process-gpu`           | Keep the GPU swapchain in the browser process       |
| `--ignore-gpu-blocklist`     | Chromium blocklists the Wine GPU → software → black |
| `--enable-gpu-rasterization` | Complete the GPU path                               |

Steam is started with `-no-cef-sandbox -noverifyfiles`. `-noverifyfiles` is
required: the client CRC-checks its executables and would otherwise restore the
original web-helper over the shim. `steam.cfg` also carries
`BootStrapperInhibitAll=Enable`.

The shim replaces `steamwebhelper.exe` (original kept as
`steamwebhelper_real.exe`), size-padded to the original's byte count. Source:
`build/scripts/steamwebhelper-shim.c`.

## Registry keys (in the prefix)

DXMT's Direct3D DLLs are set to `native` **scoped to the web-helper only**, so
EU5's own Vulkan path is unaffected:

```
HKCU\Software\Wine\AppDefaults\steamwebhelper.exe\DllOverrides
  d3d11, d3d10core, dxgi, winemetal = native
```

The global `DllOverrides` must **not** carry these — a global `winemetal=native`
breaks EU5's launch.

## Display modes (built-in panel)

`bin/notchmode` targets the built-in display only; it is a no-op in clamshell or
on an external monitor.

| Mode                | Resolution                  | Use                        |
| ------------------- | --------------------------- | -------------------------- |
| Normal              | 1512×982 pt (3024×1964 @2×) | Everyday (notch-inclusive) |
| Notch-excluded twin | 1512×945 pt (3024×1890 @2×) | While playing (16:10)      |

Helper subcommands: `print` (emit current mode token), `notch-off` (switch to the
notch-excluded twin), `notch-on` (switch back to the notch-inclusive mode),
`restore <ptW ptH pixW pixH refresh>` (restore an exact saved mode). The launcher
saves the mode with `print`, calls `notch-off`, and restores via a shell `trap`.

## Related

- [Running EU5 on macOS](/explanation/eu5-on-macos/) — why the stack looks like this
- [Play EU5 on macOS](/how-to/play-eu5-on-macos/) — how to operate it
