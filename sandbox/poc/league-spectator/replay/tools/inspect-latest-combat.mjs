// Match data and static dependency inspection. No browser or game UI is used.
import { resolve } from "node:path";
import { bindLatestMinions } from "../latest-world.mjs";
import { resolveCombatPresentation } from "../latest-combat.mjs";
import { bindLatestMissileSpell } from "../latest-missiles.mjs";
import { loadAnimationPoses } from "./load-animation-poses.mjs";

const [reportPath, scenePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-latest-combat.mjs <semantics.json> <scene-dir> <evidence.json>",
  );
const root = resolve(scenePath),
  report = await Bun.file(reportPath).json(),
  manifest = await Bun.file(`${root}/manifest.json`).json(),
  world = await Bun.file(`${root}/${manifest.world}`).json();
if (manifest.build !== report.build || manifest.protocol !== report.protocol)
  throw Error("Combat evidence build mismatch");
const actors = [
  ...report.heroes.map((hero) => {
    const asset =
      manifest.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`];
    if (!asset) throw Error("Unprepared hero skin");
    return {
      kind: "hero",
      asset,
      subject: {
        character: hero.champion,
        entityId: hero.entityId,
        characterRecords: asset.characterRecords,
      },
    };
  }),
  ...bindLatestMinions(report, manifest, world).minions.map((minion) => ({
    kind: "minion",
    asset: minion.asset,
    subject: {
      character: minion.asset.character,
      entityId: minion.event.entityId,
      characterRecords: [
        ...new Set(minion.unit.records.map((record) => record.characterRecord)),
      ],
    },
  })),
];
const animationPoses = await loadAnimationPoses(root),
  catalogs = new Map(),
  animationData = new Map(),
  clips = new Map(),
  entities = [],
  summary = {},
  unresolvedGraphs = [];
for (const actor of actors) {
  const { asset, subject, kind } = actor;
  if (!catalogs.has(asset.spellCatalog))
    catalogs.set(
      asset.spellCatalog,
      await Bun.file(`${root}/${asset.spellCatalog}`).json(),
    );
  if (!animationData.has(asset.animationCatalog)) {
    animationData.set(asset.animationCatalog, await animationPoses.bind(asset));
  }
  const { catalog, graph, read } = animationData.get(asset.animationCatalog),
    presentation = resolveCombatPresentation(
      subject,
      catalogs.get(asset.spellCatalog),
      report,
    ),
    directory = asset.model.slice(0, asset.model.lastIndexOf("/")),
    actions = [];
  const group = (summary[kind] ??= {
    actors: 0,
    recordedAttacks: 0,
    recordedCasts: 0,
    attackBindings: 0,
    castBindings: 0,
    finiteAttacks: 0,
    finiteCasts: 0,
    gaps: 0,
    nameOverrides: 0,
  });
  group.actors++;
  group.recordedAttacks += report.attacks.filter(
    (e) => e.entityId === subject.entityId,
  ).length;
  group.recordedCasts += report.casts.filter(
    (e) => e.entityId === subject.entityId,
  ).length;
  group.gaps += presentation.gaps.length;
  group.nameOverrides += presentation.explicitNameOverrides;
  for (const action of presentation.actions) {
    const evaluated = graph.evaluate(action.name, 0.1, { moving: false }),
      finite = evaluated.leaves.length > 0 && !evaluated.unresolved.length;
    group[action.sourceKind === "attack" ? "attackBindings" : "castBindings"]++;
    if (finite)
      group[action.sourceKind === "attack" ? "finiteAttacks" : "finiteCasts"]++;
    for (const file of graph.dependencies(action.name)) {
      const path = `${directory}/${file}`;
      if (!clips.has(path)) clips.set(path, await read(file));
      if (
        clips.get(path).tracks.some((t) => catalog.joints[t.jointId] !== t.bone)
      )
        throw Error("Combat clip/skeleton mismatch");
    }
    if (evaluated.unresolved.length)
      unresolvedGraphs.push({
        character: subject.character,
        entityId: subject.entityId,
        time: action.time,
        name: action.name,
        sourceKind: action.sourceKind,
        reasons: evaluated.unresolved,
      });
    actions.push({
      time: action.time,
      sequence: action.sequence,
      sourceKind: action.sourceKind,
      name: action.name,
      definitionName: action.definitionName,
      finite,
      recordVariants: action.recordVariants,
    });
  }
  entities.push({
    kind,
    ...subject,
    actions,
    gaps: presentation.gaps,
    nameOverrides: presentation.explicitNameOverrides,
  });
}
const heroById = new Map(
  actors
    .filter((a) => a.kind === "hero")
    .map((a) => [
      a.subject.entityId,
      {
        character: a.subject.character,
        catalog: catalogs.get(a.asset.spellCatalog),
      },
    ]),
);
const actorIds = new Set(actors.map((actor) => actor.subject.entityId)),
  unboundAttacks = report.attacks.filter(
    (event) => !actorIds.has(event.entityId),
  );
const missiles = report.missiles.map((record) => {
  const { spell, ...binding } = bindLatestMissileSpell(record, heroById);
  return {
    ...record,
    ...binding,
    definitionName: spell?.name ?? null,
  };
});
const result = {
  schema: 1,
  build: report.build,
  protocol: report.protocol,
  replaySha256: report.replaySha256,
  scope:
    "Browser-compatible replay decoding and static spell/graph/clip dependencies; A/V and browser rendering not validated",
  defaultAttackNamingSha256: manifest.toolchain.attackNamingSha256,
  summary,
  entities,
  unresolvedGraphs,
  unboundAttacks,
  missiles,
  missileSummary: {
    records: missiles.length,
    boundOwners: missiles.filter((m) => m.ownerCharacter).length,
    resolvedSpellRecords: missiles.filter((m) => m.definitionName).length,
    positionRecords: missiles.filter(
      (m) =>
        m.creationPosition?.length === 3 && m.replicationPosition?.length === 3,
    ).length,
    positiveElapsedRecords: missiles.filter((m) => m.elapsedSeconds > 0).length,
    renderedProjectiles: 0,
    sourceCharactersNotBound: missiles.filter(
      (m) => m.bindingStatus === "Source character not bound",
    ).length,
    ownerSpellDefinitionsAbsent: missiles.filter(
      (m) => m.bindingStatus === "Spell definition absent from owner catalog",
    ).length,
  },
  loadedCombatClips: clips.size,
  limitations: [
    "Attack timing, rates, interruption and blending remain candidates",
    "Random selector outcomes are unresolved; no arbitrary branch is selected",
    "Source-record variants bind only when spell/hash/animation identity agrees",
    "Missile identity decoding alone does not establish visible geometry, trajectories, impact or particle fidelity",
  ],
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    summary,
    unresolvedGraphActions: unresolvedGraphs.length,
    missiles: result.missileSummary,
    loadedCombatClips: clips.size,
    unboundAttackRecords: unboundAttacks.length,
  }),
);
