# resume

LaTeX resume compiled with xelatex (`bun run build` → `resume.pdf`, a
gitignored build artifact). On merge to main, Buildkite's `resume-build` step
builds the PDF in a texlive container and the deploy lane ships it prebuilt via
`bun run deploy` (`scripts/deploy-site.ts resume`) to
<https://resume.sjer.red>. See [AGENTS.md](AGENTS.md) for contributor/agent
workflow notes.
