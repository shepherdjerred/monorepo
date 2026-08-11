---
id: facet-branding-2026-08-10
type: plan
status: complete
board: false
---

# Facet branding for iOS and macOS

## Summary

Rename the public TaskNotes app identity to Facet across iOS and macOS, add
the supplied native icon artwork, and preserve the complete original SVG
source set in the repository.

## Decisions

- This is a public identity rename only. Bundle IDs, app groups, keychain
  services, URL schemes, storage paths, target/module names, schemes, package
  names, and API terminology remain unchanged for compatibility.
- The unchanged canonical SVG sources live under
  `packages/tasks-for-obsidian/branding/Facet/source/`.
- iOS uses derived PNGs in the existing `AppIcon.appiconset`; macOS uses a
  derived native ICNS resource.

## Remaining

- [x] Wire the generated iOS and macOS icon assets.
- [x] Rename user-facing copy to Facet in both apps.
- [x] Run asset, build, launch, and legacy-copy verification.

## Verification

Verification completed source hash preservation, `actool` compilation, iOS
release-bundle validation, iOS simulator build/install/launch, macOS
verification and release launch, and a search for remaining user-visible
legacy branding. The focused iOS typecheck, lint, native-dependency check, and
AppError fixture tests also pass. The package-wide test command still has one
unrelated failure in the recurrence timezone-probe test.

## Comment Log

- 2026-08-10: Canonical Facet SVG sources copied unchanged from `~/Downloads/Facet`.
- 2026-08-10: Generated and validated iOS PNGs and the macOS `AppIcon.icns`.
- 2026-08-10: Completed Facet copy migration while preserving technical identifiers.
