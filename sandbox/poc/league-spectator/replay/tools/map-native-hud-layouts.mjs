import path from "node:path";

const [hudArgument, linksArgument, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun map-native-hud-layouts.mjs <hud.json> <links.json> <output.json>",
  );
const hud = await Bun.file(hudArgument).json(),
  links = await Bun.file(linksArgument).json();
const linkMap = new Map(links.results.map((entry) => [entry.value, entry]));
const bases = new Map(),
  referenced = new Set(),
  atlasRefs = new Set(),
  controllers = [];
for (const entry of links.results) {
  for (const location of entry.locations) {
    if (!location.normalizedPath) continue;
    const data = await Bun.file(
      path.join(path.dirname(linksArgument), location.normalizedPath),
    ).json();
    if (!bases.has(entry.value)) bases.set(entry.value, []);
    bases.get(entry.value).push({ source: location, objects: data.normalized });
    const inspect = (value) => {
      if (!value || typeof value !== "object") return;
      if (value.kind === "wad-path-hash") atlasRefs.add(value.value);
      for (const child of Object.values(value)) inspect(child);
    };
    inspect(data.normalized);
  }
}
function positions(value, prefix = "") {
  const found = [];
  if (!value || typeof value !== "object") return found;
  if (["UiPositionRect", "UiElementRect", "AtlasData"].includes(value.__type))
    found.push({ path: prefix, authored: value });
  for (const [key, child] of Object.entries(value))
    if (child && typeof child === "object")
      found.push(...positions(child, `${prefix}/${key}`));
  return found;
}
for (const file of hud.files) {
  const data = await Bun.file(
    path.join(path.dirname(hudArgument), file.normalizedPath),
  ).json();
  for (const [controllerHash, controller] of Object.entries(data.normalized)) {
    if (!controller.BaseLoadable) continue;
    const loadable = data.normalized[controller.BaseLoadable];
    if (
      loadable?.__type !== "UiPropertyLoadable" ||
      loadable.FilepathHash?.kind !== "wad-path-hash"
    )
      throw Error(
        "Original controller BaseLoadable must resolve its typed native resource",
      );
    const baseHash = loadable.FilepathHash.value,
      selected = bases.get(baseHash) ?? [];
    const bindings = [];
    const visit = (value, fieldPath) => {
      if (typeof value === "string" && /^\{[a-f0-9]{8}\}$/.test(value)) {
        const matches = selected.flatMap((base) =>
          Object.hasOwn(base.objects, value)
            ? [
                {
                  sourceSha256: base.source.sha256,
                  objectHash: value,
                  authored: base.objects[value],
                  layout: positions(base.objects[value]),
                },
              ]
            : [],
        );
        bindings.push({ fieldPath, reference: value, matches });
        if (matches.length) referenced.add(value);
      } else if (value && typeof value === "object")
        for (const [key, child] of Object.entries(value))
          visit(child, `${fieldPath}/${key}`);
    };
    visit(controller, controllerHash);
    controllers.push({
      file: file.file,
      controllerHash,
      type: controller.__type,
      sourceSha256: file.sha256,
      baseHash,
      baseSources: linkMap.get(baseHash)?.locations ?? [],
      bindings,
    });
  }
}
const report = {
  schema: 1,
  build: hud.build,
  protocol: hud.protocol,
  controllers,
  atlasHashReferences: [...atlasRefs].sort(),
  matchedObjectHashes: referenced.size,
  scope: {
    originalAuthoredRectanglesAndAnchors: true,
    originalAtlasCoordinates: true,
    omittedPropertiesDefaulted: false,
    anchorScalingAlgorithmExecuted: false,
    runtimeStateBindingsExecuted: false,
    nativeHudRendered: false,
  },
};
await Bun.write(output, JSON.stringify(report, null, 2));
await Bun.write(
  `${output}.refs.json`,
  JSON.stringify(
    {
      schema: 1,
      build: hud.build,
      protocol: hud.protocol,
      wadHashReferences: [...atlasRefs].sort(),
      source: output,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    controllers: controllers.length,
    matchedObjectHashes: referenced.size,
    atlasHashReferences: atlasRefs.size,
    output,
  }),
);
