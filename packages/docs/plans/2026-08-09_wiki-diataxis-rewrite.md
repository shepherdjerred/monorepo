---
id: wiki-diataxis-rewrite
type: plan
status: in-progress
board: true
verification: human
disposition: active
---

# Rewrite the human wiki on Diátaxis

## Summary

Rewrite every page in `packages/docs/wiki/` around
[Diátaxis](https://diataxis.fr/): four kinds of documentation, each serving one
user need, never mixed on one page. The current wiki has good raw material but
almost every page blends explanation, reference, and instructions, so no page
answers one question and the prose is dense to the point of being hard to read.

The target format is the Scout docs site in
[PR #2036](https://github.com/shepherdjerred/monorepo/pull/2036) — 28 Diátaxis
pages under `packages/scout-for-lol/packages/docs-site/`. This plan adopts its
directory layout, sidebar mechanism, home-page shape, and voice rather than
inventing a second house style.

Scope also includes a general-purpose `diataxis` agent skill in
`packages/dotfiles/` and Diátaxis steering in every prompt surface that governs
wiki authoring, so the structure survives future agent edits.

Out of scope: the wiki build, the publication allowlist, and the
working-material layer.

## Research base

28 sources read in full. The complete diataxis.fr corpus (16 pages:
`start-here`, `application`, `tutorials`, `how-to-guides`, `reference`,
`explanation`, `compass`, `how-to-use-diataxis`, `theory`, `foundations`, `map`,
`quality`, `tutorials-how-to`, `reference-explanation`, `colophon`, home), plus
the deleted `complex-hierarchies` page recovered from the Wayback Machine, plus
Divio's original formulation, Canonical's adoption post, Cloudflare's
content-type taxonomy, Sequin's migration write-up, I'd Rather Be Writing's DITA
comparison, Fabrizio Ferri-Benedetti's Seven-Action Model, and three Hacker News
threads (514/188/558 points; ~180 comments of practitioner experience and
critique).

### The framework, compressed

Two axes define the whole territory of a craft, which is why there are exactly
four kinds of documentation and not three or five:

|                            | **Action** (practical steps)   | **Cognition** (theoretical knowledge)  |
| -------------------------- | ------------------------------ | -------------------------------------- |
| **Acquisition** (at study) | Tutorial — _learning-oriented_ | Explanation — _understanding-oriented_ |
| **Application** (at work)  | How-to guide — _goal-oriented_ | Reference — _information-oriented_     |

The compass is the working tool, not the map. For any page or paragraph, ask two
questions — _action or cognition?_ and _acquisition or application?_ — and the
answer falls out. Use it at the level of a sentence as readily as a whole page.

| Kind        | Answers                 | Form                  | Analogy                        |
| ----------- | ----------------------- | --------------------- | ------------------------------ |
| Tutorial    | "Can you teach me to…?" | a lesson              | teaching a child to cook       |
| How-to      | "How do I…?"            | a series of steps     | a recipe                       |
| Reference   | "What is…?"             | dry description       | the back of a food packet      |
| Explanation | "Why…?"                 | discursive discussion | an article on culinary history |

### Findings that shaped this plan

- **Blur is the disease, and it is what we have.** Neighbouring quadrants share
  an axis, so they bleed into each other. The most common and most damaging
  conflation is tutorial/how-to; the second is reference absorbing explanation
  because examples are fun to develop. Both are present in the current wiki.
- **Diátaxis exposes lapses before it fixes them.** Canonical: "the first thing
  Diátaxis does is make existing documentation look worse, not better." Expect
  the migration to surface real gaps (no homelab overview, no toolkit page).
- **Don't build empty rooms.** Procida is explicit: creating four empty section
  shells is "horrible." Only create a section that has real content today.
- **Structure is an outcome, not an input.** Diátaxis prescribes small
  iterations, not big-bang restructures. This plan takes the full-rewrite
  instruction as given but sequences it into independently shippable phases
  rather than one commit, which is the closest honest fit.
- **Rigidity is the top practitioner complaint.** Across ~180 HN comments the
  repeated failure mode is dogmatic application: "we do see people take it too
  far." Treat the four types as a SHOULD, not a MUST. Examples in reference are
  fine and endorsed by Procida; a link out is always better than a digression.
- **Interconnection is the second complaint.** Splitting into quadrants without
  dense cross-links makes docs _harder_ to use. Every how-to must link to its
  reference; reference links are one-way so facts stay DRY.
- **Don't add a click to the thing read 95% of the time.** Real annoyance from
  practitioners: `Reference → API` behind two clicks. The home page must
  deep-link the highest-traffic pages directly, which is what #2036 does.
- **Lists longer than seven items are hard to read** (from the deleted
  `complex-hierarchies` page). Landing pages must be prose overviews that
  _introduce_ their contents, not bare link dumps.
- **The two-dimensional problem is ours.** When Diátaxis meets a second
  structure — here, subject areas — Procida's answer is that Diátaxis "is not
  four boxes," documentation may be as complex as it needs to be, and the
  question to ask is whether the subjects are effectively different products for
  different users. Resolved in D1.
- **Diátaxis covers deep quality only.** It cannot deliver accuracy or
  completeness; those stay our job. It _can_ deliver flow, fit, and anticipation
  of the reader — which is exactly the complaint being fixed.
- **Known blind spots.** Diátaxis has no home for troubleshooting, FAQs, or
  "should I even use this" appraisal. Cloudflare solves this with extra content
  types; the Seven-Action Model adds Appraise and Troubleshoot as first-class.
  Resolved in D3.
- **Phantom links** (from Sequin's migration): when you feel the urge to explain
  inside a how-to, link to a reference page that does not exist yet. The broken
  links become the work list. Adopt this as the working technique.

## Target format (PR #2036)

The Scout docs site is the reference implementation. What it establishes:

| Aspect         | Convention                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directories    | `tutorials/`, `how-to/`, `reference/`, `explanation/` under `src/content/docs/`                                                                                      |
| Nesting        | Flat inside each section; files are kebab-case and named for the reader's goal (`add-players.md`, `troubleshoot-notifications.md`)                                   |
| Sidebar        | Four groups, each `{ autogenerate: { directory: "…" } }`; order comes from each page's `sidebar.order` frontmatter                                                   |
| Section labels | "Tutorials", "How-to guides", "Reference", **"Concepts"** — the `explanation/` directory is labelled Concepts in the nav                                             |
| Schema         | Plain `docsSchema()`. No custom content type field; the directory _is_ the type                                                                                      |
| Home           | `template: splash` with a hero and two actions, then four body sections: Start here / Solve a specific problem / Look something up / Understand how it fits together |
| Format         | `.md` by default; `.mdx` only where a page renders generated content                                                                                                 |
| Voice          | Second person, short sentences, links woven inline rather than parked in a list                                                                                      |

Two mechanisms in #2036 are worth noting even where this plan does not adopt
them:

- **Sidebar `autogenerate` structurally eliminates orphan pages.** A new file is
  in the nav the moment it exists. This is the direct fix for the wiki's current
  hand-maintained sidebar, which has lost five pages.
- **Reference is generated, not transcribed.** Scout renders its metric,
  permission, and render-kind tables from `@scout-for-lol/data` at build time.
  The wiki has one strong candidate for this treatment — the Temporal workflow
  and schedule inventories, which could be derived from the schedule
  definitions in `packages/temporal`. Recorded as an option in D6, not adopted.

## What is wrong with the wiki today

25 pages, ~13,000 words. The content is accurate and the diagrams are good. The
problems are structural and sentence-level.

1. **Every substantial page is a genre blend.** `pr-fleet-controller.md` is one
   page containing a how-to (running it, watching it, inspecting it), reference
   (flags, paths, file modes, socket permissions), and explanation (the
   authority boundary, why work is bounded). `agent-tasks.md` does the same with
   four genres. There is no page you can read to do one thing.
2. **Sentences carry three to five facts each.** The "Operator-owned checkouts"
   bullet in `pr-fleet-controller.md` is a single ~200-word bullet with nested
   subordinate clauses and em-dash asides. Bullets are being used as paragraph
   containers, not as lists of parallel items. This is the direct cause of
   "reads incredibly poorly."
3. **Workflow residue has leaked into the human wiki.** `agent-tasks.md`
   contains "The workflow-deep-dive plan's former aggregate timeout-watch design
   is superseded. Do not restore `agent-task-timeout-watch`" and "its retired
   timeout-watch entry is not an implementation TODO." That is agent-to-agent
   plan state, not a human explanation, and it belongs in `packages/docs/`.
4. **Duplication inside a page.** `agent-tasks.md` states the
   `ALLOW_DUPLICATE_FAILED_ONLY` conflict-policy behaviour twice, near-verbatim,
   in two different sections.
5. **No orientation layer.** The home page is a splash whose body is _about the
   wiki_ ("What belongs here / What does not"). The first real destination is
   "How this wiki works" — meta, not system. Nothing routes a reader by need.
6. **Several pages are unreachable.** Examples that are not in the sidebar and
   have no inbound link include `/tasks-for-obsidian/`, `/scout-analysis/`,
   `/homelab/tracker-tracker/`, `/homelab/buildkite-admission/`. Nothing in the
   test suite catches this.
7. **Titles do not say what the page does.** "Agent tasks," "Plane,"
   "Releases" — you cannot tell instruction from description from discussion.
8. **Reference is buried, not consultable.** Flags, ports, paths, env vars, and
   timeouts appear mid-paragraph inside explanation. The one genuinely excellent
   reference page, `/temporal/workflows/`, proves the format works here.
9. **Real how-tos are trapped inside explanation pages.** The iOS Shortcut
   construction in home-automation, the Glitter `glitter:operate` runs, and the
   agent-task production canary are all step-by-step procedures living inside
   discursive pages.
10. **Coverage gaps.** There is no homelab overview page at all, despite seven
    narrow homelab pages. No page covers `packages/toolkit`, the monorepo's own
    CI/verification system, or Scout as a product.

## Decisions

### D1 — Diátaxis-first, flat, per PR #2036

Four top-level directories, flat inside, matching Scout exactly. Subject is
carried by the slug (`cut-a-homelab-release`, `schedule-an-agent-task`), not by
a directory level.

Subject-first was the alternative: `/homelab/`, `/temporal/`, `/birmel/` each
containing four sub-sections. Rejected because the corpus is small — eight
subjects × four types would create roughly 30 near-empty groupings, precisely
the "empty structures with nothing in them" Procida forbids. Per the recovered
`complex-hierarchies` guidance, subject-first is right when the subjects are
effectively _different products for different users_; here there is one reader
in different modes, so the mode is the stronger axis.

**One deviation from Scout's flat layout.** Scout's largest section holds 11
pages. The wiki's `explanation/` will hold 17, which exceeds the seven-item
readability guidance by too much. `explanation/` therefore nests one level by
subject (`explanation/homelab/`, `explanation/temporal/`, …). `autogenerate`
renders nested directories as nested groups, so the mechanism is unchanged.
`tutorials/`, `how-to/`, and `reference/` stay flat.

### D2 — Ship `tutorials/` with two real lessons

The earlier draft of this plan proposed omitting tutorials entirely, on the
grounds that the wiki's reader owns these systems and is never a novice in them.
The target format has a tutorials section, and two genuine lessons do exist, so
ship the section with real content in it — never with placeholders:

- _Bring the homelab up on a new workstation_ — a real end-to-end lesson with a
  concrete finish line.
- _Write and schedule your first agent task_ — a lesson with a safe, disposable,
  report-only outcome.

If neither survives contact with writing, cut the section rather than pad it.

### D3 — Troubleshooting is a how-to, appraisal is an explanation

Rather than adding Cloudflare-style extra content types or adopting the
Seven-Action Model, fold the two known gaps into the four sections:

- Troubleshooting pages are how-to guides. Title them `How to diagnose …`.
  Scout does this (`troubleshoot-notifications.md`), and Diátaxis itself lists
  "Troubleshooting deployment problems" as a how-to.
- "Why this and not that" pages are explanation. Title them `Why …` or `About …`.
- No FAQ pages. Procida's line is worth honouring: an FAQ is the box you put
  things in when you can't be bothered to file them.

### D4 — No custom content-type field

An earlier draft proposed a required `docType` frontmatter field. Dropped: #2036
uses a plain `docsSchema()`, and with `autogenerate` the directory already _is_
the type. A second declaration of the same fact could only ever disagree with
itself.

### D5 — Sidebar is autogenerated; the orphan class disappears

Replace the hand-maintained sidebar with four `autogenerate` groups and
`sidebar.order` frontmatter. This is the structural fix for the five orphaned
pages — a file cannot be missing from the nav if the nav is derived from the
files. Keep one cheap test asserting every content file lives under one of the
four sections (or is the home page), which is the only orphan-shaped failure
`autogenerate` cannot catch.

### D6 — Generated reference is an option, not this plan's work

The Temporal workflow and schedule inventory tables are the wiki's best
candidate for #2036's generate-don't-transcribe treatment, and they are also
its most drift-prone pages. Deriving them from the schedule definitions in
`packages/temporal` is recorded here as a follow-up, not adopted now; this
rewrite is about structure and prose.

### D7 — Working material and publication are unchanged

`/working/`, `wiki-publication.ts`, the allowlist, the banner, `noindex`, and
the Pagefind down-ranking all stay as they are. `/working/` is a fifth thing —
provenance, not documentation — and keeps its own sidebar group outside the four
Diátaxis sections.

## Target structure

`→` marks content moving from an existing page; `NEW` marks a genuine gap.

### `/` — Home

Splash with hero and two actions, then the four need-routing sections in the
order #2036 uses: Start here / Solve a specific problem / Look something up /
Understand how it fits together. Direct deep links to the highest-traffic pages.
The current "What belongs here / What does not" meta-content moves into
`/explanation/how-this-wiki-works/`.

### `/tutorials/` — 2 pages

| Route                              | Source |
| ---------------------------------- | ------ |
| `/tutorials/homelab-from-scratch/` | NEW    |
| `/tutorials/first-agent-task/`     | NEW    |

### `/how-to/` — 9 pages, flat

| Route                                | Source                                      |
| ------------------------------------ | ------------------------------------------- |
| `/how-to/run-the-pr-fleet/`          | → `pr-fleet-controller.md`                  |
| `/how-to/inspect-a-fleet-run/`       | → `pr-fleet-controller.md`                  |
| `/how-to/schedule-an-agent-task/`    | → `temporal/agent-tasks.md`                 |
| `/how-to/run-the-agent-task-canary/` | → `temporal/agent-tasks.md`                 |
| `/how-to/pause-or-debug-a-schedule/` | → `temporal/schedules.md`                   |
| `/how-to/operate-glitter-corpus/`    | → `temporal/workflows/glitter.md`           |
| `/how-to/build-the-sleep-shortcut/`  | → `temporal/workflows/home-automation.md`   |
| `/how-to/cut-a-homelab-release/`     | → `homelab/releases.md`                     |
| `/how-to/operate-scout-evals/`       | → `homelab/scout-evals-tailnet-boundary.md` |

### `/reference/` — 7 pages, flat

| Route                                  | Source                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| `/reference/temporal-workflows/`       | → `temporal/workflows/index.md` (already good; keep the table format) |
| `/reference/temporal-schedules/`       | → `temporal/schedules.md`                                             |
| `/reference/agent-task-input/`         | → `temporal/agent-tasks.md` (schema, limits, timeouts)                |
| `/reference/home-automation-routines/` | → `temporal/workflows/home-automation.md`                             |
| `/reference/pr-fleet-cli/`             | → `pr-fleet-controller.md` (commands, flags, slash commands)          |
| `/reference/pr-fleet-run-bundle/`      | → `pr-fleet-controller.md` (paths, modes, contents)                   |
| `/reference/homelab-services/`         | NEW — deferred to phase 6; see the note below                         |

**Note on `homelab-services`.** This one must be _generated_, not transcribed.
The ArgoCD application definitions in
`packages/homelab/src/cdk8s/src/resources/argo-applications/` are not uniformly
literal: most inline `namespace: "…"`, but some (Plane, for example) build the
value from module constants, and a few do not call `new Application()` directly
at all. A regex sweep over that directory recovered 62 applications and silently
missed Plane — so any hand-written or pattern-scraped inventory would read as
complete while being wrong. Derive it from synthesized cdk8s output instead,
which is also the #2036 generate-don't-transcribe pattern.

### `/explanation/` — 17 pages, nested one level by subject

Sidebar label: **Concepts**. This is where the current wiki is already
strongest; the "Why it is shaped this way" sections are the best writing on the
site. They mostly need to be _let alone_ once reference and instructions are
lifted out.

| Route                                              | Source                                                        |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `/explanation/monorepo/`                           | NEW — orientation: what the repo is and how it hangs together |
| `/explanation/how-this-wiki-works/`                | → `how-this-wiki-works.md` + the home page's meta content     |
| `/explanation/homelab/overview/`                   | NEW — the missing homelab overview                            |
| `/explanation/homelab/release-safety/`             | → `homelab/releases.md`                                       |
| `/explanation/homelab/qbittorrent-webseed-relay/`  | → `homelab/qbittorrent-vpn-webseed-relay.md`                  |
| `/explanation/homelab/scout-evals-trust-boundary/` | → `homelab/scout-evals-tailnet-boundary.md`                   |
| `/explanation/homelab/buildkite-admission/`        | → `homelab/buildkite-admission.md`                            |
| `/explanation/homelab/plane/`                      | → `homelab/plane.md`                                          |
| `/explanation/homelab/tracker-tracker/`            | → `homelab/tracker-tracker.md`                                |
| `/explanation/temporal/overview/`                  | → `temporal/index.md` (system map + why Temporal)             |
| `/explanation/temporal/agent-task-boundary/`       | → `temporal/agent-tasks.md` (report-only _by policy_)         |
| `/explanation/temporal/event-surfaces/`            | → `temporal/events.md`                                        |
| `/explanation/temporal/workflow-families/`         | → the six workflow deep dives, consolidated                   |
| `/explanation/pr-fleet/authority-boundary/`        | → `pr-fleet-controller.md`                                    |
| `/explanation/birmel/`                             | → `birmel.md`                                                 |
| `/explanation/scout/temporal-analysis/`            | → `scout-analysis.md`                                         |
| `/explanation/tasks-for-obsidian/`                 | → `tasks-for-obsidian.md`                                     |

### Coverage gaps left open

`packages/toolkit` and the repo's own CI/verification system have no page. Named
here so they are visible; out of scope for this rewrite.

## Style rules

These are the rules that make it _read_ well. They go into the `diataxis` skill
(general form) and `packages/docs/wiki/AGENTS.md` (repo form), and are what a
reviewer checks against.

### Universal

- Open with a one-sentence answer to the page's question. Wikipedia lede shape:
  definition, then a short summary, then sections.
- One idea per sentence. Target under 25 words. At most one subordinate clause.
  If a sentence has two em-dash asides, it is three sentences.
- Bullets are lists of parallel items, not paragraph containers. Cap a bullet at
  roughly 40 words. A bullet that needs more is a subsection.
- Titles state the kind: `How to …`, `… reference`, `Why …` / `About …`.
- No workflow or provenance residue: no plan status, no "superseded," no
  "TODO stays open," no "the historical deep-dive plan." That lives in
  `packages/docs/`.
- State a fact once, in exactly one place, and link to it from everywhere else.
- Navigation lists cap at seven items. Landing pages introduce their contents in
  prose; they are never bare link lists.
- Every claim about the system links to the exact source file that proves it.

### Tutorials

- A lesson, not a procedure. The reader learns by doing; success is what they
  can now do, not what they produced.
- Ruthlessly minimise explanation. One clause is enough — link out for the rest.
- No options, no alternatives, no branching. One path to one visible result.
- Maintain a narrative of the expected: show real output, flag likely wrong
  turns, tell the reader what to notice.
- Must work every time. A tutorial that fails once has failed completely.

### How-to guides

- Titled for the reader's goal, never for the machine's operation.
- Assume competence. No teaching, no background, no explanation — link out.
- Conditional imperatives where reality forks: "If you want X, do Y."
- Practical usability over completeness; start and end somewhere reasonable.
- Every how-to links to the reference page holding its flags and values.

### Reference

- Describe and only describe. Austere, neutral, factual.
- Tables and lists, not prose. Consistent patterns across pages.
- Mirror the structure of the machinery being described.
- Examples are welcome as illustration; they must not become instruction.
- Reference links outward one-way only, so facts have a single home.

### Explanation

- Discussion, not instruction. You could read it away from the keyboard.
- Say _why_: design decisions, constraints, history, alternatives considered.
- Opinion and judgement are allowed and wanted here.
- Keep it bounded — the moment you are listing flags or steps, you are in the
  wrong genre; link out.
- Diagrams stay here. `accTitle` and `accDescr` remain mandatory.

## The `diataxis` skill

New skill at `packages/dotfiles/dot_agents/skills/diataxis/SKILL.md`, mirrored
to the live `~/.agents/skills/diataxis/` per the chezmoi dual-edit rule.

**General-purpose, not repo-specific.** `monorepo-docs` already owns the
repo-specific wiring; `diataxis` teaches the framework so it is useful in any
project. `monorepo-docs` and the wiki `AGENTS.md` point at it rather than
restating it.

Frontmatter follows the house skill format (`name`, `description`, and
`user-invocable: true` so it can be invoked directly):

```yaml
name: diataxis
description:
  Author and restructure technical documentation with the Diátaxis framework —
  tutorials, how-to guides, reference, and explanation. Use when writing or
  reorganising docs, when a page mixes instruction with description or
  discussion, when deciding where a piece of content belongs, or when the user
  mentions Diátaxis, docs structure, or a documentation rewrite.
```

Body sections:

1. **The compass first.** The two questions and the truth table, before anything
   else, because it is the tool that gets you unstuck.
2. **The four kinds** — one tight section each: what it is, what it must not
   contain, its characteristic language, and the failure mode to watch for.
3. **The two hard distinctions** — tutorial vs how-to, reference vs explanation.
   These are where authors actually go wrong.
4. **Style rules**, as above.
5. **Working method** — pick one page, assess it against the compass, make one
   improvement, publish. Phantom links for content that does not exist yet.
6. **Adaptations and limits** — do not create empty sections; troubleshooting is
   a how-to; no FAQ pages; the four types are a SHOULD; a link out always beats
   a digression.
7. **Starlight layout** — the #2036 conventions, so an agent building a docs
   site produces the house format by default.

Keep it under roughly 200 lines. A skill that has to be skimmed does not get
read, which is the same failure this whole plan is fixing.

## Prompt steering

Four surfaces need Diátaxis steering so the structure survives future edits.

| Surface                                                      | Change                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/docs/wiki/AGENTS.md`                               | Rewrite. This is the load-bearing one: replace the current authoring contract with the compass, the four sections and where each kind goes, the style rules, the D2/D3 adaptations, and a hard rule that a page is exactly one kind. Point at the `diataxis` skill for the framework itself |
| `packages/dotfiles/dot_agents/skills/monorepo-docs/SKILL.md` | Amend "Author the human wiki": state that the wiki is Diátaxis-structured, give the compass-to-directory table, and load the `diataxis` skill first                                                                                                                                         |
| `packages/docs/AGENTS.md` (`CLAUDE.md` symlinks to it)       | Update the wiki row of the "Where to Put New Docs" table and the "Wiki vs workflow docs" paragraph to name the four kinds                                                                                                                                                                   |
| Root `AGENTS.md` (`CLAUDE.md` symlinks to it)                | One paragraph in Documentation Discipline: wiki pages are Diátaxis-typed, one kind per page                                                                                                                                                                                                 |

The wiki `AGENTS.md` rewrite is the load-bearing one. Its previous page-shape
recipe — "a good default sequence is: system map, key responsibilities, why it
is this way, and where to look next" — instructed authors to put reference and
explanation on one page, which is plausibly where the current blended pages came
from. Leaving it would have re-created the problem on the next wiki edit.

## Machinery changes

- `astro.config.ts` — replace the hand-written sidebar with four `autogenerate`
  groups plus the existing Working-material group. Section labels: Tutorials,
  How-to guides, Reference, Concepts.
- `src/content.config.ts` — unchanged (plain `docsSchema()`, per D4).
- `tests/wiki.spec.ts` — assert every content file is the home page or lives
  under one of the four sections.
- Redirects — every one of the 25 current routes is linked from PRs and possibly
  bookmarked. Add Astro redirects from all of them to their successors.
- `sidebar.order` frontmatter on every page, since ordering no longer comes from
  the config.

## Phases

Each phase is a separate branch on one git-spice stack and is independently
shippable — the wiki stays coherent between phases.

| Phase | Scope                                                                                                                                         | Exit condition                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1     | The `diataxis` skill; chezmoi mirror; steering edits to wiki `AGENTS.md`, `monorepo-docs`, `packages/docs/CLAUDE.md`, root `CLAUDE.md`        | Skill loads and reads well; steering lands before any content is written, so later phases are authored under the new rules |
| 2     | Machinery: `autogenerate` sidebar, section directories, redirect table, section test                                                          | `bun run typecheck test build test:e2e` green; no content moved yet                                                        |
| 3     | Reference: create all seven reference pages by lifting facts out of existing pages                                                            | Every flag, path, schedule, and value in the wiki lives on exactly one reference page                                      |
| 4     | How-to: create all nine guides, using phantom links to phase-3 reference pages                                                                | No procedure remains embedded in an explanation page                                                                       |
| 5     | Explanation: rewrite all seventeen pages against the style rules, now that they carry only _why_                                              | No page mixes genres; sentence and bullet limits met                                                                       |
| 6     | Tutorials, home page, cross-link pass, gap fills (`/explanation/monorepo/`, `/explanation/homelab/overview/`, `/reference/homelab-services/`) | Home routes by need; every how-to links its reference; four formerly orphaned pages reachable                              |

Phase 1 leads deliberately: writing the steering first means phases 3–6 are
authored under the rules rather than retrofitted to them.

## Remaining

- [x] Confirm D1 (flat, Diátaxis-first per #2036) and D2 (ship two real tutorials).
- [x] Phase 1 — `diataxis` skill and four steering surfaces.
- [ ] Mirror the `diataxis` skill to `~/.agents/skills/` — happens when this
      branch merges and `chezmoi apply` runs from the `~/git/monorepo` checkout,
      which is chezmoi's source path. It cannot be done from a Conductor
      workspace.
- [x] Phase 2 — autogenerate sidebar, directories, redirects, structure test.
- [x] Phase 3 — six reference pages (`homelab-services` deferred, see above).
- [x] Phase 4 — nine how-to guides.
- [x] Phase 5 — seventeen explanation pages.
- [x] Phase 6 — home page, cross-links, and one tutorial.
- [x] Verify no page still contains workflow/plan residue.
- [x] Verify every retained old route redirects, as asserted in the e2e suite.
- [ ] Screenshot the rebuilt home page and one page of each kind in the PR.
- [ ] `/reference/homelab-services/` — generate from synthesized cdk8s output.
- [ ] A second tutorial, if a genuine lesson presents itself. `homelab-from-scratch`
      was cut during phase 6: setting up a workstation serves a reader _at work_,
      which makes it a how-to, and Diátaxis is explicit that a tutorial must work
      every time — not something to assert about an untested end-to-end cluster
      walkthrough. Padding the section would have been the exact conflation the
      new `diataxis` skill warns against.

## Human Verification

After phase 6 ships, read the wiki cold and decide:

1. From the home page, can you reach the thing you actually wanted in one or two
   clicks, without reading a page that is about the wiki itself?
2. Pick any how-to guide. Can you follow it start to finish without leaving the
   page for anything except a reference lookup you chose to make?
3. Pick any explanation page. Does it read like something you could read away
   from a terminal, or does it still stop to list flags?
4. Does the prose feel like it reads _well_ now, at the sentence level?
5. Does it feel like the same product as the Scout docs site in #2036?

Acceptance is Jerred's subjective judgement on (4) and (5); the first three are
structural and should be unambiguous.

## Comment Log

- 2026-08-09 — Plan created after reading the full diataxis.fr corpus (16
  pages), the deleted `complex-hierarchies` page via the Wayback Machine, Divio,
  Canonical, Cloudflare, Sequin, I'd Rather Be Writing, the Seven-Action Model,
  and three HN threads. Diagnosis is based on a full read of all 25 current wiki
  pages, `astro.config.ts`, and `wiki-publication.ts`.
- 2026-08-09 — Phases 2–6 shipped. The remaining blended pages became
  single-kind pages: 1 tutorial, 9 how-to guides, 6 reference pages, 17
  explanation pages, plus a need-routing home page. The sidebar is
  autogenerated, retained old routes redirect,
  and two new tests enforce the structure — every page must live in a Diátaxis
  section, and every internal link must resolve. The link test paid for itself
  immediately by catching two routes left stale by a late layout change.
- 2026-08-09 — Phase 1 shipped: the `diataxis` skill, the wiki `AGENTS.md`
  rewrite, and steering in `monorepo-docs`, `packages/docs/AGENTS.md`, and the
  root `AGENTS.md`. Correction to the prompt-steering table above: the blended
  page-shape recipe ("system map, key responsibilities, why it is this way, and
  where to look next") was in the wiki `AGENTS.md`, not the `monorepo-docs`
  skill. It is gone either way.
- 2026-08-09 — Revised against PR #2036 as the target format. Adopted its flat
  four-directory layout, `autogenerate` sidebar, Concepts label, splash home
  shape, and voice. Dropped the proposed `docType` frontmatter field (D4) and
  most of the orphan test (D5), both made redundant by `autogenerate`. Reversed
  the earlier decision to omit tutorials (D2). Added the `diataxis` skill and
  prompt steering as phase 1.
