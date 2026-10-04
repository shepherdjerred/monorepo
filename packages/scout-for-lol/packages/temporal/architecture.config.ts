import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * The Temporal package is the contract between Workflows, Activities and their
 * clients, plus the deterministic Workflow code itself.
 *
 * What is enforced here is what dependency-cruiser can see: edges between this
 * package's own modules. The contract modules sit at the bottom of the graph:
 * they are imported by Workflows, by the backend's Activity implementations
 * and by clients, so they must never reach up into `workflows/`, the signal
 * definitions, the interceptor or the Activity type surface.
 *
 * Not expressible here: "Workflows must not import the backend". The cruise is
 * scoped to this package's own tree (`includeOnly`), so a cross-package edge is
 * invisible to it, and the package does not declare the backend as a
 * dependency. `eslint.config.ts` in the Scout root forbids the import instead.
 *
 * `contracts-v2` is not given a boundary of its own: the fixture for a layer is
 * selected by file-name prefix, and `contracts-v2-` would overlap the one that
 * proves `contracts-is-a-leaf`. It imports only `contracts` and the domain
 * package today, and `contracts` is the leaf everything above it builds on.
 */

/**
 * Every module and directory directly under `src/`, except `index.ts` (the
 * package barrel, which may re-export anything) and test files.
 * `architecture-boundaries.test.ts` asserts this list equals what is on disk.
 */
export const layers = [
  "activities",
  "activity-contracts-v2",
  "contracts",
  "contracts-v2",
  "execution-metadata",
  "identifiers",
  "match-receipts-v2",
  "notification-suppression-result",
  "signals",
  "silent-postmatch-backfill-v2",
  "workflow-contracts-v2",
  "workflow-ui-interceptor",
  "workflows",
];

/**
 * Everything a layer may not depend on, written as what it *may*. The package
 * barrel is a target too: it is not a layer, but importing it reaches every
 * layer at once.
 */
function everythingExcept(...allowed: string[]): string[] {
  return [...layers, "index"].filter((layer) => !allowed.includes(layer));
}

export default defineArchitecture({
  boundaries: [
    {
      name: "contracts-is-a-leaf",
      comment:
        "`contracts.ts` holds the schemas and names every Workflow, Activity and client shares. " +
        "It is imported from the Workflow sandbox, from the backend and from clients, so anything " +
        "it imports becomes a dependency of all of them. It imports nothing from this package.",
      from: "contracts",
      to: everythingExcept("contracts"),
    },
    {
      name: "activity-contracts-v2-is-contracts-only",
      comment:
        "The V2 Activity contracts are pure schemas. They may build on the shared contracts but " +
        "must not reach into Workflow code, signals or the interceptor, which would drag the " +
        "Workflow sandbox into every Activity implementation.",
      from: "activity-contracts-v2",
      to: everythingExcept(
        "activity-contracts-v2",
        "contracts",
        "contracts-v2",
        "notification-suppression-result",
      ),
    },
    {
      name: "workflow-contracts-v2-is-contracts-only",
      comment:
        "The V2 Workflow contracts are pure schemas shared with clients that start and signal " +
        "Workflows. They may build on the shared contracts but must not import Workflow code, " +
        "signals or the interceptor.",
      from: "workflow-contracts-v2",
      to: everythingExcept(
        "workflow-contracts-v2",
        "contracts",
        "contracts-v2",
      ),
    },
    {
      name: "match-receipts-v2-is-contracts-only",
      comment:
        "Match receipts are persisted and replayed, so their schema may depend on the contracts " +
        "only. Reaching into Workflow code would tie stored data to Workflow module layout.",
      from: "match-receipts-v2",
      to: everythingExcept("match-receipts-v2", "contracts", "contracts-v2"),
    },
    {
      name: "silent-postmatch-backfill-v2-is-contracts-only",
      comment:
        "The backfill request schema is shared by the Workflow and its clients, so it may depend " +
        "on the contracts only.",
      from: "silent-postmatch-backfill-v2",
      to: everythingExcept(
        "silent-postmatch-backfill-v2",
        "contracts",
        "contracts-v2",
      ),
    },
  ],
});
