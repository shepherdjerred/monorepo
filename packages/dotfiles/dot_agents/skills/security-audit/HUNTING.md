# Vulnerability Hunting

### Phase 2: Hunt for vulnerabilities

Launch **multiple `general` agents in parallel** via the Task tool. Use `general`, not `research` — general agents can spawn their own sub-agents via the Task tool, so when a hunter finds a rabbit hole that needs deeper investigation (e.g., tracing injection into an auth subsystem it doesn't fully understand), it can spin up a focused `research` sub-agent rather than trying to do everything in one context window.

Each agent gets the architecture summary from Phase 1 injected into its prompt plus the hunting methodology and validation rules. Launch them in a single message so they run concurrently.

**How many agents?** Use Phase 1 to decide. Focused agents produce better results than overly broad ones that exhaust context. For a small library, 3-4 agents suffice. For a larger application with distinct subsystems (e.g., an auth system, a plugin system, a media pipeline, and a comment engine), you can split by vulnerability class and subsystem (8-12+ agents) — **unless** the current harness is sensitive to wide parallel fan-out, in which case use **reduced-fan-out mode** (3-4 subsystem-scoped defensive review agents or a single-session sequential static review). Never retry a `cyber_policy` or platform safety refusal (`retries = 0`); follow the refusal policy in `SKILL.md`.

Every agent prompt MUST include:
1. The `Authorized Defensive Review Scope` preamble (with `<path>` filled in) at the very top
2. The architecture summary from Phase 1 (copy it in verbatim)
3. The specific vulnerability class and subsystem scope to review
4. Relevant file paths from Phase 1 as starting points
5. The defensive analysis methodology (below)
6. The validation rules (below)

#### Defensive analysis methodology — include in every Phase 2 agent prompt

Give each agent rigorous, boundary-focused vulnerability analysis instructions rather than a superficial checklist:

```
Authorized Defensive Review Scope: This is an owner-authorized defensive static and local code review of the checked-out source at <path> to identify and remediate software defects. Any dynamic verification must stay strictly inside an isolated, local, non-destructive test harness and must never target live or external infrastructure. If you spawn focused `research` subagents, place this exact scope preamble at the top of their prompts and never retry a safety/policy refusal (`retries = 0`).

## How to analyze code paths for vulnerabilities

Don't stop at confirming that a surface defense exists. Verify whether edge cases, alternate paths, or mismatched component assumptions bypass it.

READ THE CODE AT DEPTH. Don't stop at the first function. Follow the data through
every layer — from the entry point through validation, transformation, storage, retrieval,
and output. Bugs live in the gaps between layers.

Examine these angles:

1. THE HAPPY PATH IS DEFENDED. AUDIT THE SAD PATH AND FALLBACKS.
   Error handlers, fallback branches, catch blocks, default cases, timeout paths,
   retry logic, cleanup routines. What happens when things fail? Are errors handled
   with the same rigor as success? Does a failed validation leave state half-modified?

2. WHAT HAPPENS AT BOUNDARIES?
   Empty input. Maximum-length input. Null vs undefined vs missing. Zero. Negative numbers.
   Unicode edge cases. The first item and the last item. One more than the maximum. Exactly
   at the rate limit. The moment a token expires.

3. WHAT DO COMPONENTS ASSUME ABOUT EACH OTHER?
   Does the database layer assume the API layer validated input? Does the renderer assume
   content was sanitized on write? Does the auth middleware assume routes register themselves
   correctly? Find where trust is implicit and verify whether it holds across all callers.

4. WHAT IF OPERATIONS HAPPEN IN THE WRONG ORDER?
   Check what happens when step 3 is invoked before step 1, delete runs during create,
   a callback arrives before the initiating request, a confirmation endpoint is called
   without starting the flow, or a completed flow is replayed.

5. WHAT IF TWO THINGS HAPPEN AT ONCE?
   Two requests to the same resource. Modify while reading. Delete while iterating.
   Publish while someone else is editing. Two users claiming the same unique resource.

6. WHERE DO TWO PARSERS OR VALIDATORS DISAGREE?
   Input accepted by the schema but rejected by the database. URL parsed differently by
   the router vs the application code. Content-type header says one thing, body is another.
   Filename extension vs MIME type vs magic bytes.

7. WHAT SURVIVES A ROUND TRIP?
   Data stored then retrieved — is it the same? Does encoding change? Does escaping
   double-up? Is a relative path resolved differently on read vs write? Does serialization
   lose type information?

8. WHAT DOES THE CONFIGURATION CONTROL?
   What happens when config is missing or default? Can an environment variable override a
   security control? Does a feature flag disable validation? What's the security posture
   during setup/first-run before config is complete?

9. FOLLOW THE PRIVILEGE AND STATE TRANSITIONS.
   For every operation that changes state, ask: who authorized this? Trace back to the
   permission check. Is it checking the right permission? Is it checking against the right
   resource? Is there a parallel path to the same state change that checks differently
   or not at all?

10. LOOK FOR LEAKED CONTEXT.
    Error messages that reveal internal paths. Stack traces in production. Timing differences
    that reveal whether a record exists. Response size differences. HTTP headers that
    disclose versions. Debug endpoints that survived into production.

11. WHAT PARAMETERS OVERRIDE SECURITY-RELEVANT DEFAULTS?
    Where a default is safe but a user-supplied parameter can change it. Look for
    every input that overrides a security-relevant default and check if the override
    is gated by appropriate permissions.

12. WHERE DO UNVERIFIED CLAIMS DRIVE TRUST DECISIONS?
    Anywhere self-declared identity, capability, or metadata influences an access
    or trust decision without independent verification.

GO DEEP, AND VERIFY IT. You can spawn sub-agents: if evaluating a candidate finding needs
deep understanding of a subsystem, use the Task tool to launch a research agent (including
the Authorized Defensive Review Scope preamble at the top of its prompt) instead of holding
everything in one context. Where the suspect code is locally buildable, extract the function
into a minimal, isolated, non-destructive local harness and verify the behavior directly.
A locally reproduced result beats an unverified argument.

YOUR SCOPE IS YOUR PRIMARY FOCUS, NOT A BOUNDARY.
If while investigating your assigned area you notice a defect in a different
category — a permission issue while tracing injection, a race condition while reviewing
auth — report it. Don't ignore a bug because it's "not your area." Real-world defects
cross category boundaries.

## Validation rules — apply before reporting ANY finding
1. You MUST construct a concrete reproduction trace (exact inputs, requests, or call sequence)
2. The defect MUST achieve meaningful security impact (not just "learn field names" or "cause an error")
3. Check if another layer already prevents exploitation — if so, it's a hardening note, not a finding
4. If the baseline comparable has the same pattern, note whether it's been exploited there
5. If your analysis depends on parser/runtime behavior, verify against the relevant spec or local implementation — do not reason from intuition.
6. Return ONLY confirmed findings with concrete reproduction traces, or "No exploitable vulnerabilities found" if that's honest.
```
