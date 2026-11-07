// Static asset preparation from installed WADs. Never reads a replay.
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { openLocalWad } from "./wad.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";

const [installationArg, sceneArg, cacheArg, pythonArg, dotnetArg] =
  process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-latest-effects.mjs <installation> <scene-dir> <cache-root> [python] [dotnet]",
  );
const installation = resolve(installationArg),
  sceneRoot = resolve(sceneArg),
  cache = resolve(cacheArg),
  work = `${cache}/research/latest-effects`,
  out = `${cache}/public/latest-effects`,
  tools = dirname(fileURLToPath(import.meta.url)),
  python = pythonArg ?? `${cache}/research/venv/Scripts/python.exe`,
  dotnet = dotnetArg ?? "C:/Program Files/dotnet/dotnet.exe",
  exporter = `${cache}/exporter-build/bin/Debug/net10.0/Exporter.dll`,
  hash = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex"),
  sceneBytes = await Bun.file(`${sceneRoot}/manifest.json`).arrayBuffer(),
  manifest = JSON.parse(new TextDecoder().decode(sceneBytes)),
  world = await Bun.file(`${sceneRoot}/${manifest.world}`).json();
if (
  manifest.build !== "16.21.829.8620" ||
  manifest.protocol !== "20e09df23c66b85e" ||
  manifest.map.id !== 12
)
  throw Error("Unprepared effect build/map");
if (
  hash(
    await Bun.file(`${installation}/Game/League of Legends.exe`).arrayBuffer(),
  ) !== "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a"
)
  throw Error("Installed executable changed");
const exporterSha256 = hash(await Bun.file(exporter).arrayBuffer());
if (exporterSha256 !== manifest.toolchain.exporterSha256)
  throw Error(
    "Rebuild the scene with the current exporter before preparing effects",
  );
for (const name of ["Program.cs", "Exporter.csproj"])
  if (
    hash(await Bun.file(`${tools}/exporter/${name}`).arrayBuffer()) !==
    hash(await Bun.file(`${cache}/exporter-build/${name}`).arrayBuffer())
  )
    throw Error(`Exporter source changed: ${name}`);
const { decompress } = await import(
  pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
);
await mkdir(`${work}/bins`, { recursive: true });
await mkdir(`${out}/textures`, { recursive: true });
await mkdir(`${out}/meshes`, { recursive: true });
await mkdir(`${out}/raw`, { recursive: true });
await mkdir(`${out}/definitions`, { recursive: true });
const dictionaries = {};
for (const name of ["binfields", "bintypes"])
  dictionaries[name] = hash(
    await Bun.file(`${cache}/vfx/hashes.${name}.txt`).arrayBuffer(),
  );
const parserSha256 = hash(
    await Bun.file(`${tools}/parse-latest-assets.py`).arrayBuffer(),
  ),
  parserIdentity = hash(
    JSON.stringify({
      parserSha256,
      dictionaries,
      cdtbRevision: "3367589fdd3ee3d0d01383d2f98dba12b04d1371",
    }),
  ),
  actors = [
    ...Object.entries(manifest.champions).map(([key, asset]) => ({
      key: `champions/${key}`,
      character: asset.champion,
      asset,
    })),
    ...Object.entries(world.assets)
      .filter(([, asset]) => asset.spellCatalog)
      .map(([key, asset]) => ({
        key: `world/${key}`,
        character: asset.character,
        asset,
      })),
  ],
  archives = [
    ...new Set([
      "DATA/FINAL/Global.wad.client",
      "DATA/FINAL/DATA.wad.client",
      "DATA/FINAL/Maps/Shipping/Map12.wad.client",
      ...Object.values(manifest.champions).map(
        (asset) =>
          `DATA/FINAL/Champions/${asset.champion.toLowerCase()}.wad.client`,
      ),
    ]),
  ],
  readers = [];
for (const archive of archives)
  readers.push({
    archive,
    read: await openLocalWad(installation, archive, decompress),
  });
