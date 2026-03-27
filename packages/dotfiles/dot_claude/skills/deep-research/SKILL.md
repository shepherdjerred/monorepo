---
name: deep-research
description: >-
  This skill should be used when the user asks to "deep research", "research this topic",
  "investigate thoroughly", "do a deep dive on", "comprehensive research on",
  "find everything about", "survey the landscape of", "compare approaches to",
  "write a report on", "gather information about",
  or wants multi-source investigation with synthesis and citations.
  Also triggers on "what are the best practices for", "how do others solve",
  or "state of the art in" when the user clearly wants breadth and depth beyond a simple answer.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - WebSearch
  - WebFetch
  - TaskCreate
  - TaskUpdate
  - TaskList
---

# Deep Research

Conduct thorough, multi-source research on a topic with iterative investigation, cross-verification, and structured synthesis into a cited report.

## Overview

Deep research goes beyond a single search query. It decomposes a question into sub-topics, investigates each through multiple sources, identifies gaps, iterates to fill them, and synthesizes findings into a structured report with citations. The process is designed for transparency — the user sees the plan, approves it, and can steer the investigation.

## Task Tracking

Use `TaskCreate` and `TaskUpdate` throughout the research process to give the user visibility into progress. This is mandatory — do not skip task creation.

1. **At the start of Phase 2**, create a task for each sub-question from the research plan (e.g., "Investigate: [sub-question]"). Use `activeForm` to show what's happening in the spinner (e.g., "Investigating [sub-question]").
2. **At the start of each subsequent phase** (Draft, Adversarial Review, Editorial Synthesis, Deliver), create a task for that phase.
3. **Mark tasks `in_progress`** when you begin working on them and `completed` when done.
4. **For sub-agents**, create their tasks before launching them so the user can see parallel work in progress.

Keep task subjects short and specific. The description field should include enough context to understand scope.

## Effort Levels

Research intensity is controlled by an effort parameter: **low**, **medium** (default), **high**, or **ultra**. This acts as an exponential multiplier across the entire process.

| Parameter              | Low                                  | Medium         | High                       | Ultra                                           |
| ---------------------- | ------------------------------------ | -------------- | -------------------------- | ----------------------------------------------- |
| Sub-questions          | 3-5                                  | 5-7            | 8-12                       | 15-20                                           |
| Parallel agents        | 2                                    | 3-4            | 6-8                        | 10+                                             |
| Sources per question   | ~4                                   | ~8             | ~15                        | ~25+                                            |
| Iteration rounds (max) | 2                                    | 3              | 4                          | 6                                               |
| Adversarial review     | Lightweight (no source verification) | Full           | Full + source verification | Full + multiple reviewers + source verification |
| Output format          | Markdown + PDF                       | Markdown + PDF | Markdown + PDF             | Markdown + PDF (detailed)                       |
| Report length          | 3-5 pages                            | 6-12 pages     | 15-25 pages                | 30+ pages                                       |

**Determining effort:**

- "quick research", "brief overview" → **low**
- No qualifier (default) → **medium**
- "thorough", "comprehensive", "deep dive" → **high**
- "exhaustive", "leave no stone unturned", explicit "ultra" → **ultra**
- User can also specify explicitly (e.g., `/deep-research high: topic`)

All parameters in the workflow below (sub-question count, agent count, iteration limits, etc.) must follow the effort level table. When launching sub-agents, pass the effort level so they calibrate their depth accordingly.

## Core Workflow

Execute these phases in order. Do not skip Phase 1 or Phase 2.

### Phase 1: Plan (Interactive)

Before any searching, decompose the user's question:

