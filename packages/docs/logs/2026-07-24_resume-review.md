---
id: log-resume-review-2026-07-24
type: log
status: complete
board: false
---

# Resume review — packages/resume/resume.tex

## Goal

Review the resume (content, structure, formatting, link liveness) and report
findings. Review-only session — no edits applied.

## What was checked

- Source: `packages/resume/resume.tex` (single page, Sourabh Bajaj template, xelatex)
- Rendered PDF via `bunx turbo run build --filter=@shepherdjerred/resume` and visual read
- Liveness of every URL on the resume (curl status codes)
- Deployed copy at <https://resume.sjer.red> vs local build (pdftotext diff — identical)

## Findings (delivered in chat)

Hard defects:

- **Game Engine link 404s** — `resume.tex:153` points at
  `monorepo/tree/main/packages/castle-casters`, but the project moved to
  `sandbox/archive/castle-casters` (verified 200). The dead link is live on the
  deployed resume today.
- **Date dash inconsistency** — Education uses `--` (en dash), all four
  Experience ranges use bare `-` (hyphen): `resume.tex:111,123,134` etc.
- **Best metrics stranded in comments** — `resume.tex:113-114` ("thousands of
  studies…", "hundreds of millions of dollars of ad revenue") never appear in a
  rendered bullet.

Structure: Education listed before Experience (new-grad layout at ~7 YOE);
OMSCS has no expected graduation date; project links visually
indistinguishable from plain text (no `colorlinks`); no PDF title metadata; no
LinkedIn/location in header.

Content: "Used LLMs extensively" reads as filler in 2026 (the AI-tooling
bullet is the real differentiator but has zero numbers); dangling modifier in
Measurement Hub bullet; verb monotony (Leading/directing/Owning/Driving);
"migration"×3, "Led"×2 in one Posit bullet, "root-caused"×2 at AWS; AWS's 66%
cost cut buried behind a weak "Implemented features" opener; Skills line lists
no AI/LLM stack despite AI-tooling being a centerpiece; `root@sjer.red` may
read odd to recruiters.

ATS: text-layer extraction order is clean; single page with room to spare.

## Session Log — 2026-07-24

### Done

- Built the PDF, reviewed source + render, liveness-checked all 6 URLs,
  confirmed deployed PDF matches local source. Full review delivered in chat.
- Applied accepted fixes to `resume.tex` (uncommitted, main checkout):
  Experience moved above Education; Clauderon removed (user: dead project);
  OMSCS end date "Spring 2027 (expected)"; castle-casters link fixed to
  `sandbox/archive/`; all date dashes normalized to `--`; `\hypersetup`
  (colorlinks + PDF title/author); Measurement Hub bullet now carries the
  revenue/experiment-scale metrics from the old comments and drops the "Used
  LLMs extensively" filler; dangling modifier fixed; verb dedup (Led/Drove,
  Directing/Guiding, root-caused/Diagnosed); AWS leads with the 66% cost cut;
  Rebuilt: still 1 page. (An "AI tooling" skills line was added, then removed
  at user request — Skills stays the original single language/infra list; the
  AI story lives in the Pinterest bullets.)
- User decisions: no LinkedIn (doesn't have one), keep `root@sjer.red`,
  targeting AI companies, "MCP as a skill" would be silly — list real tools.

- Pinterest expansion from user brain-dump (2026-07-24): section rewritten to
  5 impact-first bullets — Measurement Hub platform/scale; Conversion Lift
  migration (product rebuilt in 6 months, GA a month early, 8 engineers through
  churn, no major production incidents); Data quality (typed schemas, JSON→
  relational, 8,000→1,000 record audit, report re-parenting, multi-million
  reporting discrepancies exposed, "6 months vs prior 6 years" cleanup);
  Engineering influence; AI tooling (data-export CLI+MCP for 30 systems,
  oe-report, Deckorator). Deliberately excluded: firing/layoff details,
  AI Companion integration (user: trivial), month names. Posit cut to 3 bullets
  (dropped Testing infrastructure, Developer experience) to hold 1 page.
  Context: OpenAI interview feedback — "good but didn't stand out, communicate
  impact better" — drove the impact-first framing.
- Later in session: "AI tooling" Skills line added then removed at user
  request; "Database Implementation" added to OMSCS coursework; last real
  content update before today confirmed via git as 2026-03-26 (`5ed022430`).

### Remaining

- User to sanity-check drafted claims: "Directed 8 engineers" (4 constant +
  4 rotating), the unattributed "more cleanup in 6 months than prior 6 years"
  line, and the Posit "Migrated the service to a portable static binary"
  object (original bullet had no object; "the service" is an assumption).
- Branch + PR via git-spice once user signs off (change is uncommitted in the
  main checkout; merge to main redeploys resume.sjer.red).

### Caveats

- `packages/resume/_summary.md` claims "the repo's CI pipeline was removed
  2026-07" while `packages/resume/AGENTS.md` and `.buildkite/pipeline.yml`
  describe an active Buildkite resume-build/deploy lane. One of the two docs is
  stale; not investigated further in this session.
