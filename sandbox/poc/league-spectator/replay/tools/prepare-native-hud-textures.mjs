import path from "node:path";
import { mkdir } from "node:fs/promises";
import { actorSha256 } from "./archived-actor-sources.mjs";

const [sourceCache, linksPath, outputArgument, dotnet = "dotnet"] =
  process.argv.slice(2);
if (!outputArgument)
  throw Error(
    "Usage: bun prepare-native-hud-textures.mjs <approved-source-cache> <atlas-links.json> <output-directory> [dotnet]",
  );
const output = path.resolve(outputArgument),
  links = await Bun.file(linksPath).json();
await mkdir(output, { recursive: true });
const exporter = path.join(
  sourceCache,
  "exporter-build/bin/Debug/net10.0/Exporter.dll",
);
const scene = await Bun.file(
  path.join(sourceCache, "public/latest-scene/manifest.json"),
).json();
const exporterSha256 = actorSha256(await Bun.file(exporter).bytes());
if (
  scene.build !== "16.21.829.8620" ||
  scene.protocol !== "20e09df23c66b85e" ||
  scene.toolchain.exporterSha256 !== exporterSha256
)
  throw Error("Pinned original texture exporter receipt required");
const jobs = {},
  textures = [];
for (const reference of links.results) {
  for (const location of reference.locations) {
    if (location.magic !== "TEX\0") continue;
    const raw = path.resolve(path.dirname(linksPath), location.filename),
      bytes = await Bun.file(raw).bytes();
    if (actorSha256(bytes) !== location.sha256)
      throw Error("Original HUD texture bytes changed");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      file = path.join(output, `${location.sha256}.png`);
    jobs[raw] = file;
    textures.push({
      reference: reference.value,
      sourceSha256: location.sha256,
      wad: location.wad,
      raw,
      file,
      width: view.getUint16(4, true),
      height: view.getUint16(6, true),
    });
  }
}
const jobsPath = path.join(output, "jobs.json");
await Bun.write(jobsPath, JSON.stringify(jobs, null, 2));
const child = Bun.spawn([dotnet, exporter, "textures", jobsPath], {
  stdout: "pipe",
  stderr: "pipe",
});
const [stdout, stderr, code] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
if (code !== 0)
  throw Error(`Original HUD texture conversion failed: ${stdout}\n${stderr}`);
for (const texture of textures)
  texture.pngSha256 = actorSha256(await Bun.file(texture.file).bytes());
await Bun.write(
  path.join(output, "textures.json"),
  JSON.stringify(
    {
      schema: 1,
      build: links.build,
      protocol: links.protocol,
      exporterSha256,
      textures,
      scope: {
        originalTexturePixelsDecoded: true,
        runtimeSamplerAndBlendingExecuted: false,
        nativeHudRendered: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, textures: textures.length }));
