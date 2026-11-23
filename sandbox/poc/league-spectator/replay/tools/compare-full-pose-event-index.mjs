import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createLatestViewerPoseEventIndex } from "../latest-viewer-pose-event-index.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [sectionsPath, assetRoot, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun compare-full-pose-event-index.mjs <full-pose-event-sections.json> <approved-public-root> <output.json>",
  );
const sectionBytes = await Bun.file(sectionsPath).bytes(),
  extracted = JSON.parse(new TextDecoder().decode(sectionBytes)),
  report = extracted.sections;
if (
  extracted.schema !== 1 ||
  !/^[0-9a-f]{64}$/.test(extracted.sourceSha256) ||
  extracted.sourceBytes < 1 ||
  extracted.extractorSha256 !==
    (await sha256(
      await Bun.file(
        path.join(import.meta.dir, "extract-semantic-sections.py"),
      ).bytes(),
    ))
)
  throw Error("Original full semantic section extraction lineage changed");
const started = performance.now(),
  files = new Map();
const read = async (file) => {
  if (!files.has(file))
    files.set(file, await Bun.file(path.resolve(assetRoot, file)).bytes());
  return files.get(file);
};
const selection = await loadLatestStaticCatalogSelection({ load: read }),
  profile = selection.profile(),
  load = (file) => selection.read(file),
  scene = JSON.parse(
    new TextDecoder().decode(await load("latest-scene/manifest.json")),
  ),
  assets = await loadLatestViewerPoseAssets({
    profile,
    report,
    scene,
    load,
    staticCatalog: selection,
  });
function eventOrdinal(event) {
  const source = event.sourceEvent ?? event;
  return {
    transportSequence: event.transportSequence ?? source.transportSequence,
    entryOrder: event.entryOrder ?? source.entryOrder,
  };
}
const packet = (event) =>
  Number.isSafeInteger(eventOrdinal(event).transportSequence) &&
  eventOrdinal(event).transportSequence >= 0;
const ordinal = (event) =>
  packet(event) &&
  Number.isSafeInteger(eventOrdinal(event).entryOrder) &&
  eventOrdinal(event).entryOrder >= 0;
function causalTieOrder(a, b) {
  if (!packet(a) || !packet(b)) return null;
  const x = eventOrdinal(a),
    y = eventOrdinal(b);
  if (x.transportSequence !== y.transportSequence)
    return x.transportSequence - y.transportSequence;
  return ordinal(a) && ordinal(b) ? x.entryOrder - y.entryOrder : null;
}
const causalOrder = (a, b) =>
  a.time !== b.time
    ? a.time - b.time
    : (causalTieOrder(a, b) ?? a.sequence - b.sequence);
function baseline(events, plan, time, cursor) {
  const atTime = [];
  for (const event of events) {
    if (event.time > time) break;
    if (event.time === time && cursor !== null) {
      const ordinal = eventOrdinal(event);
      if (
        !Number.isSafeInteger(ordinal.transportSequence) ||
        ordinal.transportSequence < 0 ||
        (ordinal.transportSequence === cursor.transportSequence &&
          (!Number.isSafeInteger(ordinal.entryOrder) || ordinal.entryOrder < 0))
      )
        return {
          resolved: false,
          reasons: ["pose:same-time-animation-causal-ordinal-unresolved"],
        };
      if (
        ordinal.transportSequence > cursor.transportSequence ||
        (ordinal.transportSequence === cursor.transportSequence &&
          (ordinal.entryOrder > cursor.entryOrder ||
            (cursor.exclusive === true &&
              ordinal.entryOrder === cursor.entryOrder)))
      )
        continue;
    }
    atTime.push(event);
  }
  for (let index = 1; index < atTime.length; index++)
    if (
      atTime[index].time === atTime[index - 1].time &&
      causalTieOrder(atTime[index], atTime[index - 1]) === null
    )
      return { resolved: false, reasons: ["pose:animation-order-unresolved"] };
  const ownership = new Map();
  for (const event of atTime)
    for (const track of plan.tracks.get(event)) ownership.set(track, event);
  return { resolved: true, ownership };
}
const digest = createHash("sha256"),
  actors = [];
