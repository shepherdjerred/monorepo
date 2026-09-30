---
title: Manage the Steam Deck game library
description: Add non-Steam games with artwork to both Steam profiles using Steam ROM Manager, hand-managed entries, and per-profile verification.
sidebar:
  order: 43
---

Non-Steam games reach the Deck's Game Mode library through Steam ROM Manager
(SRM) for ROMs and Steam-managed entries, plus hand-written `shortcuts.vdf`
entries for ports and launchers. Both Steam profiles on the Deck get the same
set.

## Snapshot both profiles

Each Steam profile owns one shortcuts file. Replace the placeholders below
with the profile IDs from `~/.local/share/Steam/userdata/` before running commands.

| Profile   | Userdata ID      |
| --------- | ---------------- |
| Profile A | `<PROFILE_A_ID>` |
| Profile B | `<PROFILE_B_ID>` |

List entries without opening Steam:

```bash
python3 -c "
import re
for uid in ('<PROFILE_A_ID>', '<PROFILE_B_ID>'):
    data = open('/home/deck/.local/share/Steam/userdata/%s/config/shortcuts.vdf' % uid, 'rb').read()
    for m in re.finditer(rb'\x00(\d+)\x00\x02appid\x00(.{4})\x01appname\x00([^\x00]*)\x00', data):
        print(uid, m.group(1).decode(), int.from_bytes(m.group(2), 'little', signed=True), '|', m.group(3).decode(errors='replace')[:60])
"
```

## Quit Steam before any write

SRM saves and every `shortcuts.vdf` edit require Steam fully exited. In Desktop
Mode use Steam → Exit, then confirm with `pgrep -x steam`. Saving while Steam
runs drops categories and can discard entries.

## Run the SRM pass on the Deck display

SRM needs a display; its CLI fails headless with no X server. Enable exactly
one parser per system to avoid duplicates. Exclude unwanted titles with the
Exception Manager rather than rewriting a parser.

1. Open Steam ROM Manager from `~/Emulation/tools/`.
2. Enable the parsers for systems that have ROMs, plus Non-SRM Shortcuts for
   artwork on hand-managed entries.
3. Preview → Parse. Confirm the app list and the artwork for every entry.
4. Quit Steam, click Save apps to Steam, relaunch Steam.

Missing artwork with axios errors means the SteamGridDB fetch failed. Check the
network first; a free SteamGridDB key entered in SRM settings is the fallback.

## Keep the hand-managed entries

Ports, recompilations, and launchers are not ROMs, so SRM parsers do not own
them. SRM only manages their art. Edit them with a byte-exact
`shortcuts.vdf` parser that asserts a clean re-encode round-trip before
writing, and back up both files first.

| Title                               | Target                              | Launch options                                              |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| Dusklight (English, profile A only) | `~/Applications/Dusklight.AppImage` | `--mods ~/Games/dusklight-mods-empty "<RVZ>"`               |
| Dusklight (Chinese, profile B only) | `~/Applications/Dusklight.AppImage` | `"<RVZ>"`                                                   |
| Ocarina of Time port                | `~/Downloads/OOT/*.appimage`        | empty                                                       |
| Majora's Mask port                  | `~/Downloads/MM/*.appimage`         | empty                                                       |
| Minecraft                           | `flatpak`                           | `"run" "org.prismlauncher.PrismLauncher" "--launch" "26.2"` |

`<RVZ>` is the GameCube Twilight Princess image under `~/Emulation/roms/gc/`.
It is Dusklight's base asset and never a library entry of its own.

New appids follow Steam's rule: `crc32(exe + appname)` with the top bit set,
verified against an existing entry before use. Identical entries share one
appid across both profiles, matching how SRM writes Wii U entries. Art files
live per profile at `userdata/<id>/config/grid/` under that appid.

Dusklight auto-activates every `.dusk` in its shared mods dir. The English
entry must therefore point at an empty `--mods` directory, or it boots
Chinese too. Both entries share one save.

## Verify both profiles

Re-run the snapshot and confirm identical title sets. Confirm art per appid in
each profile's `grid/` dir, including the capsule files `<appid>.png` and
`<appid>p.png` — they carry no underscore, so a `^<appid>_` listing hides
them. Restart Steam after adding art files. Boot every entry from Game Mode
under both profiles, checking language where it matters.

## Related

- [EmuDeck Steam ROM Manager guide](https://emudeck.github.io/tools/steamos/steam-rom-manager/)
- [Steam ROM Manager docs](https://steamgriddb.github.io/steam-rom-manager/)
