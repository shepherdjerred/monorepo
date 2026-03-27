# Research Patterns Reference

Detailed strategies for executing deep research effectively across different source types and research scenarios.

## Search Strategy Patterns

### Expanding Search

Start narrow, then widen based on initial findings:

1. **Exact match** — Search the specific term or project name
2. **Related terms** — Search synonyms, alternative names, and related concepts
3. **Meta-search** — Search for "best X", "X alternatives", "awesome X" lists
4. **Discussion search** — Search HN, Reddit, and forum discussions for practitioner perspectives

### Triangulation Search

Verify a claim by seeking 3 independent sources:

1. **Primary source** — Official docs, the project's own README, the original paper
2. **Independent analysis** — Blog posts, reviews, or benchmarks by third parties
3. **Community sentiment** — HN comments, GitHub issues, Stack Overflow discussions

If all 3 agree → high confidence claim.
If 2/3 agree → note the dissent.
If all 3 disagree → present as contested.

### Temporal Search

For fast-moving topics, include date constraints:

- Add year to searches: "topic 2025" or "topic 2026"
- Check GitHub repo activity: last commit date, issue activity, release frequency
- Look for "state of X in 2026" posts
- Cross-reference HN discussions by date to track sentiment shifts

## Source Evaluation Heuristics

### GitHub Repositories

| Signal       | High Quality                    | Low Quality                 |
| ------------ | ------------------------------- | --------------------------- |
| Stars        | >1000 for tools, >100 for niche | <10 with no forks           |
| Last commit  | Within 3 months                 | >1 year ago                 |
| Issues       | Active discussion, triaged      | Hundreds open, no responses |
| README       | Thorough, examples, badges      | Minimal or auto-generated   |
| License      | OSI-approved                    | None or restrictive         |
| Contributors | Multiple, diverse               | Single author only          |

### Hacker News Discussions

- **High signal:** Top comments with detailed technical analysis, first-hand experience reports, maintainer responses
- **Low signal:** Drive-by opinions, bikeshedding, tangential debates
- **Pattern:** Sort by points; the top 3-5 comments usually contain 80% of the value
- **Trick:** Search `site:news.ycombinator.com "topic"` for archived discussions

### Blog Posts and Articles

| Signal     | Trustworthy                                | Skeptical                       |
| ---------- | ------------------------------------------ | ------------------------------- |
| Author     | Named, with credentials/track record       | Anonymous or content-farm style |
| Date       | Recent and dated                           | Undated                         |
| Depth      | Shows working code, benchmarks, trade-offs | Surface-level overview only     |
| Tone       | Acknowledges limitations                   | Only positive, sales-like       |
| References | Links to primary sources                   | No external links               |

### Wikipedia

- Best for: Established concepts, historical context, terminology, algorithm descriptions
- Weak for: Cutting-edge tech, opinion-heavy topics, rapidly evolving projects
- Always check the "References" section for primary sources worth following

## Iteration Patterns

### Gap-Driven Iteration

After each research round, explicitly list:

```
KNOWN:
- [Fact 1] (source: X)
- [Fact 2] (source: Y)

UNKNOWN:
- [Gap 1] — needed because [reason]
- [Gap 2] — needed because [reason]

NEXT SEARCHES:
- "[query 1]" targeting [gap 1]
- "[query 2]" targeting [gap 2]
```

### Depth-First vs. Breadth-First

**Breadth-first** (default for landscape surveys):

- Cover all sub-questions at surface level first
- Then deepen on the most relevant ones
- Prevents rabbit-holing on a single sub-topic

**Depth-first** (better for deep dives):

- Fully investigate one sub-question before moving to the next
- Follow citation chains: source → its references → their references
- Good when understanding builds cumulatively

### Diminishing Returns Detection

Stop iterating on a sub-question when:

- New searches return sources already visited
- New sources repeat the same claims without new evidence
- The sub-question has 3+ independent, agreeing sources
- The user's original question can be answered with current findings

## Context Management Strategies

### Progressive Summarization

As research accumulates, compress earlier findings:

1. **Raw extraction** — Full quotes and details from sources (Phase 2, round 1)
2. **Key points** — Distilled bullets with source attribution (Phase 2, round 2+)
3. **Synthesized claims** — Merged findings across sources (Phase 3)

### Sub-Agent Delegation

When parallelizing with Agent tool, structure prompts as:

```
Investigate: [specific sub-question]

Search for: [2-3 specific queries to try]
Priority sources: [source types]

Return format:
- Key findings (3-7 bullets, each with source URL)
- Conflicts or disagreements found
- Suggested follow-up questions (if any)

Do NOT return raw page content. Distill findings only.
```

### Citation Tracking

Maintain a running source list during investigation:

```
SOURCES:
[1] Title - URL - credibility: high/medium/low - accessed: date
[2] Title - URL - credibility: high/medium/low - accessed: date
```

Assign numbers as sources are encountered. Reference by number in findings. This makes final report citation assembly straightforward.

## Report Structures by Type

### Technology Comparison Report

```markdown
# Comparison: X vs Y vs Z

## Summary

[Which to choose and when]

## Feature Comparison

| Feature | X   | Y   | Z   |
| ------- | --- | --- | --- |
| ...     |     |     |     |

## Detailed Analysis

### X

[Strengths, weaknesses, best for]

### Y

...

## Community Sentiment

[What practitioners prefer and why]

## Recommendation

[For user's specific context]
```

### Best Practices Survey Report

```markdown
# Best Practices: [Topic]

## Summary

[Consensus view]

## Established Practices

[Things most sources agree on]

## Emerging Practices

[Newer approaches gaining traction]

## Anti-Patterns

[What to avoid and why]

## Context-Dependent Choices

[Practices that depend on situation]
```

### Landscape Survey Report

```markdown
# Landscape: [Domain]

## Summary

[State of the field]

## Categories

### Category A

- Tool 1 — [description, stars, status]
- Tool 2 — ...

### Category B

...

## Trends

[Where things are heading]

## Notable Gaps

[What doesn't exist yet but should]
```
