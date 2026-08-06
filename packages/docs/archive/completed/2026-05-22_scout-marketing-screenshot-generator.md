---
id: reference-completed-2026-05-22-scout-marketing-screenshot-generator
type: reference
status: complete
board: false
---

# Scout Marketing Screenshot Generator

## Summary

Add a manual Scout showcase image generator that turns pinned real S3/SeaweedFS
objects into static marketing assets. The generated assets are consumed by the
Scout Astro marketing page without requiring S3 credentials at site runtime.

## Plan

- Add strict manifest and generated asset index schemas for requested queue,
  player-count, pre-match, post-match, competition graph, and report graph
  variants.
- Add a backend CLI that reads pinned S3 keys, validates adjacent raw payloads
  where configured, copies/render images, and writes static frontend assets.
- Update the Scout marketing page to render from the generated asset index.
- Run the generator against live S3/SeaweedFS and verify every requested
  variant either has an image or a documented unsupported reason.
