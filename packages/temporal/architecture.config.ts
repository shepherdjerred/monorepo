import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * Three layers:
 *
 * - foundation (`shared/`, `lib/`, `observability/`) — usable from anywhere
 * - Temporal runtime (`activities/`, `workflows/`, `schedules/`, `event-bridge/`)
 * - entry points (`worker.ts`, `client.ts`)
 *
 * The workflow/activity split inside the runtime layer is deliberately *not*
 * expressed here. The invariant that matters — workflow code must not eagerly
 * load an activity implementation into the replay sandbox — depends on telling
 * a `proxyActivities` interface import apart from an implementation import.
 * dependency-cruiser cannot label type-only edges in this repository (see
 * `@shepherdjerred/architecture`'s README), so such a rule would forbid the
 * documented Temporal idiom rather than the defect it is aimed at. A rule that
 * pushes authors away from the correct pattern is worse than no rule.
 */
export default defineArchitecture({
  boundaries: [
    {
      name: "activities-do-not-depend-on-workflows",
      comment:
        "Activities are ordinary async functions the worker can run on their own. Depending on " +
        "a workflow inverts the relationship and drags the workflow bundle into the activity " +
        "worker.",
      from: "activities",
      to: ["workflows"],
    },
    {
      name: "shared-does-not-depend-on-the-temporal-runtime",
      comment:
        "`shared/` is the foundation layer: schemas, pure helpers, and task-queue names. It has " +
        "to stay usable from a workflow, an activity, and a plain script alike, which means it " +
        "cannot reach up into any of them.",
      from: "shared",
      to: ["activities", "workflows", "schedules", "event-bridge"],
    },
    {
      name: "lib-does-not-depend-on-the-temporal-runtime",
      comment:
        "`lib/` holds clients for outside systems — Alertmanager, GitHub, the Temporal " +
        "connection itself. They are called by the runtime layer, never the other way round.",
      from: "lib",
      to: ["activities", "workflows", "schedules", "event-bridge"],
    },
  ],
});
