---
name: oai-solution-reviewer
description: |
  This skill should be used when the user asks to "grade my solution", "review my code",
  "score this", "how did I do", "grade sheet", "review my OAI prep", "grade my practice problem",
  "review my interview prep", "evaluate my solution", "how would this score",
  or wants feedback on a coding interview practice solution.
  Evaluates Java implementations against OpenAI interviewer grading criteria and produces
  a comprehensive grade sheet with letter grades, numeric scores, pass/fail, and prose feedback.
---

# OAI Solution Reviewer

Grade coding interview practice solutions against OpenAI's interviewer evaluation criteria. Produces a structured grade sheet combining letter grades (A-F), numeric scores (1-4), pass/fail verdicts, and detailed prose feedback per dimension.

## When to Use

User solutions are typically in `practice/leetcode/src/main/java/sjer/red/openai/` with progressive parts (P1, P2, P3+). Works for any coding problem, not just OAI-specific ones. The user writes Java.

## Evaluation Workflow

### Step 1: Read the Solution

Read the implementation file(s) the user wants graded. If the problem has multiple parts (P1, P2, P3), read all completed parts to assess follow-up readiness. Do not read or grade test files -- focus on the implementation only.

Identify from the code:
- The problem being solved (from Javadoc header or class name)
- Which part number this is (P1, P2, P3, etc.)
- Whether earlier parts exist (to evaluate progression)

### Step 2: Evaluate Four Dimensions

Score each dimension using the detailed rubric in `references/grading-rubric.md`. Consult `references/java-quality-checklist.md` for Java-specific quality signals.

**Dimension 1 -- Problem Solving**
- Is the approach correct and efficient?
- Are the right data structures chosen for the job?
- Is time/space complexity optimal or near-optimal?
- Are tradeoffs considered (visible in comments or design choices)?
- Does the solution handle the problem's core constraints?

**Dimension 2 -- Code Quality**
- Are variable/method names meaningful and descriptive?
- Is logic decomposed into helper methods with single responsibility?
- Are edge cases handled proactively (null, empty, boundaries)?
- Is the code readable without requiring mental gymnastics?
- Are Java idioms used correctly? (Consult `references/java-quality-checklist.md`)
- Is this production-quality code, not just "passes the tests" code?

**Dimension 3 -- Communication**
- Does the code self-document through naming and structure?
- Do comments explain *why*, not *what*?
- Is the API design clear (method signatures, return types, Javadoc)?
- Is reasoning visible in the code (approach comments, tradeoff notes)?
- **Template exclusion:** The class-level Javadoc problem header is template-provided, not user-written. Do not credit it. Only evaluate user-authored communication: naming choices, structural clarity, inline comments, method-level Javadoc they added, and tradeoff notes.
- *Limitation:* Verbal fluency and live interviewer interaction cannot be assessed from written code. Note this in the grade sheet.

**Dimension 4 -- Testing**
- Does the implementation defensively handle edge cases in its logic?
- Are boundary conditions addressed (empty collections, zero, negative, overflow)?
- Are error conditions handled gracefully (exceptions, invalid input)?
- Is there evidence of thinking about what could go wrong?
- **Contract vs boundary distinction:** Only penalize missing null handling for *boundary inputs* (user-facing data, external API responses). When null represents a broken caller contract (e.g., a `Function<>` parameter returning null), an NPE is the correct failure mode -- do not penalize its absence.

### Step 3: Assess Follow-up Readiness

If the solution is part of a progressive series (P1 -> P2 -> P3):
- Is the code modular enough that the next part would NOT require a rewrite?
- Are abstractions at the right level to accommodate added complexity?
- Would adding concurrency, persistence, or new features require gutting the existing design?

If earlier parts exist, compare: did the code evolve gracefully, or did each part require starting over?

### Step 4: Generate Grade Sheet

Produce the grade sheet in exactly this format:

```
# Grade Sheet: [Problem Name] -- Part [N]

## Overall Verdict: [Strong Hire / Hire / Lean No Hire / Strong No Hire]

## Dimension Scores

| Dimension | Letter | Score (1-4) | Pass/Fail |
|-----------|--------|-------------|-----------|
| Problem Solving | [A-F] | [1.0-4.0] | [PASS/FAIL] |
| Code Quality | [A-F] | [1.0-4.0] | [PASS/FAIL] |
| Communication | [A-F] | [1.0-4.0] | [PASS/FAIL] |
| Testing | [A-F] | [1.0-4.0] | [PASS/FAIL] |

## Detailed Feedback

### Problem Solving [Letter | Score/4 | PASS/FAIL]
**Strengths:** [what was done well]
**Improvements:** [specific, actionable changes]

### Code Quality [Letter | Score/4 | PASS/FAIL]
**Strengths:** [what was done well]
**Improvements:** [specific, actionable changes]
**Java-specific:** [idiom usage, anti-patterns found]

### Communication [Letter | Score/4 | PASS/FAIL]
**Strengths:** [what was done well]
**Improvements:** [specific, actionable changes]
*Note: Verbal communication cannot be assessed from written code.*

### Testing [Letter | Score/4 | PASS/FAIL]
**Strengths:** [defensive coding observed]
**Improvements:** [edge cases missed, error handling gaps]

## Follow-up Readiness
- Could this code extend to Part [N+1] without a rewrite? [Yes/No/Partial]
- What would need to change? [specific refactoring needed]

## If This Were a Real Interview...
[1-2 paragraph honest, direct assessment. No sugarcoating. Would this pass at OAI?
What would the interviewer's internal notes say? What would tip the decision?]

## Top 3 Action Items
1. [highest-impact improvement]
2. [second priority]
3. [third priority]
```

### Scoring Guide (Quick Reference)

| Score | Letter | Verdict | Pass/Fail Threshold |
|-------|--------|---------|---------------------|
| 3.7-4.0 | A/A+ | Strong Hire | PASS |
| 3.3-3.6 | A-/B+ | Hire | PASS |
| 3.0-3.2 | B/B+ | Hire (borderline) | PASS |
| 2.5-2.9 | B-/C+ | Lean No Hire | FAIL |
| 2.0-2.4 | C/C- | Lean No Hire | FAIL |
| 1.0-1.9 | D/F | Strong No Hire | FAIL |

Pass threshold is 3.0 (maps to "Hire"). Overall verdict is the *lowest* dimension verdict -- one FAIL dimension means the overall cannot be higher than Lean No Hire.

### Grading Principles

- *Be honest, not encouraging.* The goal is to prepare for a real interview, not to feel good. A 2.5 is a 2.5.
- *Be specific, not vague.* "Naming could be better" is useless. "Rename `m` to `cellDependencies` on line 47" is actionable.
- *Grade against OAI's bar, not a general bar.* OAI expects production-quality code. A solution that "works" but is messy is a Lean No Hire.
- *Acknowledge what's done well.* Strong Hire signals should be called out so the user knows what to keep doing.
- *Java-specific feedback matters.* Using `Stack` instead of `ArrayDeque` or raw types is a concrete signal to interviewers.

## Additional Resources

### Reference Files

For detailed scoring criteria and checklists, consult:
- **`references/grading-rubric.md`** -- Per-dimension scoring criteria at each level (Strong Hire through Strong No Hire) with concrete examples
- **`references/java-quality-checklist.md`** -- Java-specific idiom checks, anti-pattern detection, and data structure selection guidance
