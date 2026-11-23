import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { captureResearchSourceClosure } from "./research-source-closure.mjs";
import { projectileOwnerBaselineSource } from "./projectile-owner-control-source.mjs";

const [inputRoot, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun inspect-projectile-owner-component.mjs <closed-component-input-root> <output.json>",
  );
const roots = [new URL(import.meta.url)],
  before = await captureResearchSourceClosure(roots),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
await Bun.write(output + ".source-start.json", JSON.stringify(before, null, 2));
const [
  { createProjectilePresentation, createOwnedProjectilePresentation },
  { createLatestDirectMissileFamilyAdapter },
] = await Promise.all([
  import("../latest-projectile-presentation.mjs"),
  import("../latest-direct-missile-family-adapter.mjs"),
]);
const root = path.resolve(inputRoot),
  manifestBytes = await Bun.file(path.join(root, "manifest.json")).bytes(),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  files = new Map(manifest.files.map((file) => [file.path, file]));
if (
  manifest.kind !== "source-bound-projectile-component-control-inputs" ||
  files.size !== 3 ||
  !["report.json", "presentation.json", "effects.json"].every((file) =>
    files.has(file),
  )
)
  throw Error("Exact closed projectile component inputs required");
async function read(file) {
  const expected = files.get(file),
    bytes = await Bun.file(path.join(root, file)).bytes();
  if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256)
    throw Error(`Projectile component input differs: ${file}`);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
const report = await read("report.json"),
  presentation = await read("presentation.json"),
  effects = await read("effects.json"),
  familyUrl = new URL(
    "../latest-direct-missile-family-adapter.mjs",
    import.meta.url,
  ),
  baselineSource = projectileOwnerBaselineSource(
    await Bun.file(familyUrl).text(),
  ).replace(
    /from "(\.\/[^\"]+)"/g,
    (_, file) => `from ${JSON.stringify(new URL(file, familyUrl).href)}`,
  ),
  { createLatestDirectMissileFamilyAdapter: createBaselineFamily } =
    await import(
      `data:text/javascript;base64,${Buffer.from(baselineSource).toString("base64")}`
    ),
  baseline = createProjectilePresentation(report, presentation),
  owner = createOwnedProjectilePresentation(report, presentation),
  originalFamily = createBaselineFamily({
    report,
    manifest: effects,
    presentation,
  }),
  sharedFamily = createLatestDirectMissileFamilyAdapter({
    report,
    manifest: effects,
    presentationOwner: owner,
  }),
  digest = new Bun.CryptoHasher("sha256"),
  started = performance.now();
if (
  !isDeepStrictEqual(originalFamily.events, sharedFamily.events) ||
  !isDeepStrictEqual(originalFamily.omitted, sharedFamily.omitted)
)
  throw Error("Complete family event/omission inventory differs");
let queries = 0,
  placements = 0;
const records = new Map(report.missiles.map((row) => [row.sequence, row]));
function compare(entityId, time, cursor) {
  const original = baseline.query(entityId, time, cursor),
    actual = owner.query(entityId, time, cursor);
  if (!isDeepStrictEqual(original, actual))
    throw Error(`Owned projectile query differs: ${entityId}/${time}`);
  digest.update(JSON.stringify([entityId, time, cursor, original]) + "\n");
  queries++;
}
for (const trace of presentation.traces) {
  const record = records.get(trace.sequence),
    creation = {
      transportSequence: record.transportSequence,
      entryOrder: record.entryOrder ?? 0,
    },
    times = [record.time, presentation.endTime, presentation.endTime + 1];
  for (const [index, state] of trace.states.entries()) {
    times.push(state.time);
    const next = trace.states[index + 1];
    if (next && next.time > state.time)
      times.push(state.time + (next.time - state.time) / 2);
    if (state.notificationSourceEventId)
      for (const cursor of [
        {
          transportSequence: state.notificationTransportSequence,
          entryOrder: state.notificationEntryOrder,
          exclusive: true,
        },
        {
          transportSequence: state.notificationTransportSequence,
          entryOrder: state.notificationEntryOrder,
        },
        {
          transportSequence: state.notificationTransportSequence + 1,
          entryOrder: 0,
        },
      ])
        compare(trace.entityId, state.time, cursor);
  }
  for (const time of [...times, ...times.toReversed()])
    for (const cursor of [null, creation])
      compare(trace.entityId, time, cursor);
  compare(trace.entityId, record.time, { ...creation, exclusive: true });
}
for (const event of originalFamily.events.filter(
  (event) => event.kind === "create",
)) {
  const cursor = {
    transportSequence: event.transportSequence,
    entryOrder: event.entryOrder ?? 0,
  };
  for (const time of [
    event.time,
    event.time + 0.1,
    presentation.endTime,
    event.time,
  ])
    for (const cutoff of [null, cursor, { ...cursor, exclusive: true }]) {
      const original = originalFamily.placement(event, time, cutoff),
        actual = sharedFamily.placement(event, time, cutoff);
      if (!isDeepStrictEqual(original, actual))
        throw Error(`Shared family placement differs: ${event.id}/${time}`);
      digest.update(JSON.stringify([event.id, time, cutoff, original]) + "\n");
      placements++;
    }
}
const after = await captureResearchSourceClosure(roots),
  sourceDrift = Object.keys(before).filter(
    (file) => before[file] !== after[file],
  );
if (
  sourceDrift.length ||
  Object.keys(before).length !== Object.keys(after).length
)
  throw Error("Projectile ownership control source changed during execution");
const result = {
  scope:
    "Exact owned-input/query/family-placement equivalence for source-derived component corpus; no native/world/browser performance admission",
  inputManifestSha256: hash(manifestBytes),
  sourceReplayReportSha256: manifest.originalReportSha256,
  implementationSha256: before,
  baselineSourceSha256: hash(new TextEncoder().encode(baselineSource)),
  sourceDrift,
  traces: presentation.traces.length,
  queries,
  placements,
  familyEvents: sharedFamily.events.length,
  familyOmissions: sharedFamily.omitted.length,
  outputSha256: digest.digest("hex"),
  mismatches: 0,
  elapsedMs: performance.now() - started,
};
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    traces: result.traces,
    queries,
    placements,
    familyEvents: result.familyEvents,
    mismatches: 0,
    sourceDrift: sourceDrift.length,
    elapsedMs: result.elapsedMs,
  }),
);
