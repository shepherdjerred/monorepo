// Offline static asset preparation; never reads a replay.
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { openWad } from "./wad.mjs";
const research = resolve(process.argv[2]),
  cache = resolve(process.argv[3] ?? ".cache/replay-spike"),
  out = `${cache}/public`;
const tools = dirname(fileURLToPath(import.meta.url));
const { parseRman } = await import(
  pathToFileURL(`${research}/lol-exe-downloader/src/rman.js`)
);
const { decompress } = await import(
  pathToFileURL(
    `${research}/lol-exe-downloader/node_modules/fzstd/esm/index.mjs`,
  )
);
const manifestBytes = new Uint8Array(
  await Bun.file(`${cache}/client.manifest`).arrayBuffer(),
);
if (
  new Bun.CryptoHasher("sha256").update(manifestBytes).digest("hex") !==
  "5b3441fb36ba7ed35db43682507db5a8126a2c35bc35d1f4c568dc9c60a836ea"
)
  throw Error("Manifest mismatch");
const manifest = parseRman(manifestBytes),
  cd = "https://raw.communitydragon.org/16.14/game/";
async function get(path, file) {
  await mkdir(dirname(file), { recursive: true });
  if (!(await Bun.file(file).exists())) {
    const r = await fetch(cd + path.toLowerCase());
    if (!r.ok) throw Error(`${r.status}: ${path}`);
    await Bun.write(file, await r.arrayBuffer());
  }
  return Bun.file(file);
}
const mapWad = await openWad(
  manifest,
  "DATA/FINAL/Maps/Shipping/Map11.wad.client",
  cache,
  decompress,
);
const lineup = await Bun.file(`${tools}/lineup.json`).json();
const map = await (
  await get(
    "data/maps/mapgeometry/map11/base_srx.materials.bin.json",
    `${cache}/base_srx.materials.json`,
  )
).json();
const structures = [];
for (const container of Object.values(map))
  for (const item of Object.values(container?.items ?? {})) {
    if (
      !item?.Character ||
      !/Characters\/(Turret|Nexus|Inhibitor)\//.test(item.Character.Skin)
    )
      continue;
    structures.push({
      nameHash: item.name,
      transform: item.transform,
      skin: item.Character.Skin,
      team: item.Team?.Team ?? 100,
      lane: item["{2092043f}"]?.LaneDefinition,
    });
  }
