---
name: experiments
description: Plan, run, or review an experiment in Hub through toolkit experiments. Use when an operator wants to evaluate a bounded change, capture a hypothesis and success criteria, attach evidence, schedule review, or record a decision.
---

# Experiments

Use Experiments for the hypothesis, evidence, review date, and decision about a trial. Link Tracker issues for work that implements the change or follows from the review. Link a flag by deployment and key when it controls the trial. Apply any flag change through the Flags workflow under its own authorization.

Read the [Toolkit Experiments reference](../../../packages/toolkit/README.md#experiments) for command and payload examples. Read the current experiment with `toolkit experiments show <id> --json` before an update and pass the returned revision as `--expected-revision`. If the command loses its response, reuse its request ID with the same payload and revision before issuing a new write.

- **Plan.** Capture the hypothesis, change, scope, success criteria, measurement method, and review date. Record baseline and guardrails where they affect how the result will be judged. Start records the initial plan.
- **Run.** Attach or link observed evidence with the measurement window and caveats. Record protocol changes as amendments with rationale. Use a flag change receipt only when the before and after values and revision were observed.
- **Review.** Summarize the observed result against the success criteria and guardrails. Recommend keep, revert, inconclusive, or extend. Record the decision when the operator has authorized the outcome. Extending needs a later date and a rationale.
