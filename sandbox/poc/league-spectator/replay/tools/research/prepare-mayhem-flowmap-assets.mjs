import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { normalizeMapBin } from "../map-scene-assets.mjs";
import { openLocalWad } from "../wad.mjs";

const terrainArchive = "DATA/FINAL/Maps/Shipping/Map12.wad.client";
const shaderArchive = "DATA/FINAL/ShaderCache.dx11.wad.client";
const bloom = "data/maps/mapgeometry/map12/bloom";
const shader = "assets/shaders/generated/shaders/staticmesh/flowmap_river";
const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

const profiles = [
  {
    name: "vertex",
    stage: "vertex",
    suffix: "vs",
    row: 1,
    key: 0x3581f8d438fff73dn,
    digest: "4626fdc8861baf6670a1867c175ea579d48c34fe9eb381f6975547eee63129c9",
    translationSha256:
      "bd104757f66c0c6b9ceb7f5f648723b38926e1c78bb476f28c5ceaaa1f8ca03d",
  },
  {
    name: "flow",
    stage: "pixel",
    suffix: "ps",
    row: 18,
    key: 0x5b0c3ad975168e73n,
    digest: "c22f731c8cf6ad143b45f9a89e118d59f2ce97b2af475e6ccf765b6206d8a76a",
    translationSha256:
      "7f3430ef97ec7a7f4b57965a7a9d5eebc37d58911b4daa9cfbc3649053abef36",
  },
  {
    name: "diffuseFlow",
    stage: "pixel",
    suffix: "ps",
    row: 15,
    key: 0x7b3457a62a9b9eadn,
    digest: "6512323f39d85d7f1b582163e460cf2e564fb5694024199db7a8739f9193311f",
    translationSha256:
      "1b6b50b735c42416633e96ffa6e734fba231906c367e7ee22182fa574b7b5e3b",
  },
];
const archives = {
  vs: [
    "c37f8a5bf53b0c7bbf008bf626a0ba08761fbba1afb411287ae855650eb71d09",
    "42474dbc7f34330d8e9a415b7cebb0c03d00481446cb206a3e647d0f66673f10",
  ],
  ps: [
    "c0f547a3809f223ad6f4e9758d10754d42f8ad1a44995e1d3124cb80190a576d",
    "31620f193758b210cc0b8ed5fde68b9c7d3bae4b704d2ad26cc97d2a1d52cb43",
  ],
};

async function run(command) {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(exit, 0, stdout + stderr);
}

function readStage(toc, bundle, profile) {
  let offset = 0;
  function string() {
    const bytes = toc.readUInt32LE(offset);
    assert.ok(bytes > 0 && bytes < 256);
    const value = toc.toString("ascii", offset + 4, offset + 4 + bytes);
    offset += 4 + bytes;
    assert.ok(offset <= toc.length);
    return value;
  }
  assert.equal(string(), "TOC3.0");
  const rows = toc.readUInt32LE(offset);
  const defines = toc.readUInt32LE(offset + 4);
  offset += 16;
  assert.equal(string(), "baseDefines");
  for (let index = 0; index < defines * 2; index++) string();
  assert.equal(string(), "shaders");
  assert.equal(toc.length, offset + rows * 12);
  const matches = [];
  for (let row = 0; row < rows; row++) {
    if (toc.readBigUInt64LE(offset + row * 8) === profile.key)
      matches.push(toc.readUInt32LE(offset + rows * 8 + row * 4));
  }
  assert.ok(matches.length > 0 && matches.every((row) => row === profile.row));
  let start = 0;
  for (let row = 0; row < profile.row; row++)
    start += 4 + bundle.readUInt32LE(start);
  const recordSize = bundle.readUInt32LE(start);
  start += 4;
  assert.equal(bundle.toString("ascii", start, start + 4), "DXBC");
  const length = bundle.readUInt32LE(start + 24);
  assert.ok(
    length > 32 && length <= recordSize && start + recordSize <= bundle.length,
  );
  const bytes = bundle.subarray(start, start + length);
  assert.equal(sha256(bytes), profile.digest);
  return bytes;
}