await Bun.write(`${out}/structures.json`, JSON.stringify(structures));
const units = [
  ...new Set([
    ...["Order", "Chaos"].flatMap((team) =>
      ["Melee", "Ranged", "Siege", "Super"].map(
        (type) => `Characters/SRU_${team}Minion${type}/Skins/Skin0`,
      ),
    ),
    ...[
      "SRU_Red",
      "SRU_Blue",
      "SRU_Gromp",
      "SRU_Murkwolf",
      "SRU_MurkwolfMini",
      "SRU_Razorbeak",
      "SRU_RazorbeakMini",
      "SRU_Krug",
      "SRU_KrugMini",
      "SRU_KrugMiniMini",
      "Sru_Crab",
      "SRU_Horde",
      "SRU_Horde_Mini",
      "SRU_RiftHerald",
      "SRU_Dragon_Hextech",
      "SRU_Dragon_Water",
      "SRU_Dragon_Chemtech",
      "SRU_Baron",
      "YellowTrinket",
      "SightWard",
      "JammerDevice",
      "BlueTrinket",
      "SRU_Plant_Vision",
      "SRU_Plant_Satchel",
      "SRU_Plant_Health",
      "BelvethVoidling",
      "BelvethSpore",
      "ShenSpirit",
      "SRU_RiftHerald_Mercenary",
    ].map((name) => `Characters/${name}/Skins/Skin0`),
    ...structures.map((s) => s.skin),
  ]),
];
const registry = {};
function atomsOf(graph) {
  return Object.assign(
    {},
    ...Object.values(graph).map((g) => g?.mClipDataMap ?? {}),
  );
}
function resolveClip(atoms, name, visited = new Set()) {
  if (visited.has(name)) throw Error(`Cyclic animation graph ${name}`);
  const v = atoms[name];
  if (!v) return [];
  if (v.mAnimationResourceData?.mAnimationFilePath) return [name];
  visited = new Set(visited).add(name);
  const names = [];
  function walk(x) {
    if (!x || typeof x !== "object") return;
    for (const [k, v] of Object.entries(x)) {
      if (k === "mClipName" && typeof v === "string")
        names.push(...resolveClip(atoms, v, visited));
      else if (k === "mClipNameList")
        for (const name of v) names.push(...resolveClip(atoms, name, visited));
      else if (typeof v === "object") walk(v);
    }
  }
  walk(v);
  return [...new Set(names)];
}
async function exportAsset(key, skinPath, dir, extract, existing) {
  const config = await (
    await get(`data/${skinPath}.bin.json`, `${dir}/skin.json`)
  ).json();
  const skin = Object.entries(config).find(
    ([k]) => k.toLowerCase() === skinPath.toLowerCase(),
  )?.[1];
  if (!skin?.skinMeshProperties)
    throw Error(`Missing skin properties ${skinPath}`);
  const properties = skin.skinMeshProperties;
  for (const [path, name] of [
    [properties.simpleSkin, "model.skn"],
    [properties.skeleton, "model.skl"],
  ]) {
    if (!path) throw Error(`Missing mesh path ${skinPath}`);
    if (!(await Bun.file(`${dir}/${name}`).exists()))
      await Bun.write(`${dir}/${name}`, await extract(path.toLowerCase()));
  }
  if (!existing)
    await get(
      properties.texture.replace(/\.(tex|dds)$/i, ".png"),
      `${dir}/texture.png`,
    );
  const graphPath = skin.skinAnimationProperties?.animationGraphData;
  let atoms = {};
  if (graphPath)
    atoms = atomsOf(
      await (
        await get(`data/${graphPath}.bin.json`, `${dir}/graph.json`)
      ).json(),
    );
  const semantic = {};
  const requested = {
    idle: ["Idle1", "Idle", "Idle1_Base"],
    run: ["Run", "Run1", "Run_Base"],
    attack: ["Attack1", "Attack2", "Attack"],
    death: ["Death"],
    spell1: ["Spell1"],
    spell2: ["Spell2"],
    spell3: ["Spell3"],
    spell4: ["Spell4"],
  };
  for (const [k, names] of Object.entries(requested))
    semantic[k] = [
      ...new Set(names.flatMap((name) => resolveClip(atoms, name))),
    ];
  if (key === "belveth") semantic.attack = ["Attack_Slow1a", "Attack_Slow2a"];
  if (existing) {
    semantic.idle = [existing.locomotion.idle];
    semantic.run = [existing.locomotion.run];
  }
  // Explicit graph approximations: selectors have no reconstructed runtime parameters yet.
  const selected = {},
    files = new Map();
  for (const name of new Set([
    ...(existing?.clips ?? []),
    ...Object.values(semantic).flat(),
  ])) {
    const path =
      atoms[name]?.mAnimationResourceData?.mAnimationFilePath?.toLowerCase();
    if (!path) throw Error(`Missing atomic clip ${key}/${name}`);
    if (!files.has(path)) {
      const file = `animations/combat-${files.size}.anm`;
      await mkdir(`${dir}/animations`, { recursive: true });
      await Bun.write(`${dir}/${file}`, await extract(path));
      files.set(path, file);
    }
    selected[name] = files.get(path);
  }
  await Bun.write(`${dir}/selected-clips.json`, JSON.stringify(selected));
  await Bun.write(
    `${dir}/combat.json`,
    JSON.stringify({
      semantic,
      scale: properties.skinScale ?? 1,
      graphSelection:
        "deterministic approximation; selector conditions and blends not reconstructed",
    }),
  );
  const process = Bun.spawn(
    [
      "dotnet",
      `${cache}/exporter-build/bin/Debug/net10.0/Exporter.dll`,
      "champion",
      dir,
    ],
    { cwd: research, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, status] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (status) throw Error(`${key}: ${stdout}\n${stderr}`);
  console.log(stdout.trim());
  registry[skinPath.toLowerCase()] = {
    key,
    scale: properties.skinScale ?? 1,
    semantic,
  };
}
for (const [key, config] of Object.entries(lineup)) {
  const extract = await openWad(
    manifest,
    `DATA/FINAL/Champions/${key}.wad.client`,
    cache,
    decompress,
  );
  // Graph and texture files were prepared by prepare.mjs; properties add skin scale.
  await exportAsset(
    key,
    `Characters/${key}/Skins/Skin0`,
    `${out}/champions/${key}`,
    extract,
    config,
  );
}
for (const skinPath of units) {
  const key =
    skinPath.split("/")[1].toLowerCase() +
    "-" +
    skinPath.split("/").at(-1).toLowerCase();
  const champion = key.startsWith("belveth")
    ? "belveth"
    : key.startsWith("shen")
      ? "shen"
      : null;
  const extract = champion
    ? await openWad(
        manifest,
        `DATA/FINAL/Champions/${champion}.wad.client`,
        cache,
        decompress,
      )
    : mapWad;
  await exportAsset(key, skinPath, `${out}/units/${key}`, extract);
}
await Bun.write(`${out}/units/registry.json`, JSON.stringify(registry));
