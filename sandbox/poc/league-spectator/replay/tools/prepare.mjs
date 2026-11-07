// Static build package only. Does not open a replay or launch the game.
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { openWad } from "./wad.mjs";
import { prepareThreeUniformBindings } from "./prepare-three-uniform-bindings.mjs";
const tools = dirname(fileURLToPath(import.meta.url));
if (!process.argv[2])
  throw Error("Usage: bun tools/prepare.mjs <research-root> [cache-root]");
const research = resolve(process.argv[2]),
  cache = resolve(process.argv[3] ?? ".cache/replay-spike"),
  out = `${cache}/public`;
const pins = {
  "lol-exe-downloader": "29cc02033e9710b281ddaf85c240dfb63da1026b",
  "league-toolkit-cs": "76bf57bf4fd195343dec610bf0f912a06b910914",
};
for (const [repo, pin] of Object.entries(pins)) {
  const result = Bun.spawnSync([
    "git",
    "-C",
    `${research}/${repo}`,
    "rev-parse",
    "HEAD",
  ]);
  if (result.exitCode || result.stdout.toString().trim() !== pin)
    throw Error(`Expected ${repo} at ${pin}`);
}
const { parseRman } = await import(
  pathToFileURL(`${research}/lol-exe-downloader/src/rman.js`).href
);
const { decompress } = await import(
  pathToFileURL(
    `${research}/lol-exe-downloader/node_modules/fzstd/esm/index.mjs`,
  ).href
);
const provenance = [];
async function get(url, path) {
  await mkdir(dirname(path), { recursive: true });
  const file = Bun.file(path);
  if (!(await file.exists())) {
    const response = await fetch(url);
    if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
    await Bun.write(file, await response.arrayBuffer());
  }
  const data = new Uint8Array(await file.arrayBuffer());
  provenance.push({
    url,
    file: path.slice(cache.length + 1),
    sha256: new Bun.CryptoHasher("sha256").update(data).digest("hex"),
  });
  return data;
}
async function command(args) {
  const p = Bun.spawn(args, { cwd: research, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (status) throw Error(`${args[0]} failed:\n${stdout}\n${stderr}`);
  return stdout;
}
const manifestBytes = await get(
  "https://lol.secure.dyn.riotcdn.net/channels/public/releases/952B478DFC66B0AB.manifest",
  `${cache}/client.manifest`,
);
if (
  new Bun.CryptoHasher("sha256").update(manifestBytes).digest("hex") !==
  "5b3441fb36ba7ed35db43682507db5a8126a2c35bc35d1f4c568dc9c60a836ea"
)
  throw Error("Release manifest hash mismatch");
const manifest = parseRman(manifestBytes);
for (const [url, path] of [
  ["build/three.module.js", "vendor/three.module.js"],
  ["build/three.core.js", "vendor/three.core.js"],
  ["examples/jsm/controls/OrbitControls.js", "vendor/OrbitControls.js"],
  ["examples/jsm/loaders/GLTFLoader.js", "vendor/GLTFLoader.js"],
  ["examples/jsm/utils/BufferGeometryUtils.js", "utils/BufferGeometryUtils.js"],
  ["examples/jsm/utils/SkeletonUtils.js", "utils/SkeletonUtils.js"],
])
  await get(
    `https://unpkg.com/three@0.185.1/${url}`,
    `${out}/${path === "vendor/three.module.js" ? "vendor/three.module.upstream.js" : path}`,
  );
const rendererPolicy = await prepareThreeUniformBindings(cache);
provenance.push({
  producer: "three-uniform-bindings.mjs",
  policy: rendererPolicy.policy,
  file: `public/${rendererPolicy.derived.file}`,
  sha256: rendererPolicy.derived.sha256,
  upstreamSha256: rendererPolicy.upstream.sha256,
});
await get(
  "https://unpkg.com/fzstd@0.1.1/esm/index.mjs",
  `${out}/vendor/fzstd.mjs`,
);
const build = `${cache}/exporter-build`;
await mkdir(build, { recursive: true });
// Keep generated .NET output outside source and the workspace SDK pin.
for (const name of ["Program.cs", "Exporter.csproj"])
  await Bun.write(
    `${build}/${name}`,
    await Bun.file(`${tools}/exporter/${name}`).text(),
  );
console.log("Building offline asset exporter");
await command([
  "dotnet",
  "build",
  `${build}/Exporter.csproj`,
  `-p:LeagueToolkitRoot=${research}/league-toolkit-cs`,
  "-v",
  "quiet",
]);
const exporter = `${build}/bin/Debug/net10.0/Exporter.dll`;
const mapWad = await openWad(
  manifest,
  "DATA/FINAL/Maps/Shipping/Map11.wad.client",
  cache,
  decompress,
);
await Bun.write(
  `${cache}/base.mapgeo`,
  await mapWad("data/maps/mapgeometry/map11/base.mapgeo"),
);
console.log(
  (
    await command([
      "dotnet",
      exporter,
      "map",
      `${cache}/base.mapgeo`,
      `${out}/map`,
    ])
  ).trim(),
);
const cd = "https://raw.communitydragon.org/16.14/game/";
const materials = JSON.parse(
  new TextDecoder().decode(
    await get(
      `${cd}data/maps/mapgeometry/map11/base.materials.bin.json`,
      `${out}/map/materials.json`,
    ),
  ),
);
const description = await Bun.file(`${out}/map/map.json`).json();
const textures = new Map(),
  bindings = {};
for (const name of new Set(
  description.meshes.flatMap((m) => m.submeshes.map((s) => s.material)),
)) {
  const material = materials[name],
    sampler = material?.samplerValues?.find((s) =>
      /^Diffuse_?Texture$/i.test(s.TextureName),
    );
  if (!sampler) throw Error(`Missing diffuse map sampler ${name}`);
  const path = sampler.texturePath
    .toLowerCase()
    .replace(/\.(tex|dds)$/i, ".png");
  if (!textures.has(path)) textures.set(path, `texture-${textures.size}.png`);
  bindings[name] = {
    texture: textures.get(path),
    source: path,
    shader: material.techniques?.[0]?.passes?.[0]?.shader,
  };
}
for (const [path, name] of textures)
  await get(`${cd}${path}`, `${out}/map/${name}`);
await Bun.write(`${out}/map/bindings.json`, JSON.stringify({ bindings }));
const skins = {
  ksante: ["ksante_base", "ksante_base_tx_cm"],
  belveth: ["belveth_base", "belveth_base_main_tx"],
  katarina: ["katarina", "katarina_base_2012_tx_cm"],
  drmundo: ["drmundo_base", "drmundo_base_tx_cm"],
  shen: ["shen", "shen_base_tx_cm"],
  vayne: ["vayne", "vayne_base_tx_cm"],
  talon: ["talon", "talon_base_tx_cm"],
  ryze: ["ryze", "ryze"],
  sylas: ["sylas_base", "sylas_base_tx_cm"],
  nautilus: ["nautilus", "nautilus_base_tx_cm"],
};
const lineup = await Bun.file(`${tools}/lineup.json`).json();
for (const [champion, config] of Object.entries(lineup)) {
  const dir = `${out}/champions/${champion}`,
    base = `assets/characters/${champion}/skins/base/`;
  await mkdir(`${dir}/animations`, { recursive: true });
  const extract = await openWad(
    manifest,
    `DATA/FINAL/Champions/${champion}.wad.client`,
    cache,
    decompress,
  );
  const [model, texture] = skins[champion];
  for (const extension of ["skn", "skl"])
    await Bun.write(
      `${dir}/model.${extension}`,
      await extract(`${base}${model}.${extension}`),
    );
  await get(`${cd}${base}${texture}.png`, `${dir}/texture.png`);
  const graph = JSON.parse(
    new TextDecoder().decode(
      await get(
        `${cd}data/characters/${champion}/animations/skin0.bin.json`,
        `${dir}/graph.json`,
      ),
    ),
  );
  const atoms = Object.assign(
      {},
      ...Object.values(graph).map((g) => g.mClipDataMap || {}),
    ),
    selected = {},
    files = new Map();
  for (const name of config.clips) {
    const path =
      atoms[name]?.mAnimationResourceData?.mAnimationFilePath?.toLowerCase();
    if (!path) throw Error(`Missing atomic clip ${champion}/${name}`);
    if (!files.has(path)) {
      const filename = `animations/selected-${files.size}.anm`;
      await Bun.write(`${dir}/${filename}`, await extract(path));
      files.set(path, filename);
    }
    selected[name] = files.get(path);
  }
  await Bun.write(`${dir}/selected-clips.json`, JSON.stringify(selected));
  await Bun.write(`${dir}/locomotion.json`, JSON.stringify(config.locomotion));
  console.log((await command(["dotnet", exporter, "champion", dir])).trim());
}
await Bun.write(
  `${out}/provenance.json`,
  JSON.stringify(
    {
      build: "16.14.794.5912",
      pins,
      provenance,
      limitations: [
        "CommunityDragon textures and graph descriptions are patch-level 16.14, not executable-hash pinned",
        "Base geometry variant; diffuse materials; one main texture per champion",
      ],
    },
    null,
    2,
  ),
);
console.log(`Static assets ready: ${out}`);
