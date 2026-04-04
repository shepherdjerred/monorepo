# Chunk R: Deep Research — Dagger Community Knowledge

**Wave:** 1 (parallel with A, B, C)
**Agent type:** `/deep-research` with high effort, background
**Touches:** No code — research output only
**Depends on:** Nothing
**Blocks:** Findings feed into Wave 2+3 chunks

## Goal

Exhaustively investigate Dagger community knowledge to surface gotchas, best practices, and TS SDK issues that the initial research may have missed. Produce a comprehensive report that Wave 2+3 agents can reference.

## Steps

1. Search GitHub issues on `dagger/dagger` for: TypeScript SDK bugs, caching gotchas, `.sync()` problems, error handling patterns, monorepo usage, BuildKit layer caching, function caching v0.19.4+
2. Search Hacker News for all Dagger threads — real-world complaints, performance reports, migration stories
3. Search blogs: "dagger CI production", "dagger monorepo", "dagger typescript", "migrating to dagger"
4. Read Dagger GitHub Discussions — common support questions, TypeScript-specific gotchas
5. Read key parts of TypeScript SDK source on GitHub (`sdk/typescript/src/`) — understand `ExecError`, `.stdout()`, `.sync()` internals
6. Search for v0.20.x known issues, breaking changes, regressions
7. Search for multi-file module patterns in TypeScript Dagger modules
8. Synthesize into a research report with citations

## Output

- `~/.claude/research/dagger-community-deep-dive.md` — comprehensive report with 15+ cited sources
- Update `packages/dotfiles/dot_claude/skills/dagger-helper/SKILL.md` if new findings warrant it

## Definition of Done

- [ ] Report exists at `~/.claude/research/dagger-community-deep-dive.md`
- [ ] 15+ cited sources (URLs for every claim)
- [ ] Covers: error handling, caching, logging, debugging, TS gotchas, v0.20 issues, multi-file modules
- [ ] Any new anti-patterns or best practices not in initial research are documented
- [ ] dagger-helper skill updated if new findings warrant it
- [ ] Contradictions between sources explicitly noted

## Success Criteria

Report is a useful reference for Wave 2+3 agents. No uncited claims. Anyone reading it can avoid the common Dagger pitfalls without prior experience.
