import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { openWad } from "./wad.mjs";
const research = resolve(process.argv[2]),
  cache = resolve(process.argv[3] ?? ".cache/replay-spike"),
  python = process.argv[4] ?? "python";
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
const manifest = parseRman(manifestBytes);
const wad = await openWad(
  manifest,
  "DATA/FINAL/Maps/Shipping/Map11.wad.client",
  cache,
  decompress,
);
const out = `${cache}/public/map-srx`,
  source = `${cache}/base_srx.mapgeo`;
await Bun.write(
  source,
  await wad("data/maps/mapgeometry/map11/base_srx.mapgeo"),
);
const child = Bun.spawn(
  [
    "dotnet",
    `${cache}/exporter-build/bin/Debug/net10.0/Exporter.dll`,
    "map",
    source,
    out,
  ],
  { cwd: research, stdout: "inherit", stderr: "inherit" },
);
if (await child.exited) throw Error("SRX export failed");
const materialFile = `${cache}/base_srx.materials.json`;
if (!(await Bun.file(materialFile).exists())) {
  const r = await fetch(
    "https://raw.communitydragon.org/16.14/game/data/maps/mapgeometry/map11/base_srx.materials.bin.json",
  );
  if (!r.ok) throw Error(r.status);
  await Bun.write(materialFile, await r.arrayBuffer());
}
const materials = await Bun.file(materialFile).json(),
  description = await Bun.file(`${out}/map.json`).json();
const bindings = {},
  unsupported = {};
for (const name of new Set(
  description.meshes.flatMap((m) => m.submeshes.map((s) => s.material)),
)) {
  const material = materials[name];
  if (!material) throw Error(`Missing material ${name}`);
  const shader = material.techniques?.[0]?.passes?.[0]?.shader;
  const sampler = material.samplerValues?.find((s) =>
    /^Diffuse_?Texture$/i.test(s.TextureName),
  );
  if (shader === "Shaders/StaticMesh/Indicator_Faelights") {
    unsupported[name] = "Procedural faelight indicator shader not implemented";
    continue;
  }
  if (!sampler) throw Error(`Missing diffuse sampler ${name}`);
  const path = sampler.texturePath
    .toLowerCase()
    .replace(/\.(tex|dds)$/i, ".png");
  const file =
    new Bun.CryptoHasher("sha256").update(path).digest("hex").slice(0, 20) +
    ".png";
  if (!(await Bun.file(`${out}/${file}`).exists())) {
    const r = await fetch("https://raw.communitydragon.org/16.14/game/" + path);
    if (!r.ok) throw Error(`${r.status}: ${path}`);
    await Bun.write(`${out}/${file}`, await r.arrayBuffer());
  }
  bindings[name] = {
    texture: file,
    source: path,
    shader,
    alphaTest:
      material.paramValues?.find((p) => p.name === "AlphaTestValue")
        ?.value[0] ?? 0,
    approximation:
      "Diffuse sampler with asset alpha threshold; material shader, depth fog and dynamic effects incomplete",
  };
}
await Bun.write(
  `${out}/bindings.json`,
  JSON.stringify({
    build: "16.14.794.5912",
    source: "Default SRX map asset; match variant unverified",
    bindings,
    unsupported,
  }),
);
console.log(
  `Prepared ${Object.keys(bindings).length} SRX materials; ${Object.keys(unsupported).length} explicitly unsupported`,
);
