// Offline static asset package. Input is an explicit asset request, never a ROFL.
// CommunityDragon JSON is admitted only after its raw BIN equals installed bytes.
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { mkdir } from "node:fs/promises";
import { openLocalWad } from "./wad.mjs";
import { latestMovementOrigin } from "../latest-movement.mjs";

const [installationArg, requestArg, cacheArg, dotnetArg, reuseArg] =
  process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-latest-scene.mjs <installation> <static-request.json> <cache-root> [dotnet] [--reuse-champions]",
  );
if (reuseArg !== undefined && reuseArg !== "--reuse-champions")
  throw Error("Unknown preparation option");
const installation = resolve(installationArg),
  cache = resolve(cacheArg);
const out = `${cache}/public/latest-scene`,
  work = `${cache}/research/latest-assets`;
const dotnet = dotnetArg ?? "C:/Program Files/dotnet/dotnet.exe";
const exporter = `${cache}/exporter-build/bin/Debug/net10.0/Exporter.dll`;
const toolkit = `${cache}/research/LeagueToolkit`;
const toolkitRevision = "76bf57bf4fd195343dec610bf0f912a06b910914";
const toolkitHead = Bun.spawnSync(["git", "-C", toolkit, "rev-parse", "HEAD"]);
if (
  toolkitHead.exitCode ||
  toolkitHead.stdout.toString().trim() !== toolkitRevision
)
  throw Error("LeagueToolkit source revision mismatch");
const request = await Bun.file(requestArg).json();
if (
  request.build !== "16.21.829.8620" ||
  request.mapId !== 12 ||
  request.variant !== "base"
)
  throw Error("Unprepared build/map variant");
const executable = Bun.file(`${installation}/Game/League of Legends.exe`);
const hash = (data) =>
  new Bun.CryptoHasher("sha256").update(data).digest("hex");
const preparerSha256 = hash(
  await Bun.file(fileURLToPath(import.meta.url)).arrayBuffer(),
);
const decoderProfile = await Bun.file(
    `${cache}/public/decoder-16.21-macos/profile.json`,
  ).json(),
  attackNamingBytes = await Bun.file(
    `${cache}/public/decoder-16.21-macos/attack-names.json`,
  ).arrayBuffer(),
  attackNaming = JSON.parse(new TextDecoder().decode(attackNamingBytes));
if (
  hash(attackNamingBytes) !== decoderProfile.attackNamingSha256 ||
  attackNaming.clientVersion !== request.build ||
  decoderProfile.clientVersion !== request.build ||
  attackNaming.schema !== 1 ||
  attackNaming.decoderImageSha256 !== decoderProfile.decoderImageSha256 ||
  attackNaming.sliceSha256 !==
    "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
)
  throw Error("Missing or incompatible original attack-name defaults");
if (
  hash(await executable.arrayBuffer()) !==
  "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a"
)
  throw Error("Installed executable changed");
const { decompress } = await import(
  pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
);
await mkdir(work, { recursive: true });
await mkdir(out, { recursive: true });
const build = `${cache}/exporter-build`,
  toolDirectory = dirname(fileURLToPath(import.meta.url));
await mkdir(build, { recursive: true });
for (const name of ["Program.cs", "Exporter.csproj"])
  await Bun.write(
    `${build}/${name}`,
    await Bun.file(`${toolDirectory}/exporter/${name}`).text(),
  );
// Run outside the workspace SDK pin; this isolated research tool uses installed .NET 10.
const buildChild = Bun.spawn(
  [
    dotnet,
    "build",
    `${build}/Exporter.csproj`,
    `-p:LeagueToolkitRoot=${toolkit}`,
    "-v",
    "quiet",
  ],
  { cwd: tmpdir(), stdout: "pipe", stderr: "pipe" },
);
const [buildOut, buildErr, buildCode] = await Promise.all([
  new Response(buildChild.stdout).text(),
  new Response(buildChild.stderr).text(),
  buildChild.exited,
]);
await Bun.write(`${work}/exporter-build.log`, buildOut + buildErr);
if (buildCode)
  throw Error(`Offline exporter build failed; see ${work}/exporter-build.log`);