1. **Clarify scope** — If the query is ambiguous, ask 1-2 focused questions (not more) to narrow down what the user actually needs. Skip if the intent is already clear.
2. **Decompose into sub-questions** — Break the topic into sub-questions per the effort level table. Each should target a distinct angle (e.g., "how does X work?", "what are alternatives to X?", "what do practitioners say about X?").
3. **Identify source types** — For each sub-question, note where to look: official docs, GitHub repos, HN discussions, academic papers, blog posts, Wikipedia, etc.
4. **Present the plan** — Show the user the research plan as a numbered list of sub-questions with source strategies. Ask for approval or modifications before proceeding.

```markdown
## Research Plan: [Topic]

### Sub-questions

1. [Sub-question] — Sources: [where to look]
2. [Sub-question] — Sources: [where to look]
   ...

### Effort: [low/medium/high/ultra]

- Sub-questions: [N] (per effort table)
- Sources per question: ~[M]
- Parallel agents: [P]
- Max iterations: [I]

Proceed with this plan?
```

### Phase 2: Investigate (Iterative)

For each sub-question, execute this loop:

```
SEARCH → READ → EXTRACT → EVALUATE → (iterate if gaps remain)
```

**Search strategy:**

- Start with `WebSearch` for broad discovery
- Use lightpanda for full page content extraction per global instructions
- Fall back to `WebFetch` if lightpanda fails on a particular URL
- For detailed search strategies and source evaluation heuristics, read `references/research-patterns.md`
- Use `Agent` tool to parallelize independent sub-question investigations — launch multiple research sub-agents for unrelated sub-questions simultaneously
- For GitHub-specific research, use `gh search repos`, `gh search code`, and browse READMEs directly

**Source priorities** (per user preferences):

1. GitHub repositories and READMEs
2. Hacker News discussions and comments
3. Wikipedia
4. Official documentation and first-party sources
5. Technical blog posts and articles
6. Academic papers (when relevant)

**Per-source extraction:**

- Extract key claims, data points, and quotes
- Note the source URL and a brief credibility assessment
- Flag disagreements between sources explicitly

**Gap analysis after each round:**

- List what is now known vs. what remains unanswered
- If significant gaps remain, formulate new search queries targeting those gaps
- Limit iterations to the maximum specified by the effort level table — after reaching the limit, synthesize with what is available and note remaining unknowns

**Context management:**

- After extracting findings from a source, distill them into bullet points — do not carry full page content forward
- Use a running findings list organized by sub-question
- When context grows large, summarize completed sub-questions to free up space

### Phase 2.5: Cross-Agent Reconciliation

When multiple agents investigated overlapping sub-questions, reconcile before drafting:

1. **Identify contradictions** — Compare agent findings on the same topic. Flag any claims where agents disagree.
2. **Resolve or escalate** — For each contradiction:
   - If one agent cited a primary source and the other cited a secondary source, prefer the primary
   - If both have equal sourcing, do a targeted follow-up search to break the tie
   - If unresolvable, note explicitly as contested in the draft
3. **Merge findings** — Create a unified findings list organized by sub-question (not by agent) before proceeding to the draft

### Phase 3: Draft Report

Compile findings into a structured markdown draft report:

```markdown
# [Research Topic]

## Summary

[2-3 paragraph executive summary of key findings]

## Findings

### [Sub-topic 1]

[Synthesized findings with inline citations as numbered references, e.g. [1]]

### [Sub-topic 2]

...

## Key Takeaways

- [Actionable insight 1]
- [Actionable insight 2]
- ...

## Open Questions

- [What remains unknown or contested]

## Sources

1. [Title](URL) — [brief description]
2. [Title](URL) — [brief description]
   ...
```

**Synthesis principles:**

- Cross-verify claims that appear in multiple sources; note conflicts
- Distinguish between widely-agreed facts and individual opinions
- Lead with what matters most to the user's original question
- Include direct quotes sparingly — only when they are particularly insightful
- Every factual claim should trace to at least one numbered source

### Phase 4: Adversarial Review

After drafting the report, perform an adversarial review scaled to the effort level (see effort table: lightweight at low, full at medium, full + source verification at high, full + multiple reviewers at ultra). This is a separate, critical pass whose sole job is to find problems. The adversary has no attachment to the draft — it exists to stress-test it.