function pathName(path) {
  if (
    typeof path !== "string" ||
    path.startsWith("/") ||
    path.includes(":") ||
    path.split(/[\\/]/).some((p) => p === ".." || p === ".")
  )
    throw Error(`Invalid installed asset path ${path}`);
  return path.replaceAll("\\", "/").toLowerCase();
}
const sourceAssets = new Map();
async function installed(path) {
  path = pathName(path);
  const matches = readers.filter(({ read }) => read.has(path));
  if (!matches.length)
    throw Error(
      `Referenced installed asset absent from declared archives: ${path}`,
    );
  const bytes = await Promise.all(matches.map(({ read }) => read(path))),
    sha256 = hash(bytes[0]);
  if (bytes.some((value) => hash(value) !== sha256))
    throw Error(`Conflicting installed archive definitions: ${path}`);
  sourceAssets.set(path, {
    path,
    sha256,
    bytes: bytes[0].length,
    archives: matches.map((m) => m.archive),
  });
  return { bytes: bytes[0], sha256, path };
}
async function command(argv) {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code)
    throw Error(`Asset preparation failed (${argv[1]}): ${stdout}\n${stderr}`);
  if (stdout.trim()) console.log(stdout.trim());
}
const parsed = new Map();
let generation = 0;
async function parseClosure(seeds) {
  const closure = new Map();
  let pending = [...seeds].map(pathName);
  while (pending.length) {
    const batch = [...new Set(pending)].filter((path) => !closure.has(path));
    pending = [];
    if (!batch.length) break;
    const jobs = [];
    for (const path of batch) {
      if (parsed.has(path)) continue;
      const source = await installed(path),
        key = `${source.sha256}-${parserIdentity.slice(0, 16)}`,
        raw = `${work}/bins/${key}.bin`,
        json = `${work}/bins/${key}.json`;
      await Bun.write(raw, source.bytes);
      jobs.push({ path, source: raw, sha256: source.sha256, output: json });
    }
    if (jobs.length) {
      const id = generation++,
        request = `${work}/parse-${id}.json`,
        summary = `${work}/parsed-${id}.json`;
      await Bun.write(
        request,
        JSON.stringify({ schema: 1, build: manifest.build, jobs }),
      );
      await command([
        python,
        `${tools}/parse-latest-assets.py`,
        request,
        `${cache}/vfx`,
        summary,
      ]);
      const result = await Bun.file(summary).json();
      for (const item of result.results) {
        const job = jobs.find((job) => job.path === item.path),
          bytes = await Bun.file(job.output).arrayBuffer();
        if (hash(bytes) !== item.jsonSha256)
          throw Error("Parsed BIN cache integrity failure");
        parsed.set(item.path, {
          data: JSON.parse(new TextDecoder().decode(bytes)),
          provenance: item,
        });
      }
    }
    for (const path of batch) {
      const entry = parsed.get(path);
      if (!entry) throw Error(`BIN parser omitted ${path}`);
      closure.set(path, entry);
      for (const dependency of entry.data.__linked ?? [])
        pending.push(pathName(dependency));
    }
  }
  return closure;
}
function metaHash(value) {
  if (/^\{[a-f0-9]{8}\}$/i.test(value)) return value.slice(1, -1).toLowerCase();
  let hash = 2166136261;
  for (const char of value.toLowerCase())
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
}
function field(object, name) {
  return Object.hasOwn(object, name)
    ? object[name]
    : object[`{${metaHash(name)}}`];
}
const packageData = {
  schema: 1,
  build: manifest.build,
  protocol: manifest.protocol,
  sceneManifestSha256: hash(sceneBytes),
  toolchain: {
    preparerSha256: hash(
      await Bun.file(fileURLToPath(import.meta.url)).arrayBuffer(),
    ),
    assetJsonSha256: hash(
      await Bun.file(`${tools}/asset-json.mjs`).arrayBuffer(),
    ),
    assetJsonPolicy: "finite-numeric-json-preserve-signed-zero-v1",
    parserSha256,
    wadReaderSha256: hash(await Bun.file(`${tools}/wad.mjs`).arrayBuffer()),
    parserIdentity,
    dictionaries,
    cdtbRevision: "3367589fdd3ee3d0d01383d2f98dba12b04d1371",
    exporterSha256,
    leagueToolkitRevision: manifest.toolchain.leagueToolkitRevision,
  },
  actors: {},
  effects: {},
  linkedDefinitions: {},
  assets: {},
  limitations: [
    "Static definitions and dependency preparation only; no replay is read",
    "Activation, particle evaluation, shader/material behavior, attachment, visibility and audio are not established by this package",
    "Unknown fields and class hashes are retained; no emitter subset is silently discarded",
  ],
};
for (const actor of actors) {
  const { asset, character, key } = actor;
  if (!asset.skinDefinition)
    throw Error(`Static scene omits skin definition ${key}`);
  const skinPath = `data/characters/${character.toLowerCase()}/skins/skin${asset.skinId}.bin`,
    catalog = await Bun.file(`${sceneRoot}/${asset.spellCatalog}`).json(),
    closure = await parseClosure([
      skinPath,
      `data/characters/${character.toLowerCase()}/${character.toLowerCase()}.bin`,
      ...(catalog.dependencyCharacters ?? []).map((d) => d.asset),
    ]),
    objects = new Map();
  for (const [path, entry] of closure)
    for (const [id, value] of Object.entries(entry.data)) {
      if (id.startsWith("__")) continue;
      const hash = metaHash(id),
        candidates = objects.get(hash) ?? [];
      candidates.push({ path, value });
      objects.set(hash, candidates);
    }
  const unresolved = [];
  function object(id, reason) {
    const candidates = objects.get(metaHash(id));
    if (!candidates?.length) {
      unresolved.push({
        id,
        reason: "Definition outside prepared closure",
        reference: reason,
      });
      return null;
    }
    const values = new Set(candidates.map((c) => stringifyAssetJson(c.value)));
    if (values.size !== 1) {
      unresolved.push({
        id,
        reason: "BIN override precedence unresolved",
        reference: reason,
        sources: candidates.map((c) => c.path),
      });
      return null;
    }
    return {
      id: metaHash(id),
      value: candidates[0].value,
      sources: candidates.map((c) => c.path),
    };
  }
  const skin = object(
    `Characters/${character}/Skins/Skin${asset.skinId}`,
    "requested skin",
  );
  if (!skin) throw Error(`Unresolved requested skin ${key}`);
  const resolverId = field(skin.value, "mResourceResolver"),
    resolver = resolverId ? object(resolverId, "skin resource resolver") : null,
    resources = resolver ? field(resolver.value, "resourceMap") : null,
    aliases = new Map();
  for (const [alias, path] of Object.entries(resources ?? {}))
    aliases.set(metaHash(alias), path);
  const actorData = {
    character,
    skinId: asset.skinId,
    skinPath,
    resourceResolverId: resolverId ?? null,
    missiles: {},
    resources: {},
    unresolved,
    sourceBins: [...closure.values()].map((entry) => entry.provenance),
  };
  const queue = [];
  for (const [alias, path] of aliases) {
    if (metaHash(path) === "00000000") {
      actorData.resources[alias] = {
        status: "null-object-link",
        reference: path,
      };
      continue;
    }
    const definition = object(path, `resource ${alias}`);
    if (
      !definition ||
      metaHash(definition.value.__type) !== metaHash("VfxSystemDefinitionData")
    ) {
      actorData.resources[alias] = {
        status: "unprepared",
        reference: path,
        reason: definition
          ? `Resource type ${definition.value.__type}`
          : "Definition unresolved",
      };
      continue;
    }
    const effectId = `${key}/${definition.id}`;
    actorData.resources[alias] = {
      status: "prepared-definition",
      reference: path,
      effectId,
    };
    queue.push(definition);
  }
  for (const spell of Object.values(catalog.spells)) {
    const native = object(spell.path, `spell ${spell.name}`);
    if (!native) {
      actorData.missiles[spell.hash] = {
        spell: spell.name,
        status: "unprepared-spell",
      };
      continue;
    }
    const data = field(native.value, "mSpell");
    if (!data) throw Error(`Installed spell has no data ${key}/${spell.name}`);
    const effectKey = field(data, "mMissileEffectKey") ?? null,
      // BIN stores this as a Hash. Named metadata and opaque native hashes must
      // agree on the identifier, rather than on a dictionary's display spelling.
      effectHash = effectKey === null ? "00000000" : metaHash(effectKey),
      expectedHash =
        spell.data.mMissileEffectKey == null
          ? "00000000"
          : metaHash(spell.data.mMissileEffectKey);
    if (effectHash !== expectedHash)
      throw Error(
        `Static spell catalog differs from installed BIN: ${key}/${spell.name}`,
      );
    if (effectHash === "00000000") {
      actorData.missiles[spell.hash] = {
        spell: spell.name,
        status: "no-declared-missile-effect-key",
      };
      continue;
    }
    const binding = actorData.resources[effectHash];
    actorData.missiles[spell.hash] = {
      spell: spell.name,
      effectKey,
      ...(binding ?? {
        status: "unprepared",
        reason: "Effect key absent from equipped-skin resource resolver",
      }),
    };
  }
  const visited = new Set();
  while (queue.length) {
    const definition = queue.shift();
    if (visited.has(definition.id)) continue;
    visited.add(definition.id);
    const effectId = `${key}/${definition.id}`,
      dependencies = [],
      references = [];
    function walk(value, path) {
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      if (value && typeof value === "object") {
        for (const [name, item] of Object.entries(value))
          if (
            ![
              "__type",
              "objectPath",
              "particleName",
              "particlePath",
              "emitterName",
            ].includes(name)
          )
            walk(item, `${path}.${name}`);
        return;
      }
      if (typeof value !== "string") return;
      if (/^(assets|data)\/.+\.[a-z0-9_]+$/i.test(value))
        dependencies.push({ property: path, path: pathName(value) });
      else {
        const id = metaHash(value),
          target = aliases.get(id) ?? (objects.has(id) ? value : null);
        if (!target) return;
        const candidates = objects.get(metaHash(target));
        if (!candidates?.length) return;
        const child = object(target, `${effectId}${path}`);
        if (child) {
          references.push({
            property: path,
            effectId: `${key}/${child.id}`,
            status: "reference; activation semantics unresolved",
          });
          queue.push(child);
        }
      }
    }
    walk(definition.value, "");
    const collection =
      metaHash(definition.value.__type) === metaHash("VfxSystemDefinitionData")
        ? packageData.effects
        : packageData.linkedDefinitions;
    collection[effectId] = {
      id: definition.id,
      actor: key,
      sourceBins: definition.sources,
      definition: definition.value,
      dependencies,
      references,
    };
  }
  packageData.actors[key] = actorData;
  console.log(
    `${key}: ${closure.size} BINs, ${visited.size} reachable definitions, ${unresolved.length} unresolved references`,
  );
}
const jobs = {},
  meshes = new Map();
