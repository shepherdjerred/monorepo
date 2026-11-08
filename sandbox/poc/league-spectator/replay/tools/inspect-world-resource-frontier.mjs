// Rank actual creation omissions. Counts remain separate from rendered coverage.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {},
  read = async (path) => {
    const bytes = await Bun.file(path).bytes();
    inputs[path] = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    return JSON.parse(new TextDecoder().decode(bytes));
  },
  session = await read(`${cache}/research/direct-session-control.json`),
  reconstruction = await read(
    `${cache}/research/viewer-root-reconstruction.json`,
  ),
  report = reconstruction.report,
  heroes = new Map(report.heroes.map((hero) => [hero.entityId, hero])),
  rows = session.completeCoverage.rows.filter(
    (row) =>
      row.origin === "network-effect" && row.time >= 69 && row.time <= 99,
  ),
  rank = (selected, reasons) => {
    const groups = new Map();
    for (const row of selected) {
      const hero = heroes.get(row.entityReferences.resourceContextEntityId),
        champion = hero?.champion ?? "unresolved-resource-entity";
      for (const reason of new Set(reasons(row))) {
        if (!groups.has(reason))
          groups.set(reason, {
            reason,
            requests: 0,
            byResourceEntity: {},
            eventIds: [],
          });
        const group = groups.get(reason);
        group.requests++;
        group.byResourceEntity[champion] =
          (group.byResourceEntity[champion] ?? 0) + 1;
        group.eventIds.push(row.id);
      }
    }
    return [...groups.values()].sort(
      (a, b) => b.requests - a.requests || a.reason.localeCompare(b.reason),
    );
  },
  counts = Object.fromEntries(
    [
      "decoded",
      "resourceResolved",
      "placementResolved",
      "worldInputsResolved",
      "runtimeActivated",
    ].map((stage) => [stage, rows.filter((row) => row[stage]).length]),
  );
if (rows.length !== 1110 || report.build !== "16.21.829.8620")
  throw Error("Exact ordinary-session comparison ledger required");
const result = {
  schema: 1,
  kind: "actual-world-resource-frontier-ranking",
  build: report.build,
  protocol: report.protocol,
  replaySha256: report.replaySha256,
  interval: [69, 99],
  counts,
  unresolvedResourceRequests: rows.filter((row) => !row.resourceResolved)
    .length,
  resourceBlockers: rank(
    rows.filter((row) => !row.resourceResolved),
    (row) => row.reasons.filter((reason) => reason.startsWith("resource:")),
  ),
  placementBlockers: rank(
    rows.filter((row) => row.resourceResolved && !row.placementResolved),
    (row) =>
      row.reasons.filter(
        (reason) => reason.startsWith("world:") || reason.startsWith("pose:"),
      ),
  ),
  selectedFrontier: {
    capability: "ordered-positive-gear-form-resource-overlays",
    requestEvents: rows
      .filter(
        (row) =>
          row.reasons.includes(
            "resource:unresolved-unit-resource-stack:no-reference",
          ) &&
          ["Katarina", "Viego"].includes(
            heroes.get(row.entityReferences.resourceContextEntityId)?.champion,
          ),
      )
      .map((row) => ({ id: row.id, references: row.entityReferences })),
    resourceRequests: report.resourceRequests.filter((request) =>
      ["Katarina", "Viego"].includes(heroes.get(request.entityId)?.champion),
    ),
    requiredInputs: [
      "Exact installed ordered SkinUpgradeData gear links and complete original GearData fields.",
      "Original reference linking and resource post-load prerequisite, never raw token dereferences.",
      "Original positive selection, previous-overlay removal, selected-overlay push and repeated-selection behavior.",
      "Decoded request time, transport sequence and entry order, including snapshots and same-time packets.",
      "First native row for duplicate keys and present-null shadowing before base/auxiliary fallback.",
    ],
    placementPolicy:
      "Appearance, animation and bone readiness remain independently unresolved until proved.",
  },
  inputs,
  scope: {
    actualCreationLedger: true,
    blockerCountsOverlap: true,
    groupedByResourceEntityNotCreator: true,
    resourceResolutionIsNotRenderedCoverage: true,
    eligibilityChanged: false,
  },
};
await Bun.write(
  `${cache}/research/world-resource-frontier.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    counts,
    unresolvedResourceRequests: result.unresolvedResourceRequests,
    resourceBlockers: result.resourceBlockers.map(
      ({ reason, requests, byResourceEntity }) => ({
        reason,
        requests,
        byResourceEntity,
      }),
    ),
    selectedFrontierRequests: result.selectedFrontier.requestEvents.length,
  }),
);