let queries = 0,
  baselineMs = 0,
  indexedMs = 0;
for (const hero of report.heroes) {
  const entry = assets.createEntry(hero.entityId);
  if (!entry) throw Error("Original complete pose actor missing");
  const events = structuredClone(entry.events).sort(causalOrder),
    eventIndices = new Map(events.map((event, index) => [event, index]));
  const plans = [false, true].map((moving) => ({
    tracks: new Map(
      events.map((event) => [
        event,
        entry.graph
          .evaluate(event.name, 0, { moving })
          .leaves.map((leaf) => leaf.track),
      ]),
    ),
  }));
  const index = createLatestViewerPoseEventIndex({
      events,
      plans,
      eventOrdinal,
      causalTieOrder,
    }),
    cases = [
      [0, null],
      [report.endTime, null],
    ];
  for (let slot = 0; slot < events.length; slot++) {
    const event = events[slot],
      current = eventOrdinal(event);
    cases.push([event.time, null]);
    if (ordinal(event))
      cases.push(
        [event.time, current],
        [event.time, { ...current, exclusive: true }],
        [
          event.time,
          { transportSequence: current.transportSequence + 1, entryOrder: 0 },
        ],
      );
    else cases.push([event.time, { transportSequence: 0, entryOrder: 0 }]);
    const next = events[slot + 1];
    if (next && next.time > event.time)
      cases.push([
        event.time + (next.time - event.time) / 2,
        current.transportSequence >= 0 && current.entryOrder >= 0
          ? current
          : null,
      ]);
  }
  const statuses = {};
  for (const [time, cursor] of [...cases, ...cases.toReversed()])
    for (let plan = 0; plan < plans.length; plan++) {
      let at = performance.now();
      const expected = baseline(events, plans[plan], time, cursor);
      baselineMs += performance.now() - at;
      at = performance.now();
      const received = index.select(plan, time, cursor);
      indexedMs += performance.now() - at;
      const view = (result) =>
        result.resolved
          ? {
              resolved: true,
              ownership: [...result.ownership].map(([track, event]) => [
                track,
                eventIndices.get(event),
              ]),
            }
          : result;
      const original = view(expected),
        actual = view(received);
      if (!isDeepStrictEqual(original, actual))
        throw Error(
          `Original pose track selection changed: ${JSON.stringify({ entityId: hero.entityId, plan, time, cursor, original, actual })}`,
        );
      queries++;
      const status = received.resolved ? "resolved" : received.reasons[0];
      statuses[status] = (statuses[status] ?? 0) + 1;
      digest.update(
        JSON.stringify([hero.entityId, time, cursor, plan, actual]),
      );
    }
  actors.push({
    entityId: hero.entityId,
    champion: hero.champion,
    events: events.length,
    queries: cases.length * 4,
    statuses,
  });
  console.log(
    JSON.stringify({
      actor: actors.at(-1),
      elapsedMs: performance.now() - started,
    }),
  );
}
const result = {
  schema: 1,
  kind: "full-original-pose-event-index-comparison",
  fullReportSha256: extracted.sourceSha256,
  sectionsSha256: await sha256(sectionBytes),
  helperSha256: await sha256(
    await Bun.file(
      path.join(import.meta.dir, "../latest-viewer-pose-event-index.mjs"),
    ).bytes(),
  ),
  actorPresentationContentHash: assets.contentHash,
  staticInventory: selection.describe(),
  actors,
  queries,
  baselineMs,
  indexedMs,
  outputSha256: digest.digest("hex"),
  mismatches: [],
  elapsedMs: performance.now() - started,
  scope:
    "Every actual full-report hero animation/combat timeline and original prepared moving/stationary graph track assignments; exact prefix/cursor/ambiguity/Map insertion-order comparison in forward/reverse order. Clip interpolation, graph evaluation clocks and rendered pose transforms are unchanged by this selection-only index; standalone timings are not browser seek acceptance.",
};
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    actors: actors.length,
    events: actors.reduce((sum, actor) => sum + actor.events, 0),
    queries,
    baselineMs,
    indexedMs,
    mismatches: 0,
    elapsedMs: result.elapsedMs,
  }),
);
