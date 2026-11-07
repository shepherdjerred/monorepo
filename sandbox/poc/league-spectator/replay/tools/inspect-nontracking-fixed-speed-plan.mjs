// Source-current blocker inventory only; no normal family registration.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import {
  compileSuppliedNontrackingFixedSpeedSpec,
  planUnadmittedNontrackingFixedSpeedFamily,
} from "../latest-nontracking-fixed-speed.mjs";
import { createTriggerOnHitNoHitActors } from "../latest-trigger-on-hit.mjs";
import { createPresentationMissileActors } from "../latest-presentation-missile-actors.mjs";
import { createLatestMissileActors } from "../latest-missile-actors.mjs";
import { indexLatestMissileEvents } from "../latest-missiles.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Inactive planner input changed");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const source = await read(
  `${cache}/research/named-bone-caster-inputs-v35.json`,
);
for (const [path, hash] of Object.entries(source.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Original source currentness failed: " + path);
const exported = await read(
    `${cache}/research/viewer-root-reconstruction.json`,
  ),
  report = exported.report,
  scene = await read(`${cache}/public/latest-scene/manifest.json`),
  motion = await read(
    `${cache}/public/decoder-16.21-macos/missile-motion.json`,
  ),
  controllers = await read(
    `${cache}/public/decoder-16.21-macos/missile-controllers.json`,
  ),
  actors = createTriggerOnHitNoHitActors(
    createPresentationMissileActors(
      createLatestMissileActors(
        await read(`${cache}/public/decoder-16.21-macos/missile-actors.json`),
      ),
    ),
  ),
  records = [];
for (const row of source.cases) {
  const original = report.missiles.find((r) => r.sequence === row.sequence),
    hero = report.heroes.find((r) => r.entityId === original?.cast.ownerId);
  if (!original || !hero) throw Error("Actual causal source identity required");
  const asset =
      scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`],
    catalog = await read(`${cache}/public/latest-scene/${asset.spellCatalog}`),
    spec = catalog.spells[original.cast.spellHash]?.data.mMissileSpec;
  if (!spec) throw Error("Actual source spell required");
  records.push({
    ...original,
    behaviorSpecs: spec.behaviors ?? [],
    nontrackingSpec: compileSuppliedNontrackingFixedSpeedSpec(
      spec,
      motion,
      controllers,
    ),
    startInitialization: source.providerResults.find(
      (r) => r.sequence === original.sequence,
    )?.start,
  });
}
const plan = planUnadmittedNontrackingFixedSpeedFamily({
  records,
  eventIndex: indexLatestMissileEvents(report),
  actors,
  endTime: 99,
  build: report.build,
  protocol: report.protocol,
});
if (
  plan.traces.length ||
  plan.omitted.length !== 4 ||
  plan.ordinaryAdmission !== false ||
  plan.omitted.some(
    (row) =>
      !row.reasons.includes("target:actual-consumed-caster-range-unrecovered"),
  )
)
  throw Error(
    "All exact candidates must remain omitted until actual source range is established",
  );
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Inactive planner source drifted");
const output = `${cache}/research/nontracking-fixed-speed-plan-v35.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "inactive-source-bound-nontracking-fixed-speed-blocker-plan",
      artifactVersion: 35,
      inputs,
      plan,
      scope: {
        sourceCurrentOwnedStartReport: true,
        actualCasterRangeRecovered: false,
        activeFamilyAdmissionChanged: false,
        numericProjectionCannotAdmit: true,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    candidates: 4,
    availableStarts: records.filter((r) => r.startInitialization.resolved)
      .length,
    traces: 0,
    rangeBlocked: 4,
  }),
);
