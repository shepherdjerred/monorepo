---
id: durable-document-tools
type: plan
status: in-progress
board: false
---

# Durable Document and Browser Tools

## Goal

Make PinchTab, Docling, and Lightpanda reproducible through the tracked macOS
chezmoi source, apply the desired state to this Mac, and verify each tool using
its real runtime behavior.

## Installation Model

- Manage PinchTab and Lightpanda through the macOS Brewfile.
- Install Docling as an isolated persistent `uv` tool with the useful macOS-
  compatible OCR, VLM, ASR, HTML, XBRL, and remote-client extras.
- Install Docling's system dependencies through Homebrew, including Tesseract,
  FFmpeg, and the legacy Office conversion dependency.
- Prefetch the standard Docling models and English OCR model, while leaving
  large specialty VLM and ASR models lazy-loaded.
- Keep PinchTab's launchd daemon and CLI on the same generated runtime config,
  with headed and headless instances available.

## Durable Configuration

- Make missing install prerequisites fail loudly so chezmoi cannot record an
  incomplete run-once setup as successful.
- Track required shell environment such as Tesseract's data path.
- Update the relevant agent guidance to match the installed package sources,
  command syntax, and runtime behavior.
- Keep daemon tokens, browser profiles, downloaded models, and other generated
  runtime state outside Git.

## Verification

- Render and validate the chezmoi templates and install scripts.
- Reconcile the Brewfile and apply the managed dotfiles to the live home.
- Exercise PinchTab health, navigation, and headed/headless instance support.
- Exercise Lightpanda against a real rendered page.
- Exercise Docling conversion, OCR dependencies, model prefetch, and optional
  capability imports.
- Run focused dotfiles and documentation checks plus the staged pre-commit gate.

## Remaining

- [x] Implement the durable package inventory and setup hooks.
- [x] Update live state through chezmoi and Homebrew.
- [x] Verify all three tools end to end.
- [ ] Commit, publish a draft PR, and complete the session handoff.
