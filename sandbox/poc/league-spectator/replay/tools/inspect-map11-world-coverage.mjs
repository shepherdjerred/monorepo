import { resolve } from "node:path";
import { inspectMap11WorldCoverage } from "./map11-world-coverage.mjs";
const [reportPath, worldPath, outputPath, requestPath] = process.argv.slice(2);
if (!requestPath)
  throw Error(
    "Usage: bun inspect-map11-world-coverage.mjs <semantic-report.json> <original-world.json> <coverage.json> <actor-request.json>",
  );
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const reportBytes = await Bun.file(reportPath).bytes(),
  worldBytes = await Bun.file(worldPath).bytes();
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const coverage = inspectMap11WorldCoverage(
  decode(reportBytes),
  decode(worldBytes),
);
const provenance = {
  report: { path: resolve(reportPath), sha256: sha(reportBytes) },
  world: { path: resolve(worldPath), sha256: sha(worldBytes) },
  inspectorSha256: sha(await Bun.file(import.meta.path).bytes()),
  policySha256: sha(
    await Bun.file(
      new URL("map11-world-coverage.mjs", import.meta.url),
    ).bytes(),
  ),
};
await Bun.write(
  outputPath,
  JSON.stringify({ ...coverage, provenance }, null, 2),
);
await Bun.write(
  requestPath,
  JSON.stringify(
    {
      schema: 1,
      build: coverage.build,
      protocol: coverage.protocol,
      actors: coverage.actorRequests,
      provenance: {
        ...provenance,
        source:
          "Original decoded NPC849 names/skin IDs, not accepted world actors",
        scope: coverage.scope,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: resolve(outputPath),
    decodedWholeWindow: coverage.decodedWholeWindow,
    npcSkins: coverage.npcSkins.length,
    requestedSkins: coverage.actorRequests.length,
    movementWithoutKnownCreation: coverage.movementWithoutKnownCreation.length,
    conflictingNpcIdentities: coverage.conflictingNpcIdentities.length,
  }),
);
