# Brim signing and notarization

Use this runbook to produce the directly distributed Brim app. A complete
release is Developer ID signed, notarized by Apple, stapled, accepted by
Gatekeeper, and installed from the verified artifact.

## Prerequisites

- Run on macOS with the repository-pinned Bun and Swift toolchains, Xcode, and
  XcodeGen available.
- Sign in to the paid Apple Developer account under **Xcode Settings →
  Accounts**. Xcode owns account authentication and cloud-managed signing
  credentials.
- Keep the stable bundle identifier `com.sjerred.QuotaBar` registered for the
  account.
- Use the checked-in `Resources/Brim.icon` document as the app-icon source of
  truth. Xcode consumes it directly; `bundle:macos` uses the selected Xcode's
  bundled `ictool` to render the `Brim.icns` compatibility fallback.
- Treat `DEVELOPMENT_TEAM` in
  `packages/macos-ai-subscription-tracker/project.yml` as the only configured
  team ID. Export options inherit that team from the archive.
- Never commit Apple passwords, app-specific passwords, private keys, API keys,
  or notary credentials. The checked-in export plists contain policy only.

## Release

From `packages/macos-ai-subscription-tracker`, run:

```bash
bun run verify:macos
bun run archive:macos
bun run export:developer-id
bun run notarize:macos
bun run export:notarized
bun run verify:notarized
bun run install:notarized
```

The commands intentionally separate the release artifacts:

1. `verify:macos` runs formatting, lint, warnings-as-errors tests, coverage,
   Xcode compilation, local bundling, and local bundle validation.
2. `archive:macos` creates `dist/QuotaBar.xcarchive` with the native Brim Icon
   Composer document. An automatically managed archive may initially contain an
   Apple Development signature; the export step replaces it for direct
   distribution.
3. `export:developer-id` exports `dist/developer-id/QuotaBar.app` with a
   timestamped Developer ID Application signature. This proves distribution
   signing works before creating an external submission.
4. `notarize:macos` uploads a new submission to Apple's notary service. Do not
   rerun it merely because processing is still pending.
5. `export:notarized` polls the existing archive for up to ten minutes, exports
   `dist/notarized/QuotaBar.app`, and obtains the stapled ticket.
6. `verify:notarized` validates the app metadata, resources, strict signature,
   stapled ticket, and Gatekeeper assessment.
7. `install:notarized` repeats the notarized verification before replacing only
   `/Applications/Brim.app`, removing the legacy `/Applications/QuotaBar.app`
   installation during migration, and launching that exact artifact.

Xcode Organizer's **Distribute App → Developer ID → Upload** flow is the
interactive equivalent of the export and submission steps.

## Required evidence

Do not call a release complete unless `verify:notarized` succeeds. For manual
inspection, these commands provide the decisive evidence:

```bash
codesign -dvvv --entitlements :- dist/notarized/QuotaBar.app
codesign --verify --deep --strict --verbose=2 dist/notarized/QuotaBar.app
xcrun stapler validate dist/notarized/QuotaBar.app
spctl --assess --type execute --verbose=4 dist/notarized/QuotaBar.app
```

The output must identify a `Developer ID Application` authority for the
configured team, include a secure signing timestamp and hardened runtime, report
a valid stapled notarization ticket, and end with Gatekeeper `accepted` from
`Notarized Developer ID`. An ad-hoc signature, `Apple Development` authority,
missing timestamp, unstapled ticket, or `Unnotarized Developer ID` assessment is
not a distributable release.

## Version and team changes

Before a new release, update both `CFBundleShortVersionString` and the monotonic
`CFBundleVersion` in
`packages/macos-ai-subscription-tracker/Resources/Info.plist`. Regenerate the
Xcode project through the package script; do not edit generated
`QuotaBar.xcodeproj` settings by hand.

If the Apple team changes, update only `DEVELOPMENT_TEAM` in `project.yml`, then
create a fresh archive. Confirm that the archive and exported app report the new
team before submitting to notarization.

## Troubleshooting

### Xcode reports “No Account for Team”

Compare the raw 10-character team ID in `project.yml` with a known working
project or the account details in Xcode. A team name appearing in a dropdown
does not prove the configured ID belongs to the signed-in account. Regenerate
the project after correcting the source YAML.

### Developer ID is absent from `security find-identity`

Xcode may use a cloud-managed Developer ID certificate that is not listed as a
local keychain identity. Test the authoritative automatic export with
`bun run export:developer-id`; do not replace it with ad-hoc signing merely
because the keychain listing is empty.

### Gatekeeper says “Unnotarized Developer ID”

That is expected for the Developer ID export before Apple accepts and staples
the submission. Continue with the notary upload and notarized export. It is a
failure only for `dist/notarized/QuotaBar.app`.

### Notarization is still processing

Run `bun run export:notarized`. It polls the existing submission. Do not submit
another copy unless the first submission definitively failed.

### Notarization or verification fails

Inspect the Xcode distribution or notary log for the rejected component, fix
the archive, and start a new submission. Do not bypass `codesign`, stapler, or
Gatekeeper checks, and do not install from `dist/developer-id` as though it were
the notarized artifact.
