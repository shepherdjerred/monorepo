# hkctl — minimal Apple HomeKit CLI (Mac Catalyst)

Reads and mutates Apple Home state (rooms, accessory names, room assignments,
accessory/room removal) from the terminal, via `HMHomeManager`. Built during the
2026-07-09 HomeKit "great refresh" (see
`packages/docs/plans/…ha-registry-cleanup` / archive) as a self-owned
replacement for HomeClaw.

Apple ships no public HomeKit API for macOS: the only write path is the HomeKit
framework inside a UIKit/Mac Catalyst app carrying the
`com.apple.developer.homekit` entitlement, development-signed for this Mac.

## Build

Prereqs: Xcode (26+), XcodeGen (`brew install xcodegen`), an Apple Developer
team signed into Xcode (project.yml pins `DEVELOPMENT_TEAM: 63ZAG7X889`).

```bash
cd sandbox/poc/hkctl
xcodegen generate
xcodebuild -project hkctl.xcodeproj -scheme hkctl \
  -destination 'platform=macOS,variant=Mac Catalyst,arch=arm64' \
  -allowProvisioningUpdates -derivedDataPath ./build build
```

**One-time gotcha:** headless `xcodebuild -allowProvisioningUpdates` can
register the App ID but cannot add the HomeKit _capability_ to it. If the build
fails with `Entitlement com.apple.developer.homekit not found and could not be
included in profile`, open `hkctl.xcodeproj` in the Xcode GUI once (Signing &
Capabilities tab); the GUI session syncs the capability, after which headless
builds work.

## Run

```bash
APP=$(find build/Build/Products -name "hkctl.app" | head -1)
rm -f /tmp/hkctl.out /tmp/hkctl.cmd.json   # no command file = dump everything
open -W "$APP"
cat /tmp/hkctl.out                          # JSON home/room/accessory dump
```

- **Always launch via `open`, never the raw binary.** TCC attributes a raw
  binary launch to the parent terminal, which has no
  `NSHomeKitUsageDescription`, and the process crashes with SIGABRT. Launched
  via LaunchServices, the app itself is the responsible process; the first run
  shows a HomeKit permission prompt (click Allow once).
- Output goes to `/tmp/hkctl.out` (override with `HKCTL_OUT`); `open` doesn't
  propagate stdout.

## Mutations

Write `/tmp/hkctl.cmd.json` (override path with `HKCTL_CMD`) then `open -W` the
app. Every op supports `"dryRun": true` — always dry-run first.

```json
{
  "dryRun": true,
  "renameRooms": [["Guest Room", "Guest Bedroom"]],
  "renameAccessories": [
    ["Old Name", "New Name"],
    ["Ambiguous Name", "New Name", "ManufacturerToDisambiguate"]
  ],
  "assignRooms": { "Accessory Name": "Room Name" },
  "removeAccessories": ["Stale Tile"],
  "removeRooms": [""]
}
```

Results print as `OK` / `DRY` / `SKIP` / `NOOP` / `FAIL` lines followed by the
full post-mutation dump.

## Hard-won caveats

- **`removeAccessories` unpairs the accessory.** For natively-paired
  accessories (Scrypted HKSV cameras!) this destroys the pairing and any HKSV
  recording history. Verify what backs a tile before removing it — a tile that
  is `reachable: true` cannot be a dead bridge's orphan (this exact mistake
  unpaired the front-door camera on 2026-07-09 and forced an on-LAN re-pair).
- Re-pairing requires mDNS on the accessory's LAN — it cannot be done over
  Tailscale/remotely.
- Newer SDKs trap UIKit apps without scene-lifecycle adoption
  (`EXC_BREAKPOINT` in `…NoSceneLifecycleAdoption…`) — hence the SceneDelegate
  boilerplate.
- HomePod-internal accessories (e.g. `HomePodSensor …` in an unnamed room in
  the raw homed sqlite) are invisible to `HMHomeManager` and the Home app —
  not actionable, not a problem.
- Read-only auditing without this app: copy `~/Library/HomeKit/core.sqlite`
  (+`-wal`, `-shm`) and query `ZMKFACCESSORY` ⋈ `ZMKFROOM` on the copy.
