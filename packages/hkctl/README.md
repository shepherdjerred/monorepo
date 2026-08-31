# hkctl

`hkctl` is a development-signed Mac Catalyst command-line app for inspecting
and organizing Apple HomeKit homes. It can list rooms and accessories, rename
rooms and accessories, assign accessories to rooms, and remove rooms or
accessories.

Apple does not expose HomeKit to ordinary macOS command-line executables. The
app therefore carries the `com.apple.developer.homekit` entitlement and must be
launched through LaunchServices. Running the executable inside `hkctl.app`
directly bypasses the app's privacy metadata and macOS terminates it.

## Prerequisites

- Xcode 26 or newer
- XcodeGen 2.46 or newer
- SwiftLint
- An Apple Developer team signed into Xcode with HomeKit enabled for
  `red.sjer.hkctl`

The team identifier is deliberately not committed. Export it only for the
build or smoke-test command that needs signing:

```bash
export HKCTL_DEVELOPMENT_TEAM="YOUR_TEAM_ID"
```

## Verify and build

```bash
bun run mac:format:check
bun run lint
bun run mac:build
bun run mac:test
bun run mac:app
HKCTL_DEVELOPMENT_TEAM="$HKCTL_DEVELOPMENT_TEAM" bun run mac:smoke
```

`bun run mac:verify` runs the complete sequence and therefore also requires
`HKCTL_DEVELOPMENT_TEAM`. The generated Xcode project, Info.plist,
entitlements, and build products are ignored; `project.yml` is their source of
truth.

## Commands

Build a signed app, then launch it through `open`:

```bash
xcodegen generate --spec project.yml
xcodebuild \
  -project hkctl.xcodeproj \
  -scheme hkctl \
  -configuration Debug \
  -destination 'platform=macOS,variant=Mac Catalyst,arch=arm64' \
  -derivedDataPath .build/xcode \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$HKCTL_DEVELOPMENT_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  build

APP=.build/xcode/Build/Products/Debug-maccatalyst/hkctl.app
open -n -W "$APP" --args list --json
cat /tmp/hkctl.out
```

Supported commands are:

```text
list
room rename <old> <new>
room remove <name>
accessory rename <old> <new> [--manufacturer <name>]
accessory rename --id <uuid> <new>
accessory assign <accessory> <room>
accessory assign --id <uuid> <room>
accessory remove <name>
accessory remove --id <uuid>
apply --file <request.json>
```

Global options can appear before or after the command:

- `--home <name>` selects an exact home name; the primary home is the default.
- `-o, --output <path>` changes the atomic output file from
  `/tmp/hkctl.out`.
- `--format text|json` or `--json` selects output format.
- `--apply` performs mutations. Without it, every mutation is a dry run.

All targets are resolved before the first mutation. Missing or ambiguous names
fail the entire preflight. If HomeKit rejects a mutation after application has
started, hkctl stops immediately and reports applied, failed, and not-run
operations separately.

Both text and JSON listings include each accessory's stable HomeKit UUID. Use
`--id <uuid>` (or `--id=<uuid>`) when names are duplicated; UUIDs are validated
and normalized before preflight. Name selectors remain available for concise
commands, and `--manufacturer` applies only to name-based renames.

## Batch requests

Batch JSON is versioned and uses the same operation model as the subcommands:

```json
{
  "version": 1,
  "home": "Home",
  "operations": [
    {
      "kind": "rename-room",
      "from": "Guest Room",
      "to": "Guest Bedroom"
    },
    {
      "kind": "assign-accessory",
      "id": "DD8CADC8-4576-50B8-8F34-D10A73393C9B",
      "room": "Office"
    }
  ]
}
```

The supported `kind` values are `rename-room`, `remove-room`,
`rename-accessory`, `assign-accessory`, and `remove-accessory`. A command-line
`--home` overrides the batch file's `home`. The request never controls whether
changes apply; `--apply` must still be present on the launch command.
Accessory operations require exactly one selector: the existing `name` (or
`from` for rename) field, or `id`. `manufacturer` cannot be combined with `id`.

## Safety notes

- `remove-accessory` unpairs the accessory. For a Scrypted HomeKit Secure
  Video camera, that also destroys the pairing and recording history. Dry-run
  output includes manufacturer, model, and reachability so the target can be
  checked before applying.
- Re-pairing requires mDNS reachability on the accessory's LAN and generally
  cannot be repaired remotely through Tailscale.
- The first launch shows the HomeKit privacy prompt. If loading times out,
  allow hkctl under System Settings and retry.
