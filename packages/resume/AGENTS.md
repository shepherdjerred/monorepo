# AGENTS.md - resume

LaTeX resume. Built with `turbo run build` (`xelatex resume.tex`, cached — the PDF is a turbo output) and deployed with `bun run deploy` (`scripts/deploy-site.ts resume`, which builds first via the site's `buildCmd`). **`resume.pdf` is a gitignored build artifact — never commit it.** On merge to main the Buildkite pipeline (`.buildkite/pipeline.yml`) builds the PDF in the `resume-build` step's texlive container, ships it as a Buildkite artifact, and the "deploy sites" lane downloads it and deploys `--prebuilt`; PR builds run the same deploy with `--dry-run`.

## Deploy

Deployed to SeaweedFS S3 bucket "resume".
URL: https://resume.sjer.red
