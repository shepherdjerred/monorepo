# AGENTS.md - resume

LaTeX resume. Built with `turbo run build` (`xelatex resume.tex`, cached — the PDF is a turbo output) and deployed with `bun run deploy` (`scripts/deploy-site.ts resume`). On merge to main the Buildkite pipeline (`.buildkite/pipeline.yml`) deploys it as one of the sites in its "deploy sites" lane; PR builds run the same deploy with `--dry-run`.

## Deploy

Deployed to SeaweedFS S3 bucket "resume".
URL: https://resume.sjer.red
