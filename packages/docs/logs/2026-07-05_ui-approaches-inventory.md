---
id: log-2026-07-05-ui-approaches-inventory
type: log
status: complete
board: false
---

# UI Approaches Inventory

## Summary

Reviewed UI framework and styling approaches under `packages/` using live package manifests, config files, and representative source files.

Findings:

- Tailwind CSS is the dominant approach for current web UI surfaces.
- shadcn-style components are concentrated in Scout packages, with the strongest explicit shadcn setup in `packages/scout-for-lol/packages/frontend/components.json`.
- Bulma appears only in `packages/better-skill-capped`, via Sass import.
- Several small surfaces use plain CSS or inline HTML styles instead of a framework.
- `tasks-for-obsidian` is React Native with `StyleSheet` and native UI/navigation libraries, not Tailwind/nativewind.
- Generated visual output uses React + Satori/resvg patterns in `astro-opengraph-images` and `scout-for-lol/packages/report`.

## Session Log — 2026-07-05

### Done

- Inspected UI-related dependencies, configs, and representative source files across `packages/`.
- Classified packages by Tailwind, shadcn-style/Radix, Bulma/Sass, Astro/plain CSS, React Native, and generated-image approaches.
- Confirmed no package manifests referenced common alternatives such as MUI, Chakra, Mantine, Ant Design, daisyUI, Bootstrap, styled-components, Emotion, NativeWind, Tamagui, or React Native Paper.
- Answered the follow-up tradeoff question about shadcn vs Radix/Base UI. Clarified that the relevant Base UI is `base-ui.com`: a strong unstyled primitive layer that could replace some Radix usage under Scout's local wrappers, but does not remove the need for app-owned Tailwind/CVA component code.
- No package source was modified.

### Remaining

- None for the requested inventory.

### Caveats

- This was a static repository inspection, not a visual audit of rendered screens.
- Lockfiles and generated directories were ignored for classification because they include transitive UI dependencies that are not package-level UI choices.