async function prepare(installation, exporter, translator, dotnet, output) {
  const cache = resolve(".cache");
  const root = resolve(output);
  const fromCache = relative(cache, root);
  assert.ok(
    fromCache &&
      !isAbsolute(fromCache) &&
      fromCache !== ".." &&
      !fromCache.startsWith(".." + sep),
  );
  await mkdir(root);
  const work = join(root, "work");
  await mkdir(work);
  const geometryWad = await openLocalWad(
    installation,
    terrainArchive,
    Bun.zstdDecompressSync,
    "92d9430cc41b7b3399f0a849192d6bf0878067638948bc045c5821a2fb714cb0",
  );
  const sourceGeometry = await geometryWad(bloom + ".mapgeo");
  const geometrySha256 = sha256(sourceGeometry);
  assert.equal(
    geometrySha256,
    "7f6d1ab36747521130eb7d2e618e5a856d56a4544651bf40b9982cacefd40bed",
  );
  const sourceMaterials = await geometryWad(bloom + ".materials.bin");
  const materialsSha256 = sha256(sourceMaterials);
  assert.equal(
    materialsSha256,
    "edda022b5e925b62ccf05430623e339873cb06a67e7a6ef02764a5a3552f683b",
  );
  const mapgeo = join(work, "bloom.mapgeo");
  await Bun.write(mapgeo, sourceGeometry);
  await run([dotnet, resolve(exporter), "map-flow-river", mapgeo, root]);

  const geometry = await Bun.file(join(root, "geometry.json")).json();
  const names = new Set(
    geometry.groups.flatMap(({ submeshes }) =>
      submeshes.map(({ material }) => material),
    ),
  );
  assert.equal(names.size, 9);
  const authored = normalizeMapBin(readExactMapBin(sourceMaterials), names);
  const contents = {};
  const textureJobs = {};
  const textures = {};
  const materials = {};
  for (const name of names) {
    const material = authored[name];
    const [pass] = material.techniques.find(
      ({ name }) => name === "normal",
    ).passes;
    assert.equal(pass.shader, "{c8c7890d}");
    assert.deepEqual(
      [
        pass["{23b75597}"],
        pass["{22c0c7d0}"],
        pass["{a0958d01}"],
        pass["{be0abbf5}"],
        pass["{7385e534}"],
      ],
      [true, 6, 6, 7, 7],
    );
    const switches = Object.fromEntries(
      material["{dd7ddb9d}"].map((flag) => [
        flag.name,
        flag["{61342fd0}"] !== false,
      ]),
    );
    assert.deepEqual(Object.keys(switches).sort(), [
      "DEFORM_ON",
      "SS_MASK",
      "USE_DIFFUSE_TEXTURE",
      "USE_FLOW_MAP",
    ]);
    assert.equal(switches.DEFORM_ON, false);
    assert.equal(switches.SS_MASK, true);
    assert.equal(switches.USE_FLOW_MAP, true);
    assert.deepEqual(material["{e6d67ded}"], [
      { key: "DISABLE_FOW", value: "1" },
      { key: "NO_BAKED_LIGHTING", value: "1" },
    ]);
    const samplers = {};
    const inputs = ["Flow_Map", "Flowing_Normal_Map"];
    if (switches.USE_DIFFUSE_TEXTURE) inputs.push("Diffuse_Texture");
    for (const name of inputs) {
      const sampler = material.samplerValues.find(
        (row) => row.TextureName === name,
      );
      assert.equal(sampler.texturePath.kind, "wad-path-hash");
      assert.equal(sampler["{0f1ec3ac}"], 1);
      const pathHash = sampler.texturePath.value;
      assert.match(pathHash, /^[1-9][0-9]{0,19}$/u);
      if (!textures[pathHash]) {
        const bytes = await geometryWad.byHash(BigInt(pathHash));
        const source = join(work, pathHash + ".tex");
        const file = `textures/${pathHash}.png`;
        await Bun.write(source, bytes);
        textureJobs[source] = join(root, file);
        textures[pathHash] = { file, sourceSha256: sha256(bytes), mipLevel: 0 };
      }
      samplers[name] = pathHash;
    }
    materials[name] = {
      shader: switches.USE_DIFFUSE_TEXTURE ? "diffuseFlow" : "flow",
      samplers,
      parameters: Object.fromEntries(
        material.paramValues
          .filter(({ value }) => value !== undefined)
          .map(({ name, value }) => [name, value]),
      ),
    };
  }
  assert.equal(Object.keys(textures).length, 11);
  await mkdir(join(root, "textures"));
  const jobList = join(work, "textures.json");
  await Bun.write(jobList, JSON.stringify(textureJobs));
  await run([dotnet, resolve(exporter), "textures", jobList]);
  for (const texture of Object.values(textures)) {
    const bytes = Buffer.from(await Bun.file(join(root, texture.file)).bytes());
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    texture.width = bytes.readUInt32BE(16);
    texture.height = bytes.readUInt32BE(20);
  }

  const shaderWad = await openLocalWad(
    installation,
    shaderArchive,
    Bun.zstdDecompressSync,
  );
  const stages = {};
  for (const [suffix, [tocSha256, bundleSha256]] of Object.entries(archives)) {
    const path = `${shader}.${suffix}-dx11`;
    const toc = Buffer.from(await shaderWad(path));
    const bundle = Buffer.from(await shaderWad(path + "_0"));
    assert.equal(sha256(toc), tocSha256);
    assert.equal(sha256(bundle), bundleSha256);
    stages[suffix] = { toc, bundle };
  }
  const shaders = {};
  const jobs = [];
  await mkdir(join(root, "shaders"));
  for (const profile of profiles) {
    const { toc, bundle } = stages[profile.suffix];
    const source = join(work, profile.name + ".dxbc");
    const file = `shaders/${profile.name}.json`;
    await Bun.write(source, readStage(toc, bundle, profile));
    shaders[profile.name] = {
      file,
      row: profile.row,
      shaderKey: profile.key.toString(16),
      dxbcSha256: profile.digest,
    };
    jobs.push({ source, stage: profile.stage, output: join(root, file) });
  }
  const jobsPath = join(work, "shaders.json");
  const translationPath = join(work, "translated.json");
  await Bun.write(jobsPath, JSON.stringify(jobs));
  await run([resolve(translator), "translate", jobsPath, translationPath]);
  const translated = await Bun.file(translationPath).json();
  assert.equal(translated.pipelineVersion, 4);
  assert.equal(translated.failed, 0);
  assert.equal(translated.translated, jobs.length);
  for (const profile of profiles)
    assert.equal(
      sha256(await Bun.file(join(root, shaders[profile.name].file)).bytes()),
      profile.translationSha256,
    );

  for (const file of [
    "geometry.bin",
    "geometry.json",
    ...Object.values(textures).map(({ file }) => file),
    ...Object.values(shaders).map(({ file }) => file),
  ]) {
    const bytes = await Bun.file(join(root, file)).bytes();
    contents[file] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  const manifest = {
    schema: 1,
    kind: "mayhem-bloom-flowmap-control",
    build: "16.23.841.8428",
    mapId: 12,
    mapSkin: "Bloom",
    source: { geometrySha256, materialsSha256, shaderArchives: archives },
    controlledRendererDefines: {
      FEATURE_SCREENSPACE_UV: "1",
      DISABLE_SHADOWS: "1",
    },
    shaders,
    textures,
    materials,
    contents,
  };
  const manifestPath = join(root, "manifest.json");
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(
    JSON.stringify({
      manifestPath,
      manifestSha256: sha256(await Bun.file(manifestPath).bytes()),
      files: Object.keys(contents).length,
    }),
  );
}

const [installation, exporter, translator, dotnet, output, ...extra] =
  Bun.argv.slice(2);
assert.ok(
  installation &&
    exporter &&
    translator &&
    dotnet &&
    output &&
    extra.length === 0,
  "Usage: bun prepare-mayhem-flowmap-assets.mjs <installation> <Exporter.dll> <shader-translator> <dotnet> <new private .cache output>",
);
await prepare(installation, exporter, translator, dotnet, output);
