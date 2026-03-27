# Grading Rubric: Detailed Per-Dimension Criteria

This rubric defines what each score level looks like for each of the four evaluation dimensions. Use this to assign consistent, calibrated scores.

## Scoring Scale

- **4 (Strong Hire / A):** Exceeds expectations. Would impress an OAI interviewer.
- **3 (Hire / B):** Meets the bar. Solid, competent, production-ready.
- **2 (Lean No Hire / C):** Below the bar. Significant gaps that would concern an interviewer.
- **1 (Strong No Hire / D-F):** Well below expectations. Fundamental issues.

Half-point increments (3.5, 2.5, etc.) are used for borderline cases.

---

## Dimension 1: Problem Solving

### Score 4 (Strong Hire)

- Optimal or near-optimal algorithm chosen with clear justification
- Data structures perfectly matched to the problem (e.g., `TreeMap` for time-versioned lookups, `ArrayDeque` for stack operations)
- Time and space complexity are optimal; candidate clearly understands why
- Multiple approaches considered (visible in comments or design evolution across parts)
- Tradeoffs articulated: "I chose X over Y because Z"
- Handles all constraints from the problem statement without prompting
- Follow-up parts handled gracefully without redesigning from scratch

### Score 3 (Hire)

- Correct algorithm that solves the problem
- Reasonable data structure choices (may not be optimal but are defensible)
- Complexity is acceptable even if not optimal
- Solution works for the stated problem but may miss subtle edge cases
- Some follow-up parts handled, but design may strain under later parts

### Score 2 (Lean No Hire)

- Algorithm is partially correct but has logical errors
- Data structure choices are suboptimal (e.g., `ArrayList` where `HashMap` is needed for O(1) lookup)
- Missing complexity awareness -- O(n^2) where O(n log n) is straightforward
- Problem constraints not fully addressed
- Follow-up parts require significant rewrite of earlier code

### Score 1 (Strong No Hire)

- Cannot produce a working solution
- Fundamental misunderstanding of the problem
- Data structures chosen randomly or incorrectly
- No awareness of complexity

---

## Dimension 2: Code Quality

### Score 4 (Strong Hire)

- Every variable name communicates intent: `resolvedPath`, `expirationTime`, `cellDependencies`
- Logic decomposed into well-named helper methods: `resolveSymlinks()`, `detectCycle()`, `consumeOldestCredits()`
- Single responsibility per method -- no method does "too much"
- Edge cases handled proactively with clear guards at method entry
- Readability is high -- a new team member could understand this code without explanation
- No dead code, no commented-out code, no debug prints left behind
- Consistent style and formatting throughout
- Defensive programming: validates inputs, handles nulls, uses appropriate exceptions

### Score 3 (Hire)

- Most names are meaningful; occasional `temp` or `result` is acceptable
- Some helper methods exist but logic could be further decomposed
- Edge cases mostly handled, perhaps missing 1-2 corner cases
- Code is readable but may require some effort to follow in places
- Minor style inconsistencies
- Occasional code smell that doesn't affect correctness

### Score 2 (Lean No Hire)

- Poor naming: `m`, `d`, `arr`, `x`, `temp` used for important variables
- Monolithic methods: one method does everything (50+ lines of logic)
- Edge cases mostly ignored -- empty input, null, boundaries not handled
- Hard to read: nested conditionals, unclear flow, magic numbers
- Copy-pasted logic instead of helper methods
- Debug output left in (`System.out.println` for debugging)

### Score 1 (Strong No Hire)

- Incomprehensible variable names
- No structure -- all code in one method/block
- No edge case handling at all
- Code doesn't compile or has obvious syntax errors
- Fundamentally unreadable

---

## Dimension 3: Communication (Async/Written Adaptation)

In a live interview, Communication evaluates verbal reasoning. For written code review, evaluate the code's ability to communicate intent and reasoning to a reader.

### Score 4 (Strong Hire)

- Code is self-documenting: naming and structure make the algorithm obvious
- Comments explain _why_ decisions were made, not _what_ the code does
  - Good: `// Using TreeMap for O(log n) floor lookup by timestamp`
  - Bad: `// loop through the list`
- Javadoc on public methods describes contract, parameters, return values, exceptions
- Tradeoff reasoning visible: `// Considered X but chose Y because...`
- API design is intuitive: method signatures tell you what they do
- **Note:** Template-provided Javadoc (class-level problem header) does NOT count. Only evaluate user-authored communication signals.

### Score 3 (Hire)

- Code is mostly self-documenting through naming
- Some helpful comments exist but reasoning isn't always visible
- Method signatures are reasonable
- Code structure communicates the algorithm's flow

### Score 2 (Lean No Hire)

- Code requires significant effort to understand
- Comments are absent or useless (`// process data`, `// do stuff`)
- Method signatures are unclear (e.g., `void process(Object data)`)
- No visible reasoning about approach or tradeoffs

### Score 1 (Strong No Hire)

- Code is incomprehensible without verbal explanation
- No comments, no documentation
- Method signatures are misleading or confusing

---

## Dimension 4: Testing (Defensive Coding)

Since we grade implementation only (not test files), Testing evaluates how defensively the code is written and how well it handles edge cases _within the implementation_.

### Score 4 (Strong Hire)

- Input validation at _boundary_ entry points (user-facing data, external API responses)
- Null checks for boundary inputs; internal contract violations (e.g., a Function parameter returning null) should fail with NPE -- do not penalize absence of guards for these
- Boundary conditions explicitly handled (empty collections, zero, max values)
- Error conditions throw meaningful exceptions with descriptive messages
- Edge cases from the problem statement are all addressed
- Defensive copies where mutable state could leak
- Guard clauses prevent invalid state

### Score 3 (Hire)

- Most important edge cases handled
- Some input validation present
- Error handling exists but may not cover all paths
- Boundary conditions mostly addressed

### Score 2 (Lean No Hire)

- Minimal edge case handling
- No input validation at boundary points (user-facing data, external inputs)
- Exceptions are generic or absent
- Code assumes happy-path inputs even at system boundaries

### Score 1 (Strong No Hire)

- No defensive coding whatsoever
- Would crash on boundary inputs (user-facing null, empty, or invalid data)
- No error handling

---

## Follow-up Readiness (Bonus Dimension)

This is not scored numerically but assessed as Yes/No/Partial.

### Yes (Code is follow-up ready)

- Clear abstractions that can be extended
- Logic is separated into layers (parsing, processing, output)
- Adding a new feature (concurrency, persistence, new operations) would require adding code, not rewriting existing code
- Interfaces or abstract patterns make extension natural

### Partial (Some refactoring needed)

- Core logic is sound but tightly coupled in places
- Adding the next part would require refactoring 1-2 methods but not a full rewrite
- Some abstractions exist but aren't quite at the right level

### No (Rewrite required)

- Logic is monolithic -- everything is in one method
- Adding the next part's requirements would require starting over
- No separation of concerns
- Hard-coded assumptions that the next part would violate

---

## Overall Verdict Logic

The overall verdict is determined by the **lowest dimension score**, because OAI treats coding as a gate:

| Lowest Dimension Score | Overall Verdict |
| ---------------------- | --------------- |
| >= 3.5                 | Strong Hire     |
| 3.0 - 3.4              | Hire            |
| 2.0 - 2.9              | Lean No Hire    |
| < 2.0                  | Strong No Hire  |

One failing dimension (< 3.0) means the overall verdict cannot be Hire or better, regardless of how strong the other dimensions are. This mirrors OAI's gating behavior where a weak coding score blocks the candidate.
