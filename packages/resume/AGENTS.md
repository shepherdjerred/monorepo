# Resume constraints

This package builds `resume.tex` with XeLaTeX. `resume.pdf` is a generated,
gitignored artifact and must never be committed.

`bun run build` produces the PDF through Turbo. Main Buildkite publishes the
artifact and deploys the prebuilt file to the homelab-backed resume site; PR
deploys are dry runs. Treat local rendering, the Buildkite artifact, and the
live URL as separate acceptance layers.

Inspect the generated PDF whenever content or layout changes.
