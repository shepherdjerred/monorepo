---
id: reference-completed-2026-06-13-mariokart-controller-ui-iteration
type: reference
status: complete
board: false
---

# Mario Kart Controller UI Iteration

## Scope

Iterate on the Discord Plays Mario Kart controller web UI before backend behavior changes.

This first implementation pass focuses on:

- Showing every mapped N64 input in the UI.
- Making current key/button presses visible.
- Making pause and menu controls discoverable.
- Preserving a usable mobile layout.

Deferred until the UI direction is approved:

- Restarting the emulator from the start menu when the bot disconnects or leaves.
- Correcting MK64 screenshot capture to preserve the original 4:3 aspect ratio.
- Any backend input-emission changes beyond mapping the newly exposed controls.

## Current UI Pass

- Replaced the minimal control display with a skeuomorphic N64 controller surface: shell, grips, shoulders, analog stick, D-pad, A/B, Start, Z, and C-buttons.
- Compared the UI against real N64 controller references and reworked the silhouette toward the original wide M-shaped body with three prongs.
- Added visible pressed-state feedback for both physical keys and logical N64 outputs.
- Expanded keyboard mappings for Start, D-pad, shoulders, Z, and C-buttons, including alternate keys shown in the UI.
- Added focused tests to keep on-screen controls and keyboard mappings in sync.