for (const effect of [
  ...Object.values(packageData.effects),
  ...Object.values(packageData.linkedDefinitions),
])
  for (const dependency of effect.dependencies) {
    const path = dependency.path;
    if (packageData.assets[path]) continue;
    const extension = path.split(".").at(-1);
    if (
      !["tex", "dds", "scb", "sco", "skn", "skl", "anm"].includes(extension)
    ) {
      packageData.assets[path] = {
        kind: extension,
        status: "unprepared",
        reason: "Asset format not translated by this effect compiler",
      };
      continue;
    }
    const source = await installed(path),
      key = hash(`${source.sha256}|${exporterSha256}|${extension}`).slice(
        0,
        24,
      ),
      raw = `${work}/${key}.${extension}`;
    await Bun.write(raw, source.bytes);
    // Retain native source data as well as converted previews. Texture mip and
    // sampling fidelity, and animated VFX meshes, need more than a Mip0 PNG.
    const rawFile = `raw/${source.sha256}.${extension}`;
    await Bun.write(`${out}/${rawFile}`, source.bytes);
    if (["tex", "dds"].includes(extension)) {
      const file = `textures/${key}.png`;
      jobs[raw] = `${out}/${file}`;
      packageData.assets[path] = {
        kind: "texture",
        status: "prepared",
        file,
        sourceSha256: source.sha256,
        rawFile,
      };
    } else if (["scb", "sco"].includes(extension)) {
      const file = `meshes/${key}.json`;
      meshes.set(raw, { file });
      packageData.assets[path] = {
        kind: "static-mesh",
        status: "prepared",
        file,
        sourceSha256: source.sha256,
        rawFile,
      };
    } else
      packageData.assets[path] = {
        kind: extension,
        status: "unprepared",
        reason: "Asset format not translated by this effect compiler",
        sourceSha256: source.sha256,
        rawFile,
      };
  }
