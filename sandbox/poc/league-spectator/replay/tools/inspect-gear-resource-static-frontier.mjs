// Static reachability inventory only. Does not publish or mutate the asset graph.
import { resolve } from "node:path";
import { stringifyAssetJson } from "./asset-json.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {},
  read = async (path) => {
    const bytes = await Bun.file(path).bytes();
    inputs[path] = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    return JSON.parse(new TextDecoder().decode(bytes));
  },
  manifest = await read(`${cache}/public/latest-effects/manifest.json`),
  packageData = await read(`${cache}/public/latest-effects/package.json`),
  gears = await read(`${cache}/public/latest-unit-gear-resources/package.json`),
  metaHash = (value) => {
    if (/^\{[a-f0-9]{8}\}$/i.test(value))
      return value.slice(1, -1).toLowerCase();
    let hash = 2166136261;
    for (const char of value.toLowerCase())
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return hash.toString(16).padStart(8, "0");
  },
  results = [];
for (const [actorKey, table] of Object.entries(gears.actors)) {
  if (!table.some((gear) => gear.rows.length)) continue;
  const objects = new Map();
  for (const source of packageData.actors[actorKey].sourceBins) {
    const stem = `${source.sourceSha256}-${manifest.toolchain.parserIdentity.slice(0, 16)}`,
      json = await read(`${cache}/research/latest-effects/bins/${stem}.json`);
    for (const [key, value] of Object.entries(json)) {
      if (key.startsWith("__")) continue;
      const id = metaHash(key),
        previous = objects.get(id);
      if (
        previous &&
        stringifyAssetJson(previous.value) !== stringifyAssetJson(value)
      )
        throw Error(`Unresolved source override: ${actorKey}/${id}`);
      objects.set(id, {
        id,
        value,
        sourceSha256: source.sourceSha256,
        sourcePath: source.path,
      });
    }
  }
  const definitions = new Map(),
    assets = new Map(),
    unresolved = [],
    perGear = [];
  for (const gear of table) {
    const aliases = new Map(
      Object.entries(manifest.actors[actorKey].resources).map(([key, ref]) => [
        key,
        metaHash(ref.reference),
      ]),
    );
    // First duplicate key wins in the original ordered gear map, including null.
    for (const row of [...gear.rows].reverse())
      aliases.set(
        row.key.toString(16).padStart(8, "0"),
        row.value.toString(16).padStart(8, "0"),
      );
    const queue = gear.rows
        .map((row) => row.value.toString(16).padStart(8, "0"))
        .filter((id) => id !== "00000000"),
      visited = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const object = objects.get(id);
      if (!object) {
        unresolved.push({
          index: gear.index,
          id,
          reason: "definition-outside-installed-actor-closure",
        });
        continue;
      }
      const effectId = `${actorKey}/${id}`;
      definitions.set(effectId, {
        effectId,
        type: object.value.__type,
        sourcePath: object.sourcePath,
        sourceSha256: object.sourceSha256,
        currentlyPrepared: Object.hasOwn(manifest.definitions, effectId),
      });
      const walk = (value, path) => {
        if (Array.isArray(value))
          return value.forEach((entry, i) => walk(entry, `${path}[${i}]`));
        if (value && typeof value === "object") {
          for (const [key, entry] of Object.entries(value))
            if (
              ![
                "__type",
                "objectPath",
                "particleName",
                "particlePath",
                "emitterName",
              ].includes(key)
            )
              walk(entry, `${path}.${key}`);
          return;
        }
        if (typeof value !== "string") return;
        if (/^(assets|data)\/.+\.[a-z0-9_]+$/i.test(value)) {
          const assetPath = value.replaceAll("\\", "/").toLowerCase(),
            asset = assets.get(assetPath) ?? {
              path: assetPath,
              kind: assetPath.split(".").at(-1),
              currentlyPrepared: Object.hasOwn(manifest.assets, assetPath),
              uses: [],
            };
          asset.uses.push({ effectId, property: path });
          assets.set(assetPath, asset);
          return;
        }
        const hash = metaHash(value),
          target = aliases.get(hash) ?? (objects.has(hash) ? hash : null);
        if (target && target !== "00000000") queue.push(target);
      };
      walk(object.value, "");
    }
    perGear.push({
      index: gear.index,
      gearIdentity: gear.gearIdentity,
      resourceRows: gear.rows.length,
      nullRows: gear.rows.filter((row) => row.value === 0).length,
      reachableDefinitions: visited.size,
    });
  }
  results.push({
    actorKey,
    perGear,
    definitions: [...definitions.values()],
    assets: [...assets.values()],
    unresolved,
  });
}
const additionalDefinitions = results.flatMap((actor) =>
    actor.definitions.filter((definition) => !definition.currentlyPrepared),
  ),
  additionalAssets = [
    ...new Map(
      results
        .flatMap((actor) =>
          actor.assets.filter((asset) => !asset.currentlyPrepared),
        )
        .map((asset) => [asset.path, asset]),
    ).values(),
  ],
  countBy = (items, key) =>
    items.reduce(
      (counts, item) => ({
        ...counts,
        [item[key]]: (counts[item[key]] ?? 0) + 1,
      }),
      {},
    ),
  result = {
    schema: 1,
    kind: "gear-resource-static-reachability-frontier",
    build: manifest.build,
    protocol: manifest.protocol,
    counts: {
      actors: results.length,
      additionalDefinitions: additionalDefinitions.length,
      additionalDefinitionsByType: countBy(additionalDefinitions, "type"),
      additionalAssets: additionalAssets.length,
      additionalAssetsByKind: countBy(additionalAssets, "kind"),
    },
    results,
    inputs,
    scope: {
      staticReachabilityOnly: true,
      originalProducerAcceptanceInferred: false,
      assetGraphPublished: false,
      resourceResolutionCountedAsRendered: false,
    },
  };
await Bun.write(
  `${cache}/research/gear-resource-static-frontier.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result.counts));
