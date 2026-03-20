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
---

# Deep Research

Conduct thorough, multi-source research on a topic with iterative investigation, cross-verification, and structured synthesis into a cited report.

## Overview

Deep research goes beyond a single search query. It decomposes a question into sub-topics, investigates each through multiple sources, identifies gaps, iterates to fill them, and synthesizes findings into a structured report with citations. The process is designed for transparency — the user sees the plan, approves it, and can steer the investigation.

## Core Workflow

Execute these phases in order. Do not skip Phase 1 or Phase 2.

### Phase 1: Plan (Interactive)

Before any searching, decompose the user's question:

1. **Clarify scope** — If the query is ambiguous, ask 1-2 focused questions (not more) to narrow down what the user actually needs. Skip if the intent is already clear.
2. **Decompose into sub-questions** — Break the topic into 3-7 specific, answerable sub-questions. Each should target a distinct angle (e.g., "how does X work?", "what are alternatives to X?", "what do practitioners say about X?").
3. **Identify source types** — For each sub-question, note where to look: official docs, GitHub repos, HN discussions, academic papers, blog posts, Wikipedia, etc.
4. **Present the plan** — Show the user the research plan as a numbered list of sub-questions with source strategies. Ask for approval or modifications before proceeding.

```markdown
## Research Plan: [Topic]

### Sub-questions
1. [Sub-question] — Sources: [where to look]
2. [Sub-question] — Sources: [where to look]
...

### Estimated depth
- Breadth: [N] sub-questions
- Sources per question: ~[M]
- Expected iterations: [1-3]

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
- Limit to 3 iterations maximum to avoid runaway cost — after 3 rounds, synthesize with what is available and note remaining unknowns

**Context management:**
- After extracting findings from a source, distill them into bullet points — do not carry full page content forward
- Use a running findings list organized by sub-question
- When context grows large, summarize completed sub-questions to free up space

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

After drafting the report, launch an adversarial review via a sub-agent. This is a separate, critical pass whose sole job is to find problems. The adversary has no attachment to the draft — it exists to stress-test it.

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

**The adversary must NOT:**
- Suggest rewording for style or tone
- Praise the report
- Hedge its criticisms

### Phase 5: Editorial Synthesis

Take the original draft report and the adversarial critique, and produce the final report. This is an editorial pass, not a rubber stamp.

**For each adversarial finding:**

| Severity | Action |
|----------|--------|
| **Critical** | Must be resolved — correct the claim, add the missing evidence, or remove the unsupported assertion. If resolution requires additional research, do a targeted follow-up search. |
| **Major** | Should be resolved — add the missing perspective, strengthen the sourcing, or add a caveat. |
| **Minor** | Use judgment — fix if straightforward, otherwise note in Open Questions. |

**Editorial principles:**
- Do not simply append disclaimers to dodge criticisms — fix the underlying issue
- If the adversary identified a genuinely missing perspective, research it briefly and incorporate it
- If a claim cannot be adequately sourced after the adversary challenged it, downgrade it from a finding to an open question
- Preserve the report's readability — weave fixes into the narrative rather than adding a "corrections" section
- Add a brief "Methodology & Limitations" section at the end noting the research process, number of sources consulted, and any known blind spots the adversary surfaced that could not be fully resolved

The final report should read as if it was written correctly the first time — the adversarial process is invisible to the reader.

### Phase 6: Deliver

- Write the report to a file if the user requested it, or present inline
- Offer to go deeper on any sub-topic
- If the research revealed actionable next steps, highlight them

## Parallelization Strategy

Maximize throughput by running independent work concurrently:

| Task | Parallelizable? | How |
|------|-----------------|-----|
| Investigating unrelated sub-questions | Yes | Launch multiple Agent sub-agents |
| Searching + reading within one sub-question | Sequential | Each search informs the next |
| Cross-verifying a claim across sources | Yes | Fetch multiple URLs in parallel |
| Gap analysis | Sequential | Requires all prior findings |
| Adversarial review | Yes | Launch as sub-agent while preparing delivery notes |
| Editorial fixes requiring new research | Yes | Targeted searches in parallel |

When launching parallel sub-agents, give each a focused prompt:
- The specific sub-question to investigate
- The source types to prioritize
- Instructions to return distilled findings (not raw page content)
- A reminder to include source URLs for every claim

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

## Adaptation by Research Type

| Research Type | Emphasis | Example |
|---------------|----------|---------|
| **Technology comparison** | Feature matrices, trade-offs, community sentiment | "Compare X vs Y vs Z" |
| **Best practices survey** | Consensus patterns, anti-patterns, practitioner advice | "How do teams handle X?" |
| **Landscape survey** | Categorization, major players, trends | "What tools exist for X?" |
| **Deep dive** | Architecture, implementation details, edge cases | "How does X work internally?" |
| **Decision support** | Pros/cons, risk assessment, recommendations | "Should we use X?" |

Adjust source priorities and report structure to match the research type. For comparisons, use tables. For best practices, lead with the consensus view. For landscape surveys, categorize before detailing.

## Additional Resources

- **`references/research-patterns.md`** — Source evaluation heuristics, iteration patterns, and report structure templates by research type
