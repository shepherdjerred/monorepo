---
name: diataxis
description: Author and restructure technical documentation with the Diátaxis framework — tutorials, how-to guides, reference, and explanation. Use when writing or reorganising docs, when a page mixes instruction with description or discussion, when deciding where a piece of content belongs, when a doc "reads badly" without an obvious cause, or when the user mentions Diátaxis, docs structure, or a documentation rewrite.
user-invocable: true
---

# Diátaxis

[Diátaxis](https://diataxis.fr/) says there are exactly four kinds of technical
documentation, because there are exactly two axes of any craft. Each kind serves
one user need and must not be mixed with the others on one page.

Most bad documentation is not badly written. It is **two or three kinds of
documentation on one page**, each getting in the other's way.

## The compass — use this first

When you don't know what a page is, what it should be, or why it feels wrong,
ask two questions:

1. Does it inform **action** (doing) or **cognition** (thinking)?
2. Does it serve **acquisition** (the reader is at study) or **application**
   (the reader is at work)?

| Informs   | Serves      | It is a       |
| --------- | ----------- | ------------- |
| action    | acquisition | tutorial      |
| action    | application | how-to guide  |
| cognition | application | reference     |
| cognition | acquisition | explanation   |

Apply it to a whole page, a section, or a single sentence. The most useful move
in a rewrite is running the compass over one paragraph at a time and relocating
whatever answers a different question than its neighbours.

|                            | **Action**   | **Cognition** |
| -------------------------- | ------------ | ------------- |
| **Acquisition** (at study) | Tutorial     | Explanation   |
| **Application** (at work)  | How-to guide | Reference     |

## The four kinds

### Tutorial — a lesson

A learning experience. The reader does something meaningful under your guidance
and gains confidence. Success is what they can now do, not what they produced.

- **Must not contain:** explanation, options, alternatives, or completeness for
  its own sake.
- **Language:** "In this tutorial we will…", "First, do x. Now do y.", "The
  output should look something like…", "Notice that…"
- **Failure mode:** the author cannot resist teaching. Explanation dissolves the
  learner's attention. One clause is enough — link out for the rest.
- Show the destination up front. Deliver a visible result at every step. Narrate
  what to expect and what to notice. Permit repetition. It must work every time.

### How-to guide — a recipe

Directions that get a competent reader from a real problem to a result.

- **Must not contain:** teaching, background, or reference for completeness.
- **Language:** "This guide shows you how to…", "If you want x, do y", "Refer to
  the x reference for the full list of options."
- **Failure mode:** written from the machine's perspective ("To deploy, press
  Deploy") instead of the reader's goal. Title it for the goal.
- Address real-world complexity — a guide useful for exactly one narrow case is
  rarely useful. Practical usability beats completeness. Sequences may fork.

### Reference — a description

Facts the reader consults while working. Austere, neutral, authoritative.

- **Must not contain:** instruction, discussion, or opinion.
- **Language:** "Sub-commands are: a, b, c." "You must not apply b unless c."
- **Failure mode:** examples grow into explanation. Illustrate, never instruct.
- Mirror the structure of the thing described. Adopt consistent patterns — the
  value of reference is that it is boring and predictable. Tables, not prose.
- Generated reference (from code, schemas, registries) beats transcribed
  reference, because it cannot drift.

### Explanation — a discussion

Understanding, from a wider angle. The only kind you would read away from the
keyboard.

- **Must not contain:** steps, or a list of flags.
- **Language:** "The reason for x is historically y…", "w is better than z
  because…", "Some prefer w, which can be good, but…"
- **Failure mode:** it absorbs everything nearby, because every topic touches
  instruction and description. Keep it bounded; link out.
- Say *why*: design decisions, constraints, history, alternatives rejected.
  Opinion and judgement belong here and nowhere else. Make connections.
- It may be called Concepts, Background, Discussion, or Topics.

## The two distinctions people actually get wrong

**Tutorial vs how-to** is the most common and most damaging conflation. Both are
practical, both are step-by-step, so they look alike. The difference is the
reader: **at study** or **at work**.

| Tutorial                              | How-to guide                       |
| ------------------------------------- | ---------------------------------- |
| builds basic competence               | assumes competence                 |
| a managed path, one line, no choices  | forks and branches; the real world |
| a contrived, safe, repeatable setting | whatever reality throws at it      |
| eliminates the unexpected             | prepares for the unexpected        |
| responsibility lies with the teacher  | responsibility lies with the user  |
| concrete and particular               | general, adaptable                 |

It is *not* the difference between basic and advanced. A how-to can be
elementary; a tutorial can be highly advanced.

**Reference vs explanation** is easier but slips. Rules of thumb: if it is
boring and unmemorable it is reference; lists and tables are reference; if you
can imagine reading it in the bath it is explanation. The real test is the same
one — would the reader reach for this *while working*, or *while reflecting*?

## Style rules

These are what make documentation read well, independent of structure.

**Universal**

- Open with a one-sentence answer to the page's question, then a short summary,
  then sections. (Wikipedia's lede shape works because it has been refined for
  25 years.)
- One idea per sentence. Under ~25 words. At most one subordinate clause. A
  sentence with two em-dash asides is three sentences.
- Bullets are lists of parallel items, not paragraph containers. Cap ~40 words;
  anything longer wants to be a subsection.
- Titles state the kind: `How to …`, `… reference`, `Why …` / `About …`.
- State a fact once, in one place, and link to it from everywhere else.
- Navigation lists cap at about seven items. Landing pages introduce their
  contents in prose — never a bare list of links.
- No project-management residue: no plan status, no "superseded", no "TODO
  remains open". That belongs in the tracker, not the docs.

## Working method

Diátaxis is a guide, not a plan. Do not design the perfect structure up front,
and **never create empty section shells** — structure is what emerges from
improving pages, not what you impose before writing them.

The loop:

1. **Choose something.** Any page, section, or paragraph. Don't go hunting.
2. **Assess it.** What need does this serve? How well? Do its language and form
   match that kind?
3. **Decide one action** that improves it now.
4. **Do it, and ship it.** Then repeat.

Two techniques worth using:

- **Phantom links.** When you feel the urge to explain inside a how-to, link to
  a reference or explanation page that does not exist yet. The broken links
  become your work list.
- **Expect it to look worse first.** Diátaxis exposes gaps that blur was hiding.
  That is the tool working, not a setback.

## Adaptations and limits

- **The four kinds are a SHOULD, not a MUST.** The most common failure in
  practice is dogmatic application. A link out always beats a digression, but a
  one-clause aside beats a link the reader must chase.
- **Examples in reference are correct** and endorsed — they illustrate. They
  stop being correct when they start instructing.
- **Cross-link densely.** Splitting into four sections without links makes docs
  *harder* to use. Every how-to links its reference. Reference links out one-way,
  so facts keep a single home.
- **Don't add a click to the thing read 95% of the time.** Deep-link the
  highest-traffic pages from the landing page.
- **Troubleshooting is a how-to** (`How to diagnose …`). **"Should I use this?"
  is explanation.** Avoid FAQ pages — an FAQ is where content goes when nobody
  will decide where it belongs.
- **Diátaxis cannot give you accuracy or completeness.** It addresses flow, fit,
  and anticipating the reader. Correctness is still your job.
- Very large doc sets may need a second axis (subject, audience, platform).
  That is allowed: Diátaxis is not four boxes. Ask whether the subjects are
  effectively different products for different readers — if so, lead with
  subject; otherwise lead with the four kinds.

## Starlight layout

The house format for a Diátaxis site in this ecosystem:

```text
src/content/docs/
├── index.md          # splash: hero + one section per reader need
├── tutorials/
├── how-to/
├── reference/
└── explanation/      # labelled "Concepts" in the sidebar
```

- Files are kebab-case and named for the reader's goal
  (`troubleshoot-notifications.md`, not `notifications.md`).
- Sidebar groups use `{ autogenerate: { directory: "…" } }`, with order from
  each page's `sidebar.order` frontmatter. Autogeneration means a new page is
  never orphaned.
- Plain `docsSchema()`. The directory is the page's kind; do not add a
  frontmatter field that restates it.
- The home page routes by need, in this order: Start here / Solve a specific
  problem / Look something up / Understand how it fits together.
- `.md` by default; `.mdx` only where a page renders generated content.

Page shapes that work:

- **Tutorial:** "In this tutorial you will…", a time estimate, a screenshot of
  the payoff *before* step 1, numbered `## N. Step` sections, "What you did",
  then "From here" links.
- **How-to:** one orienting sentence, numbered steps ordered so each rules out
  the most ground, tables for facts, asides for traps, "## Related" at the end.

## Reference

- <https://diataxis.fr/> — the framework. The most useful page in practice is
  [the compass](https://diataxis.fr/compass/).
- In `shepherdjerred/monorepo`, load `monorepo-docs` for where documentation
  belongs, and follow `packages/docs/wiki/AGENTS.md` for the wiki's rules.
