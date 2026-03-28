# Plan: Dagger Migration Phases 2-4 (Complete CI Rebuild)

## Context

Migrating CI from Bazel back to Dagger. CI is broken. Goal: nuke all Bazel + Python CI code, complete the Dagger module to cover ALL packages, build a TypeScript pipeline generator, and get CI green end-to-end. No dead code.

Key requirements:

- Per-package granularity via Dagger content caching — change homelab, only homelab builds
- Failed build retry: union current changes with ALL consecutive failed builds back to last green
- Note: many services at `*.sjer.red` are publicly accessible via Cloudflare tunnel (not tailnet-only)

## Parallel Execution: 8 Chunks, 3 Waves

```
Wave 1 (4 parallel, no deps):
  Chunk R: Deep research (GH issues, blogs, community)
  Chunk A: Nuke Bazel (~200 files)
  Chunk B: Fix Dagger module (index.ts)
  Chunk C: Update dagger-helper skill

Wave 2 (3 parallel, after A+B merge, R findings available):
  Chunk D: Release/deploy Dagger functions
  Chunk E: Quality gate Dagger functions
  Chunk F: Java + LaTeX + security functions

Wave 3 (1 agent, after D+E+F):
  Chunk G: TypeScript pipeline generator
```

## Chunk Details

Each chunk has its own file with exact steps, DoD, and success criteria:

- [Chunk R: Deep Research](2026-03-27_dagger-chunk-r-deep-research.md)
- [Chunk A: Nuke Bazel](2026-03-27_dagger-chunk-a-nuke-bazel.md)
- [Chunk B: Fix Dagger Module](2026-03-27_dagger-chunk-b-fix-dagger-module.md)
- [Chunk C: Update Skill](2026-03-27_dagger-chunk-c-update-skill.md)
- [Chunk D: Release/Deploy Functions](2026-03-27_dagger-chunk-d-release-deploy.md)
- [Chunk E: Quality Gate Functions](2026-03-27_dagger-chunk-e-quality-gates.md)
- [Chunk F: Java + LaTeX + Security](2026-03-27_dagger-chunk-f-java-latex-security.md)
- [Chunk G: Pipeline Generator](2026-03-27_dagger-chunk-g-pipeline-generator.md)

## Research

- [Dagger Best Practices Audit](2026-03-27_dagger-best-practices-audit.md) — code audit + initial research findings
