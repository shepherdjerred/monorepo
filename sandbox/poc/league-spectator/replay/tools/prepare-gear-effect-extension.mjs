// Installed static definitions/assets only. This never reads a replay or changes
// the base effect manifest. Ordinary admission needs a separate selected owner.
import { resolve, dirname, sep } from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";
import {
  buildGearEffectClosure,
  mergeGearDefinitions,
  gearMetaHash,
  gearAssetPath,
} from "./gear-effect-extension.mjs";
import { createLatestPositiveFormResourcePrefix } from "../latest-positive-form-resource-prefix.mjs";

const [
  installationArgument,
  cacheArgument,
  selectionArgument,
  outputArgument,
  dotnetArgument,
] = process.argv.slice(2);
if (!outputArgument)
  throw Error(
    "Usage: bun prepare-gear-effect-extension.mjs <installation> <cache> <selection.json> <new-output-directory> [dotnet]",
  );
const installation = resolve(installationArgument),
  cache = resolve(cacheArgument),
  out = resolve(outputArgument),
  base = resolve(cache, "public/latest-effects"),
  tools = dirname(import.meta.path),
  work = resolve(cache, "research/gear-effect-extension"),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  inputs = {};
if (out === base || out.startsWith(base + sep) || base.startsWith(out + sep))
  throw Error(
    "Gear extension must not replace or contain the base effect package",
  );
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = hash(bytes);
  if (Object.hasOwn(inputs, path) && inputs[path] !== digest)
    throw Error(`Changed gear preparation input: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  read = async (path) => decode(await raw(path)),
  selection = await read(selectionArgument),
  manifestBytes = await raw(`${base}/manifest.json`),
  manifest = decode(manifestBytes),
  basePackageBytes = await raw(`${base}/package.json`),
  basePackage = decode(basePackageBytes),
  gearBytes = await raw(
    `${cache}/public/latest-unit-gear-resources/package.json`,
  ),
  gears = decode(gearBytes),
  prefixBytes = await raw(
    `${cache}/public/latest-positive-form-resource-prefix/package.json`,
  ),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  owner = await createLatestPositiveFormResourcePrefix({
    profile,
    packageBytes: prefixBytes,
    effectsManifestBytes: manifestBytes,
    gearPackageBytes: gearBytes,
  });
if (
  selection.schema !== 1 ||
  selection.kind !== "gear-effect-extension-selection" ||
  !Array.isArray(selection.selections) ||
  !selection.selections.length ||
  selection.selections.length > 256 ||
  manifest.build !== "16.21.829.8620" ||
  manifest.protocol !== "20e09df23c66b85e" ||
  basePackage.build !== manifest.build ||
  basePackage.protocol !== manifest.protocol ||
  stringifyAssetJson(basePackage.toolchain) !==
    stringifyAssetJson(manifest.toolchain)
)
  throw Error("Unsupported static gear-extension selection/build");
if (
  hash(await raw(`${installation}/Game/League of Legends.exe`)) !==
  "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a"
)
  throw Error("Installed executable changed");
const exporter = `${cache}/exporter-build/bin/Debug/net10.0/Exporter.dll`,
  exporterSha256 = hash(await raw(exporter));
if (exporterSha256 !== manifest.toolchain.exporterSha256)
  throw Error("Pinned effect exporter changed");
for (const name of ["Program.cs", "Exporter.csproj"])
  if (
    hash(await raw(`${tools}/exporter/${name}`)) !==
    hash(await raw(`${cache}/exporter-build/${name}`))
  )
    throw Error(`Exporter source changed: ${name}`);
for (const [name, digest] of Object.entries(manifest.toolchain.dictionaries))
  if (hash(await raw(`${cache}/vfx/hashes.${name}.txt`)) !== digest)
    throw Error(`Static BIN dictionary changed: ${name}`);
if (
  hash(await raw(`${tools}/parse-latest-assets.py`)) !==
  manifest.toolchain.parserSha256
)
  throw Error("Static BIN parser changed");
const { decompress } = await import(
  pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
);
await raw(`${cache}/public/vendor/fzstd.mjs`);
const selectedKeys = new Set(),
  actorKeys = new Set(),
  selected = [];
for (const item of selection.selections) {
  const capability = owner.metadata.capabilities.find(
      (entry) => entry.actorKey === item.actorKey,
    ),
    proof = capability?.selections.find((entry) => entry.index === item.index),
    authored = gears.actors[item.actorKey]?.[item.index],
    key = `${item.actorKey}:${item.index}`;
  if (
    !proof ||
    !authored ||
    selectedKeys.has(key) ||
    stringifyAssetJson(proof.rows) !== stringifyAssetJson(authored.rows)
  )
    throw Error(`Native-proven unique actor/index required: ${key}`);
  selectedKeys.add(key);
  actorKeys.add(item.actorKey);
  selected.push({ item, proof, authored });
}
const archives = [
    ...new Set([
      "DATA/FINAL/Global.wad.client",
      "DATA/FINAL/DATA.wad.client",
      ...[...actorKeys].map(
        (key) =>
          `DATA/FINAL/Champions/${manifest.actors[key].character.toLowerCase()}.wad.client`,
      ),
    ]),
  ],
  readers = [];
for (const archive of archives)
  readers.push({
    archive,
    read: await openLocalWad(installation, archive, decompress),
  });
const sourceAssets = new Map();
async function installed(path) {
  path = gearAssetPath(path);
  const matches = readers.filter(({ read }) => read.has(path));
  if (!matches.length)
    throw Error(
      `Referenced installed asset absent from selected archives: ${path}`,
    );
  const values = await Promise.all(matches.map(({ read }) => read(path))),
    digest = hash(values[0]);
  if (values.some((bytes) => hash(bytes) !== digest))
    throw Error(`Conflicting installed asset sources: ${path}`);
  sourceAssets.set(path, {
    path,
    sha256: digest,
    bytes: values[0].length,
    archives: matches.map(({ archive }) => archive),
  });
  return { bytes: values[0], sha256: digest };
}
const actorObjects = new Map(),
  actorSources = {};
for (const actorKey of actorKeys) {
  const actor = basePackage.actors[actorKey],
    objects = new Map();
  if (!actor?.sourceBins?.length)
    throw Error(`Missing parsed actor provenance: ${actorKey}`);
  actorSources[actorKey] = actor.sourceBins;
  for (const source of actor.sourceBins) {
    const stem = `${source.sourceSha256}-${manifest.toolchain.parserIdentity.slice(0, 16)}`,
      original = await raw(`${cache}/research/latest-effects/bins/${stem}.bin`),
      parsedBytes = await raw(
        `${cache}/research/latest-effects/bins/${stem}.json`,
      ),
      currentInstalled = await installed(source.path);
    if (
      hash(original) !== source.sourceSha256 ||
      hash(parsedBytes) !== source.jsonSha256 ||
      currentInstalled.sha256 !== source.sourceSha256
    )
      throw Error(`Installed/parsed actor source changed: ${source.path}`);
    for (const [name, value] of Object.entries(decode(parsedBytes))) {
      if (name.startsWith("__")) continue;
      const id = gearMetaHash(name),
        previous = objects.get(id);
      if (
        previous &&
        stringifyAssetJson(previous.value) !== stringifyAssetJson(value)
      )
        throw Error(
          `Actor source override precedence unresolved: ${actorKey}/${id}`,
        );
      if (previous) previous.sources.push(source.path);
      else objects.set(id, { value, sources: [source.path] });
    }
  }
  actorObjects.set(actorKey, objects);
}
const definitionRecords = new Map(),
  resources = [],
  unresolvedReferences = [];
for (const { item, proof, authored } of selected) {
  const closure = buildGearEffectClosure({
    actorKey: item.actorKey,
    gear: authored,
    resourceKeys: item.resourceKeys,
    objects: actorObjects.get(item.actorKey),
    baseResources: manifest.actors[item.actorKey].resources,
  });
  mergeGearDefinitions(definitionRecords, closure);
  resources.push({
    actorKey: item.actorKey,
    index: item.index,
    gearIdentity: proof.gearIdentity,
    sourceSha256: proof.sourceSha256,
    rows: closure.rows,
  });
  unresolvedReferences.push(
    ...closure.unresolved.map((row) => ({ index: item.index, ...row })),
  );
}
const files = {},
  assets = {},
  textureJobs = {},
  meshJobs = [];
await mkdir(work, { recursive: true });
async function writeFile(file, bytes) {
  const path = resolve(out, file);
  if (!path.startsWith(out + sep))
    throw Error("Extension output path escaped its root");
  const digest = hash(bytes);
  if (Object.hasOwn(files, file) && files[file].sha256 !== digest)
    throw Error(`Conflicting output file: ${file}`);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, bytes);
  files[file] = {
    sha256: digest,
    bytes:
      typeof bytes === "string"
        ? new TextEncoder().encode(bytes).length
        : bytes.byteLength,
  };
}
async function command(args) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" }),
    [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
  if (code) throw Error(`Gear asset exporter failed: ${stdout}\n${stderr}`);
}
for (const record of definitionRecords.values())
  for (const dependency of record.dependencies) {
    const path = dependency.path;
    if (Object.hasOwn(assets, path)) continue;
    const extension = path.split(".").at(-1);
    if (
      !["tex", "dds", "scb", "sco", "skn", "skl", "anm"].includes(extension)
    ) {
      assets[path] = {
        kind: extension,
        status: "unprepared",
        reason: "Asset format not translated by this effect compiler",
      };
      continue;
    }
    const source = await installed(path),
      rawFile = `raw/${source.sha256}.${extension}`,
      key = hash(`${source.sha256}|${exporterSha256}|${extension}`).slice(
        0,
        24,
      );
    await writeFile(rawFile, source.bytes);
    const common = { sourceSha256: source.sha256, rawFile };
    if (["tex", "dds"].includes(extension)) {
      const file = `textures/${key}.png`;
      await mkdir(`${out}/textures`, { recursive: true });
      textureJobs[resolve(out, rawFile)] = resolve(out, file);
      assets[path] = { kind: "texture", status: "prepared", file, ...common };
    } else if (["scb", "sco"].includes(extension)) {
      const file = `meshes/${key}.json`;
      await mkdir(`${out}/meshes`, { recursive: true });
      meshJobs.push({ rawFile, file });
      assets[path] = {
        kind: "static-mesh",
        status: "prepared",
        file,
        ...common,
      };
    } else
      assets[path] = {
        kind: extension,
        status: "unprepared",
        reason: "Asset format not translated by this effect compiler",
        ...common,
      };
  }
const dotnet = dotnetArgument ?? "C:/Program Files/dotnet/dotnet.exe";
if (Object.keys(textureJobs).length) {
  const jobs = `${work}/texture-jobs.json`;
  await Bun.write(jobs, JSON.stringify(textureJobs));
  await command([dotnet, exporter, "textures", jobs]);
}
for (const { rawFile, file } of meshJobs)
  await command([
    dotnet,
    exporter,
    "effect-mesh",
    resolve(out, rawFile),
    resolve(out, file),
  ]);
for (const asset of Object.values(assets))
  if (asset.file) {
    const bytes = await Bun.file(resolve(out, asset.file)).bytes();
    asset.sha256 = hash(bytes);
    asset.bytes = bytes.length;
    if (asset.kind === "texture") {
      if (bytes.length < 24) throw Error("Truncated converted PNG");
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      if (view.getUint32(0) !== 0x89504e47 || view.getUint32(12) !== 0x49484452)
        throw Error("Invalid converted PNG");
      asset.width = view.getUint32(16);
      asset.height = view.getUint32(20);
      if (!asset.width || !asset.height) throw Error("Empty converted PNG");
    } else {
      const mesh = decode(bytes);
      if (
        !mesh.positions?.length ||
        mesh.positions.length % 9 ||
        mesh.uv?.length * 3 !== mesh.positions.length * 2 ||
        ![...mesh.positions, ...mesh.uv].every(Number.isFinite)
      )
        throw Error("Invalid converted effect mesh");
      asset.triangles = mesh.positions.length / 9;
    }
    await writeFile(asset.file, bytes);
  }
const definitions = {};
for (const [id, record] of definitionRecords) {
  const bytes = stringifyAssetJson(record),
    digest = hash(bytes),
    file = `definitions/${digest}.json`,
    field = (name) =>
      record.definition[name] ??
      record.definition[`{${gearMetaHash(name)}}`] ??
      [];
  await writeFile(file, bytes);
  definitions[id] = {
    file,
    sha256: digest,
    actor: record.actor,
    class: record.definition.__type,
    complexEmitters: field("complexEmitterDefinitionData").length,
    simpleEmitters: field("simpleEmitterDefinitionData").length,
    dependencies: record.dependencies,
    references: record.references,
  };
}
for (const source of [
  import.meta.path,
  `${tools}/gear-effect-extension.mjs`,
  `${tools}/asset-json.mjs`,
  `${tools}/wad.mjs`,
  `${tools}/../latest-positive-form-resource-prefix.mjs`,
])
  await raw(source);
const scope = {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    containsUnitInstances: false,
    ordinaryActivationEnabled: false,
    nativeLiveGearAcceptance: null,
    selectedResourcePrefixOnly: true,
    olderUnknownStackFallbackAllowed: false,
    shaderMaterialAdmissionEstablished: false,
    renderedCoverageEstablished: false,
  },
  result = {
    schema: 1,
    kind: "prepared-gear-effect-extension",
    build: manifest.build,
    protocol: manifest.protocol,
    baseManifestSha256: hash(manifestBytes),
    unitGearResourcesSha256: hash(gearBytes),
    positivePrefixPackageSha256: hash(prefixBytes),
    selectionSha256: inputs[resolve(selectionArgument)],
    toolchain: {
      ...manifest.toolchain,
      gearPreparerSha256: inputs[resolve(import.meta.path)],
      gearClosureSha256: inputs[resolve(`${tools}/gear-effect-extension.mjs`)],
    },
    actorSources,
    resources,
    definitions,
    assets,
    files,
    sourceAssets: [...sourceAssets.values()],
    unresolvedReferences,
    scope,
    omissions: [
      ...owner.metadata.omissions,
      "gear-extension:shader-material-and-component-admission-not-established",
      "gear-extension:child-activation-semantics-unresolved",
    ],
    summary: {
      selections: resources.length,
      rootResources: resources.reduce((n, row) => n + row.rows.length, 0),
      definitions: Object.keys(definitions).length,
      emitterComponents: Object.values(definitions).reduce(
        (n, row) => n + row.complexEmitters + row.simpleEmitters,
        0,
      ),
      assets: Object.keys(assets).length,
      preparedAssets: Object.values(assets).filter(
        (a) => a.status === "prepared",
      ).length,
      unresolvedReferences: unresolvedReferences.length,
      files: Object.keys(files).length,
    },
  };
// Validate every input again before publishing a package that binds this closure.
for (const [path, digest] of Object.entries(inputs))
  if (hash(await Bun.file(path).bytes()) !== digest)
    throw Error(`Input changed before gear extension publication: ${path}`);
for (const [file, metadata] of Object.entries(files)) {
  const bytes = await Bun.file(resolve(out, file)).bytes();
  if (hash(bytes) !== metadata.sha256 || bytes.length !== metadata.bytes)
    throw Error(`Output changed before publication: ${file}`);
}
const resultBytes = stringifyAssetJson(result);
await writeFile("package.json", resultBytes);
const report = {
  schema: 1,
  kind: "gear-effect-extension-preparation",
  packageSha256: hash(resultBytes),
  out,
  inputs,
  baseManifestUnchanged:
    hash(await Bun.file(`${base}/manifest.json`).bytes()) ===
    hash(manifestBytes),
  summary: result.summary,
  scope,
};
await Bun.write(
  `${work}/preparation-v35.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    out,
    sha256: report.packageSha256,
    ...result.summary,
    baseManifestUnchanged: report.baseManifestUnchanged,
  }),
);