**Launch a review sub-agent with this mandate:**

> Act as a skeptical, adversarial reviewer of the following research report. Your job is to find every weakness, not to be polite. Evaluate:
>
> 1. **Factual accuracy** — Are any claims unsupported, exaggerated, or contradicted by the cited sources? Are citations used correctly or do they misrepresent the source?
> 2. **Missing perspectives** — What important angles, counterarguments, or stakeholder viewpoints are absent? What would a knowledgeable critic say is missing?
> 3. **Logical gaps** — Are there non-sequiturs, unwarranted conclusions, or leaps in reasoning? Does the evidence actually support the takeaways?
> 4. **Source quality** — Are any sources low-credibility, outdated, or over-relied upon? Is the source diversity sufficient?
> 5. **Bias detection** — Does the report favor one side without acknowledging trade-offs? Is it selling a conclusion rather than presenting evidence?
> 6. **Staleness risk** — Are any claims likely outdated given the current date? Are there fast-moving areas where the findings may already be wrong?
>
> Return a structured critique with severity ratings (critical / major / minor) for each issue found. Be specific — cite the exact claim or section that is problematic and explain why.

> You have access to WebSearch, WebFetch, and Bash (for lightpanda). For any claim you flag as
> potentially inaccurate or exaggerated, spot-check it by visiting the cited source URL or
> searching for counter-evidence. Do not rely solely on logical analysis — verify at least the
> 3 most critical factual claims directly.

**The adversary must NOT:**

- Suggest rewording for style or tone
- Praise the report
- Hedge its criticisms

### Phase 5: Editorial Synthesis

Take the original draft report and the adversarial critique, and produce the final report. This is an editorial pass, not a rubber stamp.

**For each adversarial finding:**

| Severity     | Action                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** | Must be resolved — correct the claim, add the missing evidence, or remove the unsupported assertion. If resolution requires additional research, do a targeted follow-up search. |
| **Major**    | Should be resolved — add the missing perspective, strengthen the sourcing, or add a caveat.                                                                                      |
| **Minor**    | Use judgment — fix if straightforward, otherwise note in Open Questions.                                                                                                         |

**Editorial principles:**

- Do not simply append disclaimers to dodge criticisms — fix the underlying issue
- If the adversary identified a genuinely missing perspective, research it briefly and incorporate it
- If a claim cannot be adequately sourced after the adversary challenged it, downgrade it from a finding to an open question
- Preserve the report's readability — weave fixes into the narrative rather than adding a "corrections" section
- Add a brief "Methodology & Limitations" section at the end noting the research process, number of sources consulted, and any known blind spots the adversary surfaced that could not be fully resolved

The final report should read as if it was written correctly the first time — the adversarial process is invisible to the reader.

**Before proceeding to Phase 6**, walk through the Quality Checklist item by item. For each item, note pass/fail. If any item fails, fix it before delivering. This is a gate, not a suggestion.

### Phase 6: Deliver

Every research report is delivered in three formats: Markdown (`.md`), Typst (`.typ`), and PDF (`.pdf`).

1. **Create output directory** — Run `mkdir -p ~/.claude/research/` to ensure the directory exists.
2. **Write Markdown** — Save the final report to `~/.claude/research/[topic-slug].md`.
3. **Write Typst** — Do not mechanically convert Markdown to Typst. The Typst document should be _designed for the reader_. Load the `typst-authoring` skill (especially `references/visualizations.md`) and invest effort in:
   - **Comparison tables** instead of prose listing pros/cons
   - **Diagrams** (via fletcher, CeTZ, or pintorita) for architecture, flows, and relationships
   - **Callout boxes** (via gentle-clues) to highlight key findings, warnings, and recommendations
   - **Charts** (via lilaq or CeTZ) when presenting data, benchmarks, or trends
   - **Timeline diagrams** (via timeliney) for roadmaps or chronological analysis
   - **Visual hierarchy** — use color, spacing, and layout to guide the reader's eye
     The reader should be able to understand the core findings by scanning the document for 60 seconds. Save to `~/.claude/research/[topic-slug].typ`.
