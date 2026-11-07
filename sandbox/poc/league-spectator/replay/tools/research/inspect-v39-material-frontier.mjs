import { resolve } from "node:path";
const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  inputs = {};
async function read(path, expected) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    h = hash(b);
  if (expected && h !== expected) throw Error("Archive bytes differ");
  inputs[path] = h;
  return JSON.parse(new TextDecoder().decode(b));
}
const archive = await read(
  ".cache/replay-spike/research/direct-effects-v38-archive.json",
  "629dcad2ce90ef83327b3810623f8d0a5ff8f09878445717303fec3b00db994c",
);
const rows = [];
for (const [label, cache] of [
  ["primary", ".cache/replay-spike"],
  ["secondary", ".cache/replay-lineup-5667809143"],
]) {
  async function owned(name) {
    const p = resolve(cache, "research", name),
      a = archive.artifacts.find(
        (x) => x.sourcePath === p && x.kind === "canonical-current-path-bytes",
      );
    if (!a) throw Error("Archived canonical role missing " + p);
    return read(a.archivePath, a.sha256);
  }
  const session = await owned("direct-session-selected-control.json"),
    decoded = await owned("selected-ordinary-reconstruction.json"),
    heroes = new Map(decoded.heroes.map((x) => [x.entityId, x.champion]));
  const programs = new Map(
    session.diagnostic.definitions.map((d) => [d.id, d]),
  );
  for (const row of session.completeCoverage.rows) {
    if (row.time < 69 || row.time > 99) continue;
    const program = programs.get(row.definitionId);
    if (!program) continue;
    for (const unsupported of program.unsupported) {
      const m = [
        null,
        String(unsupported.index),
        unsupported.reasons.join(","),
      ];
      rows.push({
        lineup: label,
        id: row.id,
        generation: row.generation,
        definitionId: row.definitionId,
        emitterId: +m[1],
        time: row.time,
        origin: row.origin,
        creatorId: row.ownerId ?? null,
        creator: row.ownerId
          ? (heroes.get(row.ownerId) ?? "nonhero-owner")
          : "unresolved",
        placementResolved: row.placementResolved,
        instanceWorldReady: row.worldInputsResolved,
        rootFlagsBlocked: program.blockers.includes("system:flags"),
        reasons: m[2].split(","),
      });
    }
  }
}
const sole = rows.filter(
  (x) => x.reasons.length === 1 && x.reasons[0].startsWith("material:"),
);
function group(data, key) {
  const map = new Map();
  for (const row of data) {
    const k = key(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return [...map]
    .map(([key, rs]) => ({
      key,
      componentRequests: rs.length,
      placed: rs.filter((x) => x.placementResolved).length,
      worldReadyInstances: rs.filter((x) => x.instanceWorldReady).length,
      flagsBlocked: rs.filter((x) => x.rootFlagsBlocked).length,
      knownCreatorComponentRequests: rs.filter(
        (x) => x.creator !== "unresolved",
      ).length,
      creators: [
        ...new Set(
          rs.filter((x) => x.creator !== "unresolved").map((x) => x.creator),
        ),
      ],
      definitions: [...new Set(rs.map((x) => x.definitionId))],
      components: [
        ...new Set(rs.map((x) => x.definitionId + ":" + x.emitterId)),
      ],
    }))
    .sort((a, b) => b.componentRequests - a.componentRequests);
}
const report = {
  schema: 1,
  kind: "read-only-v39-shared-material-frontier-from-immutable-v38-ledgers",
  inputs,
  window: [69, 99],
  soleMaterialReasonGroups: group(sole, (x) => x.lineup + "|" + x.reasons[0]),
  knownPlacedWorldReady: group(
    sole.filter(
      (x) =>
        x.placementResolved &&
        x.instanceWorldReady &&
        x.creator !== "unresolved",
    ),
    (x) => x.lineup + "|" + x.reasons[0],
  ),
  rows,
  scope: {
    omittedComponentRequestsNotRenderedCounts: true,
    creatorOnlyFromDecodedOwner: true,
    assetFamilyNeverUsedAsCreator: true,
    noAdmissionChanged: true,
    noPredictedCoverageWithoutOtherGates: true,
  },
};
await Bun.write(
  ".cache/replay-spike/research/material-frontier-v39-proposal.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      soleGroups: report.soleMaterialReasonGroups.slice(0, 12),
      knownReady: report.knownPlacedWorldReady,
    },
    null,
    2,
  ),
);
