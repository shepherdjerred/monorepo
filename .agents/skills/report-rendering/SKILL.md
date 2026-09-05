---
name: report-rendering
description: Build or debug repository report images and SVG output using Satori, Resvg, fonts, and report fixtures. Use for Scout reports, OpenGraph images, generated graphics, or JSX-to-SVG rendering failures.
---

# Report rendering

Repository report graphics use Satori's constrained HTML/CSS model and Resvg.
Treat browser rendering as a different platform.

- Use flex layout; avoid Grid, unsupported selectors, and browser-only CSS.
- Give repeated rows and nested containers explicit dimensions when layout
  depends on them.
- Load fonts as binary data before rendering and keep declared family/weight
  aligned with the loaded face.
- Resolve image assets to data or reachable absolute URLs accepted by the
  renderer. Missing assets fail rather than silently changing the design.
- Keep dynamic text bounded. Test long names, missing optional data, and the
  maximum supported row count.
- Preserve deterministic output: fixed dimensions, explicit locale/timezone,
  stable ordering, and fixture-controlled data.

Verify the owning package's tests, render representative fixtures, and inspect
the produced PNG/SVG at full size. Attach the generated artifact for a visual
change; source tests alone do not prove layout.