4. **Compile PDF** — Run `typst compile ~/.claude/research/[topic-slug].typ ~/.claude/research/[topic-slug].pdf`. If compilation fails, fix the Typst source (common issues: unescaped special characters `#`, `@`, `$` need `\#`, `\@`, `\$` in content text) and retry.
5. **Open PDF** — Run `open ~/.claude/research/[topic-slug].pdf` to open the rendered PDF for the user. This step is mandatory — always open the PDF. **Only open the PDF once the entire research process is 100% complete** — all phases finished, editorial synthesis done, quality checklist passed, and final PDF compiled without errors. Never open intermediate or draft versions.
6. **Present summary** — Show a concise inline summary with:
   - The report title and key findings (3-5 bullets)
   - File paths for all three outputs
   - An offer to go deeper on any sub-topic
   - Any actionable next steps the research revealed

## Parallelization Strategy

Maximize throughput by running independent work concurrently:

| Task                                        | Parallelizable? | How                                                |
| ------------------------------------------- | --------------- | -------------------------------------------------- |
| Investigating unrelated sub-questions       | Yes             | Launch multiple Agent sub-agents                   |
| Searching + reading within one sub-question | Sequential      | Each search informs the next                       |
| Cross-verifying a claim across sources      | Yes             | Fetch multiple URLs in parallel                    |
| Gap analysis                                | Sequential      | Requires all prior findings                        |
| Adversarial review                          | Yes             | Launch as sub-agent while preparing delivery notes |
| Editorial fixes requiring new research      | Yes             | Targeted searches in parallel                      |

When launching parallel sub-agents, give each a focused prompt:

- The specific sub-question to investigate
- The source types to prioritize
- Instructions to return distilled findings (not raw page content)
- A reminder to include source URLs for every claim

**Important:** Do not use `SendMessage` to communicate status updates about background agents. Plain text output is directly visible to the user — just output text normally. SendMessage is for team communication between agents, not for status updates to the user.

## Quality Checklist

Before delivering the final report, verify:

- [ ] Every factual claim has a cited source
- [ ] No source URLs are fabricated — every URL was actually visited
- [ ] Conflicts between sources are noted, not silently resolved
- [ ] The report directly answers the user's original question
- [ ] Open questions and limitations are explicitly stated
- [ ] The summary can stand alone for a reader who skips the details
- [ ] The adversarial review was completed and all critical/major findings addressed
- [ ] A Methodology & Limitations section is present
- [ ] All three output files (.md, .typ, .pdf) were generated and the PDF compiled without errors

## Adaptation by Research Type

| Research Type             | Emphasis                                               | Example                       |
| ------------------------- | ------------------------------------------------------ | ----------------------------- |
| **Technology comparison** | Feature matrices, trade-offs, community sentiment      | "Compare X vs Y vs Z"         |
| **Best practices survey** | Consensus patterns, anti-patterns, practitioner advice | "How do teams handle X?"      |
| **Landscape survey**      | Categorization, major players, trends                  | "What tools exist for X?"     |
| **Deep dive**             | Architecture, implementation details, edge cases       | "How does X work internally?" |
| **Decision support**      | Pros/cons, risk assessment, recommendations            | "Should we use X?"            |

Adjust source priorities and report structure to match the research type. For comparisons, use tables. For best practices, lead with the consensus view. For landscape surveys, categorize before detailing.

## Additional Resources

- **`references/research-patterns.md`** — Source evaluation heuristics, iteration patterns, and report structure templates by research type

When generating Typst output, load the `typst-authoring` skill for language reference and document templates.
