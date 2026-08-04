---
id: agent-skills-release-refresh
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Agent Skills Release Refresh

## Goal

Refresh the chezmoi-managed agent-skill corpus against current primary
documentation, add missing high-value skills when the installed tool and
repository inventory justify them, and retain only operationally useful,
non-obvious guidance.

## Scope

Treat one top-level directory under `packages/dotfiles/dot_agents/skills/` as
one researched item. Require at least 30 distinct, successfully fetched
documentation pages for each of the 65 current skills. This produces a minimum
of 1,950 fetched sources before follow-up research or newly added skills.

Commands, libraries, and features mentioned inside a skill are covered by that
skill's 30-source set rather than treated as independent 30-source units.

## Research Questions and Source Strategy

1. Which existing claims are stale, removed, renamed, or incomplete? Use
   official release notes, versioned manuals, API references, and upstream
   repositories.
2. Which new releases materially change agent behavior? Compare current stable
   releases with the newest version already covered by each skill.
3. Which deprecated commands or unsafe examples should be removed? Verify
   against current command references, migration guides, schemas, and changelogs.
4. Which missing workflows recur in the monorepo? Compare repository packages,
   installed tools, recent logs, and existing skill triggers.
5. Which skills are too large for reliable loading? Apply progressive
   disclosure and move detailed reference material out of `SKILL.md` where it
   improves usability.
6. Which internal workflow skills have drifted from live repository policy?
   Verify against the `AGENTS.md` hierarchy and current implementation.
7. Which source claims disagree? Prefer current primary sources and record
   unresolved contradictions explicitly.
8. Which updates survive independent forward tests? Give revised skills to
   clean-context agents using realistic tasks without leaking expected answers.

## Execution Model

- Create an isolated worktree from `origin/main` and initialize it as a native
  GitHub stack with `gh stack init --base main`.
- Divide the corpus into disjoint research batches and rotate three concurrent
  subagents through them. Research agents must use Lightpanda first for page
  extraction, then `curl`/`wget`, and PinchTab only for blocked or interactive
  sites.
- Require a Research ledger per skill: a numbered list of the successfully
  fetched primary source titles and URLs, appended to the skill's
  `references/` material, sufficient to verify the 30-source quality gate.
- Keep source ledgers in the skill's own `references/` files rather than
  bloating the runtime `SKILL.md` context.
- Edit skills only after the relevant 30-source threshold is met. Preserve
  durable workflows; replace release catalogs with concise current behavior and
  migration guidance.
- Split the final change into cohesive native-stack layers by technology group
  if the diff is too large for one reviewable PR.

## Proposed Research Batches

1. Languages and runtimes: Bun, TypeScript, Go, Rust, Python, JVM, and Lua.
2. Application frameworks and data tooling: Vite/React, Hono, XState, Zod,
   Prisma, ESLint, Satori, and Mastra.
3. Containers and orchestration: Docker, Kubernetes, Helm, Argo CD, Talos,
   cdk8s, LinuxServer containers, storage, and deployment patterns.
4. Infrastructure and networking: Terraform/OpenTofu, Tailscale, Grafana,
   OpenTelemetry, PagerDuty, Sentry, and Bugsink.
5. Developer CLI and configuration: Git, GitHub, git-spice, worktrees, modern
   CLI tools, Fish, Zellij, chezmoi, 1Password, Lightpanda, and PinchTab.
6. Product/API helpers: Buildkite, Discord, Riot/League, Apple HIG, Figma,
   Typst, and Xcode Cloud.
7. Repository-native workflows: PR health/monitoring/automation, version
   management, review, reflection, grading, and monorepo documentation.
8. Gap analysis: installed and repository-critical tools that lack a skill.

## Quality Gates

- Every refreshed skill has at least 30 successfully fetched source pages in
  the evidence ledger.
- Every shipped URL is checked live and does not return a dead link.
- Every factual release/version claim is traceable to a visited primary source.
- Skill bodies remain concise and use progressive disclosure; detailed material
  belongs in directly linked `references/` files.
- Existing user changes to `bugsink-helper/SKILL.md` are preserved and
  reconciled rather than overwritten.
- Run skill validation for every changed or added skill.
- Run focused formatting/link checks, `bun run check-todos`, and the staged
  pre-commit hook; fix all failures within the requested scope.
- Run independent clean-context forward tests for representative revised skills
  and adversarial source review before publication.
- Verify the chezmoi source/live mapping after the source changes. Do not apply
  repository state over the live skills without checking direction first.

## Remaining

- [x] Confirm that “30 sources” means per top-level skill, with commands and
      libraries inside that skill covered by the same 30-source set.
- [x] Create and initialize the isolated native-stack worktree.
- [x] Inventory the full corpus, existing references, current versions, and
      missing high-value skills.
- [ ] Run the multi-agent research batches and build the per-skill evidence
      ledger.
- [ ] Reconcile overlapping and contradictory findings.
- [ ] Refresh existing skills and add justified missing skills.
- [ ] Validate links, skill structure, focused checks, docs, and chezmoi drift.
- [ ] Forward-test representative skills with clean-context agents.
- [ ] Publish the reviewable native GitHub stack with source and verification
      evidence.

## Comment Log

- 2026-08-03: Initial corpus inventory found 65 top-level skills; 32 currently
  contain a `What's New` section. The main checkout also contains an active
  user change to `bugsink-helper/SKILL.md`, which must be preserved.
- 2026-08-03: The user confirmed the 30-source requirement applies per
  top-level skill. Created `.claude/worktrees/agent-skills-refresh` on
  `feature/agent-skills-refresh` and initialized it with native `gh stack`.
- 2026-08-03: Completed the first two research waves for Git, Bun, TypeScript,
  Rust, and Python: 186 primary pages plus 15 supplemental official or
  project-primary pages, 201 total, were successfully fetched and inspected. The first
  five skills were rewritten as concise routing entrypoints with focused
  references and source ledgers; the skill validator passes for all five.
- 2026-08-03: Completed the next language/tooling wave for Go, Lua, JVM, and
  Fish: 238 primary pages fetched and inspected. Nine skills now have 424
  primary plus 15 supplemental sources, 439 total. The new four rewrites pass
  formatting, skill validation, and batched live-link checks.

## Session Log — 2026-08-03

### Done

- Loaded the skill-authoring, deep-research, Lightpanda, chezmoi, worktree,
  native GitHub stack, Git, and monorepo-documentation guidance.
- Inventoried 65 top-level managed skills and identified the existing Bugsink
  overlap that must be preserved.
- Confirmed the 30-source-per-top-level-skill scope with the user.
- Created and initialized the isolated native-stack worktree.
- Completed and distilled the first five 30-source research audits: Git, Bun,
  TypeScript, Rust, and Python.
- Replaced stale monolithic tutorials with concise entrypoints and focused
  reference files, including current release and compatibility boundaries.
- Validated all five rewritten skill structures with the skill-creator
  validator.

### Remaining

- Complete all research, implementation, verification, forward-testing, and
  publication work.

### Caveats

- `bun run check-todos` in the main checkout stopped on the invalid frontmatter
  ID in the existing untracked file
  `packages/docs/logs/2026-08-03_scout-evals-populate-100-case-dataset.md`.
