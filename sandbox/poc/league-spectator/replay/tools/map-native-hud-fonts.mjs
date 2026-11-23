import path from "node:path";
import { actorSha256 } from "./archived-actor-sources.mjs";

const [uiLinksPath, fontLinksPath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun map-native-hud-fonts.mjs <original-hud-links.json> <original-font-namespace-links.json> <output.json>",
  );
const uiLinks = await Bun.file(uiLinksPath).json(),
  fontLinks = await Bun.file(fontLinksPath).json(),
  fontLocations = fontLinks.results
    .flatMap((entry) => entry.locations)
    .filter((location) => location.normalizedPath);
if (fontLocations.length !== 1)
  throw Error("One verified original font namespace required");
const location = fontLocations[0],
  fontDataPath = path.join(
    path.dirname(fontLinksPath),
    location.normalizedPath,
  ),
  fontDataBytes = await Bun.file(fontDataPath).bytes(),
  fontBank = JSON.parse(new TextDecoder().decode(fontDataBytes)).normalized,
  requests = [],
  sourceFiles = {};
for (const entry of uiLinks.results)
  for (const source of entry.locations) {
    if (!source.normalizedPath) continue;
    const sourcePath = path.join(
        path.dirname(uiLinksPath),
        source.normalizedPath,
      ),
      bytes = await Bun.file(sourcePath).bytes(),
      data = JSON.parse(new TextDecoder().decode(bytes)).normalized;
    sourceFiles[sourcePath] = actorSha256(bytes);
    for (const [objectHash, value] of Object.entries(data))
      if (
        value.__type === "UiElementTextData" &&
        value.FontDescription !== undefined
      )
        requests.push({
          sourceBinSha256: source.sha256,
          objectHash,
          fontHash: value.FontDescription,
          authoredText: value.TRAKey ?? null,
          authoredHorizontalAlignment: value.TextAlignmentHorizontal ?? null,
          authoredVerticalAlignment: value.TextAlignmentVertical ?? null,
        });
  }
const definitions = {},
  missing = new Set(),
  fonts = new Set(),
  active = new Set();
function include(key) {
  if (Object.hasOwn(definitions, key)) return;
  const node = fontBank[key];
  if (!node) {
    missing.add(key);
    return;
  }
  if (active.has(key)) throw Error("Cyclic original font object link closure");
  active.add(key);
  definitions[key] = node;
  function visit(value) {
    if (typeof value === "string") {
      if (/^\{[a-f0-9]{8}\}$/.test(value)) include(value);
      else if (/\.(?:ttf|otf|sdf)$/i.test(value)) fonts.add(value);
    } else if (value && typeof value === "object")
      for (const [name, child] of Object.entries(value))
        if (name !== "__type") visit(child);
  }
  visit(node);
  active.delete(key);
}
for (const request of requests) {
  if (fontBank[request.fontHash]?.__type !== "GameFontDescription")
    throw Error(
      `HUD font ${request.fontHash} is missing its original GameFontDescription`,
    );
  include(request.fontHash);
}
const report = {
  schema: 1,
  build: fontLinks.build,
  protocol: fontLinks.protocol,
  originalNamespace: {
    ...location,
    normalizedSha256: actorSha256(fontDataBytes),
  },
  uiSourceFiles: sourceFiles,
  requests,
  definitions,
  missingObjectLinks: [...missing].sort(),
  originalFontPaths: [...fonts].sort(),
  scope: {
    originalHudFontObjectLinksResolved: true,
    authoredPropertiesPreserved: true,
    missingConstructorPropertiesDefaulted: false,
    localeSelectionExecuted: false,
    fontBytesFetched: false,
    nativeGlyphRendering: false,
  },
};
await Bun.write(outputPath, JSON.stringify(report, null, 2));
await Bun.write(
  `${outputPath}.refs.json`,
  JSON.stringify(
    {
      schema: 1,
      build: fontLinks.build,
      protocol: fontLinks.protocol,
      wadHashReferences: [...fonts]
        .sort()
        .map((name) => Bun.hash.xxHash64(name.toLowerCase()).toString()),
      originalFontPaths: [...fonts].sort(),
      source: outputPath,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    outputPath,
    textObjects: requests.length,
    fontDescriptions: new Set(requests.map((request) => request.fontHash)).size,
    linkedDefinitions: Object.keys(definitions).length,
    missingLinks: missing.size,
    originalFontPaths: [...fonts].sort(),
  }),
);
