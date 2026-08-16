# PostHog product and operational capabilities

## Feature flags and experiments

A feature flag is a delivery control. Give it an owner, stable evaluation
identity, explicit targeting, a phased rollout, and a cleanup decision. Test
the evaluated state before a broad rollout and remove stale flags deliberately.

An experiment is a measurement protocol built on a delivery mechanism. Before
launch, write the hypothesis, exposure event, primary metric, guardrails,
population, sample-size/run-time expectation, and decision rule. Do not change
allocation or metric definitions casually after observing results. A winning
experiment still needs an explicit rollout and cleanup plan.

## Replay, errors, and logs

Use analytics to identify a bounded problem, then inspect the correlated replay,
error, or logs. Configure sensitive-data masking and retention first. For error
tracking, preserve stack traces, releases, grouping/fingerprints, ownership,
and alert thresholds so that a recurring failure can be investigated rather
than merely counted. For logs, scrub PII before capture and scope alerting to
actionable patterns.

## LLM observability and evaluations

AI observability captures spans, sessions, cost, feedback, and errors. It must
have the same data-minimization and retention design as replay and logs. Treat
LLM evaluations as versioned measurement: define the task, dataset or traffic
slice, judge/metric, and failure threshold before comparing prompts or models.
Never send secrets or unnecessary customer content merely to make a trace more
convenient to inspect.

## References

The official documentation for flags, experiments, replay, error tracking,
logs, warehouse queries, proxying, and AI observability is indexed in
[the source ledger](sources.md), entries 20–45. Review those pages for current
feature availability and plan-specific behavior before changing configuration.