if (Object.keys(jobs).length) {
  await Bun.write(`${work}/texture-jobs.json`, JSON.stringify(jobs));
  await command([dotnet, exporter, "textures", `${work}/texture-jobs.json`]);
}
for (const [raw, { file }] of meshes)
  await command([dotnet, exporter, "effect-mesh", raw, `${out}/${file}`]);
for (const asset of Object.values(packageData.assets))
  if (asset.file) {
    const bytes = await Bun.file(`${out}/${asset.file}`).arrayBuffer();
    asset.sha256 = hash(bytes);
    asset.bytes = bytes.byteLength;
    if (asset.kind === "texture") {
      const view = new DataView(bytes);
      if (view.getUint32(0) !== 0x89504e47 || view.getUint32(12) !== 0x49484452)
        throw Error("Invalid converted PNG");
      asset.width = view.getUint32(16);
      asset.height = view.getUint32(20);
    } else {
      const mesh = JSON.parse(new TextDecoder().decode(bytes));
      if (
        !mesh.positions?.length ||
        mesh.positions.length % 9 ||
        mesh.uv.length * 3 !== mesh.positions.length * 2 ||
        ![...mesh.positions, ...mesh.uv].every(Number.isFinite)
      )
        throw Error("Invalid effect mesh output");
      asset.triangles = mesh.positions.length / 9;
    }
  }
