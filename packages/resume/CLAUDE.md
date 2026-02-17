# CLAUDE.md - resume

LaTeX resume. Build/deploy handled by Dagger (not Bun).

## Build

dagger call resume-build --source=. export --path=./resume.pdf

## Deploy

Deployed to SeaweedFS S3 bucket "resume" on main branch.
URL: https://resume.sjer.red
