# Renovate: Home Assistant Manifest Manager Disabled

## Status

Active

## Decision

Disabled the `homeassistant-manifest` Renovate manager in `renovate.json`. This manager scans all `manifest.json` files looking for Home Assistant integration manifests (expecting fields like `domain`, `requirements`). The monorepo has no HA integrations, but has 5 unrelated `manifest.json` files (Chrome extension, Obsidian plugins, PWA manifest, test fixtures) that trigger Zod schema errors on every run.

## Re-enabling

If Home Assistant integrations are added to the monorepo (e.g., custom components in a `homeassistant/` or `hass/` package), re-enable by removing the `"homeassistant-manifest": { "enabled": false }` block from `renovate.json`. Consider restricting its scope with `managerFilePatterns` to only scan the HA directory.
