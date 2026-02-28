# CLAUDE.md - resume

LaTeX resume. Build/deploy handled by Bazel + Buildkite (not Bun).

## Build

```bash
bazel build //packages/resume:resume
```

## Deploy

Deployed to SeaweedFS S3 bucket "resume" on main branch.
URL: https://resume.sjer.red
