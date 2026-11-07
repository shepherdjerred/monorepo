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
const lineup = await Bun.file(
  `${dirname(fileURLToPath(import.meta.url))}/lineup.json`,
).json();
const wads = new Map();
for (const champion of Object.keys(lineup)) {
  const wad = await openWad(
    manifest,
    `DATA/FINAL/Champions/${champion}.wad.client`,
    cache,
    decompress,
  );
  wads.set(champion, wad);
  const folder = `${cache}/vfx/champions/${champion}`;
  const skin = await Bun.file(
    `${cache}/public/champions/${champion}/skin.json`,
  ).json();
  await Bun.write(`${folder}/skin.json`, JSON.stringify(skin));
  for (const [i, path] of [
    `data/characters/${champion}/${champion}.bin`,
    ...skin.__linked.filter((p) => p.includes("_Multi_")),
  ].entries()) {
    const file = `${folder}/${i}.bin`;
    if (!(await Bun.file(file).exists()))
      await Bun.write(file, await wad(path));
  }
  const own = `${folder}/skin.bin`;
  if (!(await Bun.file(own).exists()))
    await Bun.write(
      own,
      await wad(`data/characters/${champion}/skins/skin0.bin`),
    );
  console.log(`Extracted ${champion} static spell package`);
}
for (const name of ["binfields", "bintypes", "game"]) {
  const path =
    name === "game"
      ? `${cache}/hashes.game.txt`
      : `${cache}/vfx/hashes.${name}.txt`;
  if (await Bun.file(path).exists()) continue;
  const r = await fetch(
    `https://raw.communitydragon.org/data/hashes/lol/hashes.${name}.txt`,
  );
  if (!r.ok) throw Error(r.status);
  await Bun.write(path, await r.text());
}
const child = Bun.spawn(
  [
    python,
    `${dirname(fileURLToPath(import.meta.url))}/export-spell-effects.py`,
    cache,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (await child.exited) throw Error("VFX definition export failed");
const pack = await Bun.file(`${cache}/public/effects/package.json`).json();
const textureFiles = new Map(),
  meshFiles = new Map();
for (const effect of Object.values(pack.effects))
  for (const emitter of effect.emitters) {
    const path = emitter.texture.toLowerCase().replace(/\.(tex|dds)$/i, ".png");
    if (!textureFiles.has(path)) {
      const filename =
        new Bun.CryptoHasher("sha256").update(path).digest("hex").slice(0, 20) +
        ".png";
      const file = `${cache}/public/effects/${filename}`;
      if (!(await Bun.file(file).exists())) {
        const r = await fetch(
          "https://raw.communitydragon.org/16.14/game/" + path,
        );
        if (!r.ok) throw Error(`${r.status}: ${path}`);
        await Bun.write(file, await r.arrayBuffer());
      }
      textureFiles.set(path, {
        textureFile: filename,
        textureSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file(file).arrayBuffer())
          .digest("hex"),
      });
    }
    Object.assign(emitter, textureFiles.get(path));
    const mesh = emitter.primitive?.mMesh?.mSimpleMeshName;
    if (mesh) {
      const key = effect.champion + ":" + mesh.toLowerCase();
      if (!meshFiles.has(key)) {
        const hash = new Bun.CryptoHasher("sha256")
          .update(key)
          .digest("hex")
          .slice(0, 20);
        const source = `${cache}/vfx/${hash}.${mesh.split(".").at(-1)}`,
          target = `${cache}/public/effects/${hash}.json`;
        if (!(await Bun.file(source).exists()))
          await Bun.write(
            source,
            await wads.get(effect.champion)(mesh.toLowerCase()),
          );
        const proc = Bun.spawn(
          [
            "dotnet",
            `${cache}/exporter-build/bin/Debug/net10.0/Exporter.dll`,
            "effect-mesh",
            source,
            target,
          ],
          { cwd: research, stdout: "inherit", stderr: "inherit" },
        );
        if (await proc.exited)
          throw Error(`Effect mesh export failed: ${mesh}`);
        meshFiles.set(key, `${hash}.json`);
      }
      emitter.meshFile = meshFiles.get(key);
    }
  }
await Bun.write(`${cache}/public/effects/package.json`, JSON.stringify(pack));
console.log(
  `Prepared ${Object.keys(pack.effects).length} effects, ${textureFiles.size} textures, ${meshFiles.size} meshes`,
);
