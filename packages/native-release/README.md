# native-release

Shared code-signing helpers for the repository's native release lanes. One copy
of the Developer ID, notarization and Authenticode steps serves TaskNotes (macOS),
Scout Desktop (macOS) and the Glitter Boys launcher (Windows), so a fix reaches
every lane. These are operator-run lanes: nothing here runs in CI, and nothing
here ever receives, reads or prints a secret. The Developer ID certificate lives
in the operator's keychain, notarization authenticates with a `notarytool`
keychain profile, and Windows signing uses the operator's `az login`.

Each lane keeps its own entrypoint, flags and product-specific steps (the Xcode
archive and export for TaskNotes, `cargo packager` plus `lipo` for Scout
Desktop, NSIS packaging for the launcher) and calls this package for the
signing.

## Imports

| Subpath                                  | Contents                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@shepherdjerred/native-release/runner`  | `ProcessRunner`, `bunRunner`, and the `run`, `capture` and `succeeds` helpers every other function goes through            |
| `@shepherdjerred/native-release/apple`   | Identity and notary-profile preflight; codesign, notarize, staple and assess steps and their command builders              |
| `@shepherdjerred/native-release/windows` | PowerShell 7 lookup, sign, verify and preflight wrappers, the NSIS signing rewrite, and the artifact-signing config schema |

Consumers declare `"@shepherdjerred/native-release": "workspace:*"`.

## Apple

Every step takes a `ProcessRunner` first. Command builders (`codesignCommand`,
`notarizeCommand`, `assessCommand`, and so on) are pure, so a dry run prints
exactly what a real run would execute.

- `preflightAppleSigning` validates the team ID, finds exactly one Developer ID
  Application identity (by SHA-1) and proves the notary profile authenticates.
  It throws on the first problem and never falls back. `readDeveloperIdIdentity`
  and `assertNotaryProfile` are the same checks for a lane that wants to downgrade
  them to warnings in a dry run.
- `missingTools` and `xcrunProbe` report missing Xcode tools by name.
- `signBundle` and `signDiskImage` sign with Developer ID; only bundles get the
  hardened runtime. `assertHardenedRuntime` checks it from `codesign --display`
  (which writes to stderr).
- `notarizeBundle` zips with `ditto --keepParent` and submits; `notarizeFile`
  submits a disk image directly. Both wait for Apple's verdict.
- `stapleAndValidate`, `verifyCodesign` and `assess` finish the sequence.

The notary probe is `notarytool history --keychain-profile` without `--limit`,
which Xcode 27 rejects.

## Windows

`windows/` holds the PowerShell scripts: `sign-artifact.ps1` signs through
Microsoft Artifact Signing and verifies, `verify-signature.ps1` compares the full
publisher subject, and `preflight-signing.ps1` checks the Windows SDK, the
verified signing client, the Azure login and the Active Public Trust
certificate profile. `windows/artifact-signing.json` is the one signing account
configuration; `ArtifactSigningConfigSchema` describes its shape.

`signArtifact`, `verifySignature` and `preflightSigning` locate PowerShell 7 and
run those scripts. The publisher is the caller's (the launcher reads it from its
release profile); `signArtifact` refuses to run without one. `signedInstallerSource`
rewrites a cargo-packager NSIS script so the installer and uninstaller are signed
by `nsisSigningCommand`, failing closed on anything it does not recognise.

## Development

```bash
bunx turbo run build typecheck test lint --filter=@shepherdjerred/native-release
```

Tests drive the helpers through a recording `ProcessRunner`; none of them signs,
notarizes or touches a keychain.
