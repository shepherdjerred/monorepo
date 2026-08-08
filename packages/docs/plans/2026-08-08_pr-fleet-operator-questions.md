---
id: pr-fleet-operator-questions-2026-08-08
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# PR Fleet Best-Effort Remediation and Operator Questions

## Summary

Let the PR fleet controller adopt matching-branch operator worktrees without
discarding inherited work, proceed when that work is clearly attributable to
the PR, and suspend only an uncertain PR in a typed `waiting-for-answer` state.
The live dashboard gains a narrow answer channel while all publication,
readiness, and destructive-action boundaries remain deterministic.

## Implementation

- Add an optional author scope, typed operator requests and answers, the waiting
  state, terminal answer fallbacks, lifecycle events, and immediate resumption
  against the same PR head.
- Add bounded inherited-WIP inspection, explicit unstaging, and publication
  tools. Preserve matching operator worktrees and ask before ambiguous or
  destructive reconciliation.
- Add a mode-`0600` live-run control socket and same-origin dashboard answer
  endpoint. Historical dashboards remain read-only; live questions render
  inline on the affected PR.
- Repair the commit-message validator, directory/missing-path containment, and
  Mise setup isolation failures observed in the GPT-5.6 Terra smoke run.
- Update the controller reference, hardening TODO, and human wiki page with the
  new operator boundary.

## Verification

- Cover author scoping, WIP relations, operator request lifecycle, lease release,
  stale answers, socket forwarding, historical read-only behavior, replay, and
  every smoke-run regression with deterministic tests.
- Run focused controller and web build/typecheck/test/lint tasks plus docs and
  wiki verification.
- Run `openai/gpt-5.6-terra` with `--author shepherdjerred`, five workers, and a
  fixed loopback dashboard until every in-scope PR is current-head green.

## Remaining

- [x] Implement and verify the controller, worker tools, and dashboard changes.
- [ ] Drive the original user-authored PR fleet to current-head green.
- [ ] Publish the controller changes as a draft git-spice PR and make it green.

## Comment Log

- 2026-08-08: Approved with inline per-PR questions, evidence-based WIP
  confidence, indefinite per-PR waiting, and controller-PR publication after the
  original fleet is green.
- 2026-08-08: The operator narrowed this implementation pass to local code and
  verification. Fleet execution and controller-PR publication remain deferred.