const provenance = [],
  textures = {},
  textureJobs = {};
function elfHash(name) {
  let h = 0;
  for (const char of name.toLowerCase()) {
    h = ((h << 4) + char.charCodeAt(0)) >>> 0;
    const high = h & 0xf0000000;
    if (high) h ^= high >>> 24;
    h = (h & ~high) >>> 0;
  }
  return h;
}
function metaHash(name) {
  if (/^\{[a-f0-9]{8}\}$/i.test(name))
    return Number.parseInt(name.slice(1, -1), 16);
  let hash = 2166136261;
  for (const char of name.toLowerCase())
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
async function command(args) {
  const child = Bun.spawn([dotnet, exporter, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw Error(`${args[0]}: ${stdout}\n${stderr}`);
  console.log(stdout.trim());
}
async function extract(get, path, destination) {
  const bytes = await get(path.toLowerCase());
  provenance.push({ path, sha256: hash(bytes), bytes: bytes.length });
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(destination, bytes);
  return bytes;
}
async function verifiedJson(get, path) {
  const raw = await get(path.toLowerCase());
  const key = hash(path),
    rawCache = `${work}/${key}.bin`,
    jsonCache = `${work}/${key}.json`;
  if (
    !(await Bun.file(rawCache).exists()) ||
    !(await Bun.file(jsonCache).exists())
  ) {
    for (const [suffix, dest] of [
      ["", rawCache],
      [".json", jsonCache],
    ]) {
      const response = await fetch(
        `https://raw.communitydragon.org/16.21/game/${path.toLowerCase()}${suffix}`,
      );
      if (!response.ok)
        throw Error(`Asset metadata HTTP ${response.status}: ${path}${suffix}`);
      await Bun.write(dest, await response.arrayBuffer());
    }
  }
  if (hash(raw) !== hash(await Bun.file(rawCache).arrayBuffer()))
    throw Error(`CommunityDragon BIN differs from installed ${path}`);
  provenance.push({
    path,
    sha256: hash(raw),
    jsonSha256: hash(await Bun.file(jsonCache).arrayBuffer()),
    jsonSource: "CommunityDragon 16.21; raw BIN equals installed",
  });
  return Bun.file(jsonCache).json();
}
async function texture(get, path) {
  const key = hash(path.toLowerCase()).slice(0, 24),
    source = `${work}/${key}.texture`,
    output = `${out}/textures/${key}.png`;
  if (!textures[path.toLowerCase()]) {
    await extract(get, path, source);
    textures[path.toLowerCase()] = `textures/${key}.png`;
    if (!(await Bun.file(output).exists())) textureJobs[source] = output;
  }
  return textures[path.toLowerCase()];
}
await mkdir(`${out}/textures`, { recursive: true });
const mapGet = await openLocalWad(
  installation,
  "DATA/FINAL/Maps/Shipping/Map12.wad.client",
  decompress,
);
const mapPath = "data/maps/mapgeometry/map12/base";
const materials = await verifiedJson(mapGet, `${mapPath}.materials.bin`);
const container = materials["Maps/MapGeometry/Map12/Base"];
const navPath = container.components.find(
  (c) => c.__type === "MapNavGrid",
)?.NavGridPath;
// Field spelling belongs to the BIN schema; reject a missing path rather than assume SR.
if (!navPath)
  throw Error(
    `MapNavGrid fields: ${JSON.stringify(container.components.find((c) => c.__type === "MapNavGrid"))}`,
  );
const nav = Buffer.from(await mapGet(navPath.toLowerCase()));
if (nav[0] !== 7 || nav.readUInt16LE(1) !== 1)
  throw Error("Unsupported navigation grid");
const min = [3, 7, 11].map((p) => nav.readFloatLE(p)),
  max = [15, 19, 23].map((p) => nav.readFloatLE(p));
const nx = nav.readUInt32LE(31),
  nz = nav.readUInt32LE(35),
  sampleAt = 39 + nx * nz * 54 + 1056;
const hx = nav.readUInt32LE(sampleAt),
  hz = nav.readUInt32LE(sampleAt + 4);
const heightStep = [
  nav.readFloatLE(sampleAt + 8),
  nav.readFloatLE(sampleAt + 12),
];
if (
  hx < 2 ||
  hz < 2 ||
  sampleAt + 16 + hx * hz * 4 > nav.length ||
  !heightStep.every((v) => Number.isFinite(v) && v > 0)
)
  throw Error("Invalid height grid");
await Bun.write(
  `${out}/heights.bin`,
  nav.subarray(sampleAt + 16, sampleAt + 16 + hx * hz * 4),
);
await extract(mapGet, `${mapPath}.mapgeo`, `${work}/base.mapgeo`);
await command(["map", `${work}/base.mapgeo`, `${out}/map`]);
const description = await Bun.file(`${out}/map/map.json`).json(),
  bindings = {},
  unsupported = {};
for (const name of new Set(
  description.meshes.flatMap((m) => m.submeshes.map((s) => s.material)),
)) {
  const material = materials[name];
  if (!material) {
    if (!Object.hasOwn(request.omittedMapMaterials ?? {}, name))
      throw Error(`Missing map material ${name}`);
    unsupported[name] = {
      reason: request.omittedMapMaterials[name],
    };
    continue;
  }
  const sampler = material.samplerValues?.find((s) =>
    /^Diffuse_?Texture$/i.test(s.TextureName),
  );
  if (!sampler) {
    unsupported[name] = {
      reason: "No diffuse sampler; shader translation required",
      shader: material.techniques?.[0]?.passes?.[0]?.shader,
    };
    continue;
  }
  bindings[name] = {
    texture: "../" + (await texture(mapGet, sampler.texturePath)),
    shader: material.techniques?.[0]?.passes?.[0]?.shader,
    alphaTest:
      material.paramValues?.find((p) => p.name === "AlphaTestValue")
        ?.value?.[0] ?? 0,
    approximation: "Diffuse-only material",
  };
}
await Bun.write(
  `${out}/map/bindings.json`,
  JSON.stringify({ bindings, unsupported }),
);
async function prepareSkin(get, champion, skinId, dir) {
  if (
    !/^[A-Za-z0-9_]+$/.test(champion) ||
    !Number.isInteger(skinId) ||
    skinId < 0 ||
    skinId > 1000
  )
    throw Error("Invalid static skin request");
  const name = champion.toLowerCase(),
    key = `${name}/${skinId}`;
  await mkdir(`${dir}/animations`, { recursive: true });
  const skinJson = await verifiedJson(
    get,
    `data/characters/${name}/skins/skin${skinId}.bin`,
  );
  const skin =
    skinJson[`Characters/${champion}/Skins/Skin${skinId}`] ??
    Object.values(skinJson).find(
      (x) =>
        x.__type === "SkinCharacterDataProperties" &&
        x.championSkinName === `${champion}Skin${skinId}`,
    );
  if (!skin?.skinMeshProperties) throw Error(`Missing skin definition ${key}`);
  const mesh = skin.skinMeshProperties;
  await extract(get, mesh.simpleSkin, `${dir}/model.skn`);
  await extract(get, mesh.skeleton, `${dir}/model.skl`);
  await command(["skin-info", `${dir}/model.skn`, `${dir}/ranges.json`]);
  const ranges = await Bun.file(`${dir}/ranges.json`).json(),
    materialBindings = {},
    unsupportedMaterials = {};
  const hidden = (mesh.initialSubmeshToHide ?? "")
    .split(/[,\s]+/)
    .filter(Boolean);
  for (const range of ranges) {
    const override = mesh.materialOverride?.find(
      (x) => x.submesh?.toLowerCase() === range.toLowerCase(),
    );
    let path = override?.texture ?? mesh.texture;
    const materialName = override?.Material ?? mesh.Material;
    if (materialName && !override?.texture) {
      const material = skinJson[materialName];
      // Hecarim's scrolling shader uses Diffuse_Texture for a mask and
      // Main_Texture for albedo. This remains an explicitly approximate binding.
      const sampler =
        material?.samplerValues?.find((s) =>
          /^Main_?Texture$/i.test(s.TextureName),
        ) ??
        material?.samplerValues?.find((s) =>
          /^Diffuse_?Texture$/i.test(s.TextureName),
        );
      if (sampler) path = sampler.texturePath;
      else if (override?.Material) {
        unsupportedMaterials[range] = {
          material: materialName,
          reason: "Material shader has no decoded diffuse sampler",
        };
      }
    }
    if (!path) throw Error(`No skin texture ${key}/${range}`);
    const relative = await texture(get, path);
    materialBindings[range] = `../../../${relative}`;
  }
  await Bun.write(
    `${dir}/texture-bindings.json`,
    JSON.stringify(materialBindings),
  );
  await Bun.write(`${dir}/skin.json`, JSON.stringify(skinJson));
  return { skin, mesh, ranges, hidden, unsupportedMaterials };
}
async function prepareAnimations(get, skin, key, dir) {
  const graphName = skin.skinAnimationProperties?.animationGraphData;
  if (!graphName) throw Error(`Missing animation graph ${key}`);
  const graph = await verifiedJson(get, `data/${graphName.toLowerCase()}.bin`),
    atoms = Object.assign(
      {},
      ...Object.values(graph).map((g) => g.mClipDataMap ?? {}),
    ),
    selected = {},
    files = new Map();
  for (const [clip, value] of Object.entries(atoms)) {
    const path =
      value.mAnimationResourceData?.mAnimationFilePath?.toLowerCase();
    if (!path) continue;
    if (!files.has(path)) {
      const file = `animations/${files.size}.anm`;
      await extract(get, path, `${dir}/${file}`);
      files.set(path, file);
    }
    selected[clip] = files.get(path);
  }
  if (!Object.keys(selected).length)
    throw Error(`No atomic animation clips ${key}`);
  await Bun.write(`${dir}/selected-clips.json`, JSON.stringify(selected));
  await Bun.write(`${dir}/graph.json`, JSON.stringify(graph));
  const preview = (preferred, pattern) =>
    preferred.find((n) => Object.hasOwn(selected, n)) ??
    Object.keys(selected).find((n) =>
      pattern.test(atoms[n].mAnimationResourceData.mAnimationFilePath),
    );
  const previewClips = {
    idle: preview(["Idle1_Base", "Idle1"], /(?:^|[_/])idle1?\.anm$/i),
    run: preview(["Run_Base", "Run", "Run1"], /(?:^|[_/])run1?\.anm$/i),
    status:
      "Heuristic preview selection; full native graph/controller evaluation unresolved",
  };
  if (!previewClips.idle || !previewClips.run)
    throw Error(`Unsupported locomotion preview ${key}`);
  await Bun.write(
    `${dir}/runtime-clips.json`,
    JSON.stringify([...new Set([previewClips.idle, previewClips.run])]),
  );
  return { selected, previewClips };
}
async function prepareSpells(get, character, dir, recordPaths) {
  const name = character.toLowerCase(),
    data = await verifiedJson(get, `data/characters/${name}/${name}.bin`),
    byHash = new Map(),
    spells = {},
    byName = new Map(),
    records = {},
    loadedCharacters = new Set([name]),
    dependencyCharacters = [];
  for (const [path, value] of Object.entries(data)) {
    const key = metaHash(path);
    if (byHash.has(key)) throw Error(`Duplicate metadata object hash ${path}`);
    byHash.set(key, value);
  }
  const indexSpells = (definitions) => {
    for (const [path, value] of Object.entries(definitions)) {
      if (value.__type !== "SpellObject" || !value.mSpell) continue;
      const spellName = value.ObjectName ?? value.mScriptName;
      if (!spellName) throw Error(`Unnamed spell ${path}`);
      const hash = elfHash(spellName),
        definition = {
          name: spellName,
          path,
          hash,
          animation: value.mSpell.mAnimationName ?? "Attack1",
          animationDefaultSource: "LeagueToolkit SpellDataResource default",
          data: value.mSpell,
        };
      if (
        spells[hash] &&
        (spells[hash].name !== spellName ||
          JSON.stringify(spells[hash].data) !== JSON.stringify(definition.data))
      )
        throw Error(`Conflicting spell definition ${hash}/${spellName}`);
      spells[hash] = definition;
      byName.set(spellName.toLowerCase(), definition);
    }
  };
  indexSpells(data);
  for (const path of [...new Set(recordPaths)]) {
    const record = byHash.get(metaHash(path));
    if (record?.__type !== "CharacterRecord")
      throw Error(`Unresolved character record ${path}`);
    if (
      typeof record.mCharacterName !== "string" ||
      !/^[A-Za-z0-9_]+$/.test(record.mCharacterName)
    )
      throw Error(`Missing native default-attack name source ${path}`);
    const dependency = record.mCharacterName.toLowerCase();
    if (!loadedCharacters.has(dependency)) {
      const asset = `data/characters/${dependency}/${dependency}.bin`;
      if (!get.has(asset))
        throw Error(`Unprepared referenced attack-name namespace ${asset}`);
      indexSpells(await verifiedJson(get, asset));
      loadedCharacters.add(dependency);
      dependencyCharacters.push({
        character: record.mCharacterName,
        asset,
        reference: path,
      });
    }
    const attackSlots = {},
      unresolvedAttackSlots = {};
    for (let slot = 64; slot <= 81; slot++) {
      const source =
          slot === 64
            ? record.basicAttack
            : slot <= 72
              ? record.extraAttacks?.[slot - 65]
              : record.critAttacks?.[slot - 73],
        format = attackNaming.defaults[slot];
      if (
        !format ||
        ![
          "%sBasicAttack",
          "%sBasicAttack%i",
          "%sCritAttack",
          "%sCritAttack%i",
        ].includes(format.format) ||
        (format.format.includes("%i") && !Number.isInteger(format.number))
      )
        throw Error(`Unprepared default attack-name slot ${slot}`);
      const implicit = format.format
          .replace("%s", record.mCharacterName)
          .replace("%i", String(format.number)),
        spellName = source?.mAttackName ?? implicit,
        definition = byName.get(spellName.toLowerCase());
      if (definition)
        attackSlots[slot] = {
          ...definition,
          attackData: source ?? null,
          implicitName: !source?.mAttackName,
        };
      else unresolvedAttackSlots[slot] = `Unresolved attack spell ${spellName}`;
    }
    records[path] = { attackSlots, unresolvedAttackSlots, data: record };
  }
  const catalog = {
    schema: 2,
    character,
    spells,
    records,
    dependencyCharacters,
    defaultAttackNaming: {
      sha256: decoderProfile.attackNamingSha256,
      entryRva: attackNaming.entryRva,
      sourceSliceSha256: attackNaming.sliceSha256,
      recordNameField: "mCharacterName",
    },
    limitations: [
      "Runtime spell replacement, skin gear and form state unresolved",
      "Static record variants remain distinct; presentation binds only agreeing spell/animation identities",
      "Default names come from original formatter selection; enabled-slot and runtime variant state remain separate",
    ],
  };
  await Bun.write(`${dir}/spells.json`, JSON.stringify(catalog));
  return catalog;
}
let champions = {};
if (reuseArg) {
  const previous = await Bun.file(`${out}/manifest.json`).json();
  if (
    previous.build !== request.build ||
    previous.protocol !== "20e09df23c66b85e" ||
    previous.toolchain.leagueToolkitRevision !== toolkitRevision ||
    previous.toolchain.exporterSha256 !==
      hash(await Bun.file(exporter).arrayBuffer()) ||
    previous.toolchain.attackNamingSha256 !==
      decoderProfile.attackNamingSha256 ||
    previous.toolchain.preparerSha256 !== preparerSha256
  )
    throw Error(
      "Cannot reuse champions from a different asset toolchain/build",
    );
  const requested = request.champions
    .map((x) => `${x.champion.toLowerCase()}/${x.skinId}`)
    .sort();
  if (
    JSON.stringify(requested) !==
    JSON.stringify(Object.keys(previous.champions).sort())
  )
    throw Error("Reused champion package differs from static request");
  champions = previous.champions;
  provenance.push(...previous.provenance);
}
for (const entry of reuseArg ? [] : request.champions) {
  const { champion, skinId } = entry,
    name = champion.toLowerCase(),
    key = `${name}/${skinId}`,
    dir = `${out}/champions/${key}`;
  const get = await openLocalWad(
    installation,
    `DATA/FINAL/Champions/${name}.wad.client`,
    decompress,
  );
  const { skin, mesh, ranges, hidden, unsupportedMaterials } =
    await prepareSkin(get, champion, skinId, dir);
  const characterRecords = [`Characters/${champion}/CharacterRecords/Root`];
  await prepareSpells(get, champion, dir, characterRecords);
  const { selected, previewClips } = await prepareAnimations(
    get,
    skin,
    key,
    dir,
  );
  champions[key] = {
    champion,
    skinId,
    model: `champions/${key}/model.glb`,
    scale: mesh.skinScale ?? 1,
    hidden,
    unsupportedMaterials,
    clips: Object.keys(selected),
    previewClips,
    animationGraph: `champions/${key}/graph.json`,
    animationCatalog: `champions/${key}/animation-catalog.json`,
    skinDefinition: `champions/${key}/skin.json`,
    spellCatalog: `champions/${key}/spells.json`,
    characterRecords,
    shaderStatus:
      "Diffuse textures; material shaders and graph evaluation incomplete",
  };
  console.log(
    `Prepared ${key}: ${ranges.length} material ranges, ${Object.keys(selected).length} atomic clips`,
  );
}
// Static map catalog only. Network IDs and match existence come from browser decoding.
const worldObjects = {},
  worldAssets = {},
  registration = [];
const mapDefinition = await verifiedJson(
  mapGet,
  "data/maps/shipping/map12/map12.bin",
);
for (const chunk of Object.values(container.chunks)) {
  if (!materials[chunk]) throw Error(`Unresolved static map chunk ${chunk}`);
  for (const [objectKey, item] of Object.entries(
    materials[chunk].items ?? {},
  ).filter(([, item]) => item)) {
    if (item.AttackableUnit || item.Barracks) {
      if (
        !/^\{[a-f0-9]{8}\}$/i.test(objectKey) ||
        !/^\{[a-f0-9]{8}\}$/i.test(item.name)
      )
        throw Error("Invalid static registry key/name");
      const entry = {
        objectKey,
        keyHash: Number.parseInt(objectKey.slice(1, -1), 16),
        mapNameHash: Number.parseInt(item.name.slice(1, -1), 16),
        sourceChunk: chunk,
        kind: item.Barracks ? "barracks" : "building",
        transform: item.transform,
        units: {},
      };
      if (item.Barracks) {
        const configs = [
          item.Barracks.BarracksConfig,
          ...Object.values(item.Barracks["{45403ae3}"] ?? {}),
        ];
        entry.configs = [...new Set(configs)];
        for (const configKey of entry.configs) {
          const config = mapDefinition[configKey];
          if (config?.__type !== "BarracksConfig")
            throw Error(`Unresolved barracks config ${configKey}`);
          for (const unit of config.units) {
            const placeable = mapDefinition[unit["{fee040bc}"]],
              match = /^Characters\/([A-Za-z0-9_]+)\/Skins\/Skin(\d+)$/.exec(
                placeable?.Character?.Skin ?? "",
              );
            if (!match) throw Error("Missing barracks unit skin definition");
            const character = match[1],
              skinId = Number(match[2]),
              key = `${character.toLowerCase()}/${skinId}`;
            if (
              entry.units[unit.MinionType] &&
              entry.units[unit.MinionType].asset !== key
            )
              throw Error(
                `Mode-dependent minion model requires explicit ruleset: ${objectKey}/${unit.MinionType}`,
              );
            entry.units[unit.MinionType] ??= { asset: key, records: [] };
            entry.units[unit.MinionType].records.push({
              config: configKey,
              characterRecord: placeable.Character.CharacterRecord,
            });
            if (worldAssets[key]) continue;
            const dir = `${out}/world/${key}`,
              { skin, mesh, hidden, unsupportedMaterials } = await prepareSkin(
                mapGet,
                character,
                skinId,
                dir,
              ),
              { selected, previewClips } = await prepareAnimations(
                mapGet,
                skin,
                key,
                dir,
              );
            worldAssets[key] = {
              character,
              skinId,
              model: `world/${key}/model.glb`,
              scale: mesh.skinScale ?? 1,
              hidden,
              unsupportedMaterials,
              clips: Object.keys(selected),
              previewClips,
              animationGraph: `world/${key}/graph.json`,
              animationCatalog: `world/${key}/animation-catalog.json`,
              skinDefinition: `world/${key}/skin.json`,
              poseStatus:
                "Heuristic locomotion and death preview; action/lifecycle fidelity unresolved",
              shaderStatus:
                "Diffuse approximation; material shaders unresolved",
            };
          }
        }
      }
      registration.push(entry);
    }
    if (item.AttackableUnit?.type !== 0) continue;
    const match = /^Characters\/(Turret)\/Skins\/Skin(\d+)$/.exec(
      item.Character?.Skin ?? "",
    );
    if (!match) throw Error(`Unsupported turret skin ${item.Character?.Skin}`);
    if (!/^\{[a-f0-9]{8}\}$/i.test(item.name))
      throw Error("Turret has no static map name hash");
    const mapNameHash = Number.parseInt(item.name.slice(1, -1), 16),
      key = `turret/${Number(match[2])}`;
    if (worldObjects[mapNameHash])
      throw Error(`Duplicate turret map hash ${item.name}`);
    if (
      !Array.isArray(item.transform) ||
      item.transform.length !== 4 ||
      item.transform.some(
        (row) => row.length !== 4 || !row.every(Number.isFinite),
      )
    )
      throw Error("Invalid static turret transform");
    worldObjects[mapNameHash] = {
      mapNameHash,
      asset: key,
      transform: item.transform,
      characterRecord: item.Character.CharacterRecord,
      explicitTeam: item.Team?.Team ?? null,
      sourceChunk: chunk,
      sourceName: item.name,
    };
    if (worldAssets[key]) continue;
    const skinId = Number(match[2]),
      dir = `${out}/world/${key}`;
    const { mesh, hidden, unsupportedMaterials } = await prepareSkin(
      mapGet,
      "Turret",
      skinId,
      dir,
    );
    await Bun.write(`${dir}/selected-clips.json`, "{}");
    await Bun.write(`${dir}/runtime-clips.json`, "[]");
    worldAssets[key] = {
      character: "Turret",
      skinId,
      model: `world/${key}/model.glb`,
      skinDefinition: `world/${key}/skin.json`,
      scale: mesh.skinScale ?? 1,
      hidden,
      unsupportedMaterials,
      poseStatus:
        "Skeleton bind pose; building animation/controller not implemented",
      shaderStatus:
        "Diffuse approximation; particles, lighting and material shaders unresolved",
    };
  }
}
if (!Object.keys(worldObjects).length)
  throw Error("Static map has no turret objects");
for (const [key, asset] of Object.entries(worldAssets)) {
  if (!asset.animationCatalog) continue;
  const records = new Set(
    registration.flatMap((entry) =>
      Object.values(entry.units)
        .filter((unit) => unit.asset === key)
        .flatMap((unit) => unit.records.map((r) => r.characterRecord)),
    ),
  );
  if (!records.size)
    throw Error(`Missing static minion character records ${key}`);
  await prepareSpells(mapGet, asset.character, `${out}/world/${key}`, [
    ...records,
  ]);
  asset.spellCatalog = `world/${key}/spells.json`;
  asset.characterRecords = [...records];
}
await Bun.write(
  `${out}/world.json`,
  JSON.stringify(
    {
      schema: 1,
      build: request.build,
      protocol: "20e09df23c66b85e",
      mapId: request.mapId,
      objects: worldObjects,
      assets: worldAssets,
      registration: registration.sort((a, b) => a.keyHash - b.keyHash),
      registrationStatus:
        "Candidate ascending placeable-key order; runtime requires a consistent offset from every recorded tower anchor",
      limitations: [
        "Map catalog alone does not create match entities; only decoded building identities are admitted",
        "Destruction, rubble, health, visibility, attacks and building animation unresolved",
        "Full map transform applied as a candidate; compare native reference before claiming placement fidelity",
        "Minion registry order is inferred from tower anchors; native initializer and unseen matches remain unverified",
        "Minion model agreement across configs does not establish mode/character-stat selection",
        "Minion attack timing/random variants, missile effects, death variants, corpse fade/removal and visibility unresolved",
      ],
    },
    null,
    2,
  ),
);
await Bun.write(`${work}/texture-jobs.json`, JSON.stringify(textureJobs));
if (Object.keys(textureJobs).length)
  await command(["textures", `${work}/texture-jobs.json`]);
for (const key of reuseArg ? [] : Object.keys(champions))
  await command([
    "champion",
    `${out}/champions/${key}`,
    `${out}/champions/${key}/runtime-clips.json`,
  ]);
for (const key of reuseArg ? [] : Object.keys(champions))
  await command(["animation-pack", `${out}/champions/${key}`]);
for (const key of Object.keys(worldAssets))
  await command([
    "champion",
    `${out}/world/${key}`,
    `${out}/world/${key}/runtime-clips.json`,
  ]);
for (const key of Object.keys(worldAssets).filter(
  (key) => worldAssets[key].animationCatalog,
))
  await command(["animation-pack", `${out}/world/${key}`]);
const manifest = {
  schema: 1,
  build: request.build,
  protocol: "20e09df23c66b85e",
  toolchain: {
    leagueToolkitRevision: toolkitRevision,
    exporterSha256: hash(await Bun.file(exporter).arrayBuffer()),
    attackNamingSha256: decoderProfile.attackNamingSha256,
    preparerSha256,
  },
  map: {
    id: 12,
    variant: "base",
    selection:
      "Explicit research request; map variant is not decoded from replay",
    navPath,
    min,
    max,
    heightGrid: { x: hx, z: hz, step: heightStep, sourceSha256: hash(nav) },
    movementOrigin: latestMovementOrigin(min, max),
    originStatus:
      "Exact-build float32 sum, integer truncation and signed16 division from navgrid bounds; source RVA 0x16b6f6c..0x16b6fc9",
    bindings: "map/bindings.json",
  },
  champions,
  world: "world.json",
  provenance: [
    ...new Map(
      provenance.map((entry) => [JSON.stringify(entry), entry]),
    ).values(),
  ],
  limitations: [
    "Map and equipped skin selection still candidate semantics",
    "Initial submesh visibility only; skin gear/form changes not reconstructed",
    "Atomic clips sampled at source FPS; graph interpretation partial and graph event triggers unused",
    "Map/champion diffuse shaders approximate; combat timing candidate; damage, projectiles, particles, audio and visibility absent",
  ],
};
await Bun.write(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(
  `Static package complete: ${Object.keys(champions).length} champion skins; ${Object.keys(worldAssets).length} world skins; ${registration.length} map registration candidates; ${Object.keys(bindings).length} diffuse map materials; ${Object.keys(unsupported).length} explicitly unsupported`,
);
