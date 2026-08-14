---
id: llm-catalog-field-ownership
type: todo
status: planned
board: true
verification: agent
disposition: active
---

# Let catalog entries declare which fields upstream owns

`applicableFields()` in `packages/llm-models/scripts/sync-from-upstreams.ts`
decides which of `input` / `output` / `contextWindow` the weekly refresh should
cross-check against models.dev and LiteLLM. Nothing in `catalog.json` states
that, so the function infers it from `pricing.modality`, `pinnedContextWindow`,
`category`, and whether an upstream happened to publish a value.

Every inference has turned out to be wrong for some class of model, and each
was fixed by adding another branch or another verdict state rather than by
fixing the missing declaration:

| Class                 | Symptom                                                                                              | Patched by                              |
| --------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Partial upstream row  | a field the other source covered was dropped, then reported as unmeasured                            | `mergeUpstreams` (per-field merge)      |
| Pinned context window | field left `applicable`, so the drift alert the operator was answering never resolved                | `retired` verdict state                 |
| Retired field wording | resolution claimed a comparison agreed when nothing was compared                                     | `ResolutionReason`                      |
| Embedding output      | `output: 0` is a placeholder, so a correctly-absent upstream price fired `LlmCatalogEvidenceMissing` | `category === "embedding"` special case |

The last one is a deliberate stopgap. It keys on the category because that
states _why_ there is no output dimension, where `output === 0` is a
consequence a genuinely free model would also produce — but it is still an
inference, and the next model class that does not fit will need a fifth.

## Proposal

Have the entry declare per-field ownership, and have `applicableFields()` read
that one declaration instead of inferring. Roughly: each cross-checkable field
is either upstream-owned (compare it, alert on drift, alert when evidence
disappears) or hand-maintained (never compare it, publish a resolution once so
nothing is orphaned, never claim missing evidence).

That subsumes the accreted special cases rather than adding to them:

- `pinnedContextWindow` becomes an instance of hand-maintained, not its own flag.
- The `retired` verdict state stops needing to exist as a separate concept.
- `text-embedding-3-small` simply declares `output` hand-maintained, and the
  `category` sniffing goes away.
- A hand-maintained flagship price (a real case today — `claude-sonnet-5` holds
  the standard rate against an introductory upstream one) gets a first-class
  expression instead of a dated `acceptedUpstreamPricing` entry that has to be
  renewed.

## Remaining

- [ ] Design the declaration's shape in `catalog.schema.json` (per-field
      ownership on the entry) and mirror it in the Zod and Pydantic views —
      the catalog is language-neutral, so all three validators move together.
- [ ] Migrate the existing entries: pinned context windows, the embedding's
      output, and any hand-maintained price.
- [ ] Collapse `applicableFields()` / `retiredFields()` to read the
      declaration, and remove the `category === "embedding"` stopgap and the
      `pinnedContextWindow` branch.
- [ ] Re-check whether `retired` still needs to be a distinct verdict state, or
      whether hand-maintained fields can share one resolution path.
- [ ] Confirm against a live sync that the occurrence counts are unchanged for
      every model that is not being migrated.

## Comment Log

- 2026-08-14: Raised from PR #2148 review. The embedding case was found while
  fixing the pinned-context-window resolution; both are the same missing
  declaration. Scoped out of that PR deliberately — it was already six review
  rounds deep in this subsystem, and a cross-validator schema change as a
  seventh round would have been piling on rather than stepping back. The
  minimal `category === "embedding"` patch shipped there instead, with a
  pointer to this document from the code.