packageData.sourceAssets = [...sourceAssets.values()];
packageData.summary = {
  actors: actors.length,
  parsedBins: parsed.size,
  effects: Object.keys(packageData.effects).length,
  declaredMissileBindings: Object.values(packageData.actors)
    .flatMap((a) => Object.values(a.missiles))
    .filter((b) => b.effectKey).length,
  preparedMissileBindings: Object.values(packageData.actors)
    .flatMap((a) => Object.values(a.missiles))
    .filter((b) => b.status === "prepared-definition").length,
  textures: Object.values(packageData.assets).filter(
    (a) => a.kind === "texture",
  ).length,
  textureFiles: Object.keys(jobs).length,
  staticMeshes: meshes.size,
  unpreparedAssets: Object.values(packageData.assets).filter(
    (a) => a.status === "unprepared",
  ).length,
  linkedDefinitions: Object.keys(packageData.linkedDefinitions).length,
  nullResourceLinks: Object.values(packageData.actors)
    .flatMap((a) => Object.values(a.resources))
    .filter((r) => r.status === "null-object-link").length,
  unresolvedResourceReferences: Object.values(packageData.actors).reduce(
    (n, a) => n + a.unresolved.length,
    0,
  ),
};
await Bun.write(`${out}/package.json`, stringifyAssetJson(packageData));
// A compact runtime index points to complete definitions for lazy loading.
const definitions = {};
for (const [id, effect] of Object.entries({
  ...packageData.effects,
  ...packageData.linkedDefinitions,
})) {
  const bytes = stringifyAssetJson(effect),
    sha256 = hash(bytes),
    file = `definitions/${sha256}.json`;
  await Bun.write(`${out}/${file}`, bytes);
  definitions[id] = {
    file,
    sha256,
    actor: effect.actor,
    class: effect.definition.__type,
    complexEmitters: (
      field(effect.definition, "complexEmitterDefinitionData") ?? []
    ).length,
    simpleEmitters: (
      field(effect.definition, "simpleEmitterDefinitionData") ?? []
    ).length,
    dependencies: effect.dependencies,
    references: effect.references,
  };
}
await Bun.write(
  `${out}/manifest.json`,
  stringifyAssetJson({
    schema: 1,
    build: packageData.build,
    protocol: packageData.protocol,
    sceneManifestSha256: packageData.sceneManifestSha256,
    toolchain: packageData.toolchain,
    summary: packageData.summary,
    actors: Object.fromEntries(
      Object.entries(packageData.actors).map(
        ([id, { sourceBins, ...actor }]) => [id, actor],
      ),
    ),
    definitions,
    assets: packageData.assets,
    limitations: [
      ...packageData.limitations,
      "Converted texture previews use Mip0; native mip/sampling behavior is not verified",
      "Native SKN/SKL/ANM dependencies are retained but their VFX rendering is not translated",
    ],
  }),
);
console.log(JSON.stringify(packageData.summary));
