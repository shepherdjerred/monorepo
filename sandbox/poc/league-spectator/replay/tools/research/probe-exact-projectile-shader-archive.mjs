import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { openLocalWad } from "../wad.mjs";

const [installation, cpuReceiptPath, outputPath, ...python] =
  process.argv.slice(2);
assert(installation && cpuReceiptPath && outputPath);
const cache = await realpath(".cache");
const outputParent = await realpath(dirname(resolve(outputPath)));
assert(outputParent === cache || outputParent.startsWith(cache + sep));
assert(
  !(await Bun.file(outputPath).exists()),
  "Fresh shader archive receipt required",
);
const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const cpuBytes = await Bun.file(cpuReceiptPath).bytes();
const cpu = JSON.parse(new TextDecoder().decode(cpuBytes));
assert.equal(cpu.build, "16.23.840.6595");
assert.equal(
  cpu.decoderSha256,
  "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15",
);
const materials = cpu.assets.flatMap(
  (asset) =>
    asset.effect.reviewedEmitter?.nativeEmitterObservation.cpuMaterial ?? [],
);
assert.equal(materials.length, 1);
const [{ shaderRequest, renderStateRequest }] = materials;
assert.equal(shaderRequest.selectedPassVariant, 4);
assert.equal(shaderRequest.additionalDefineRows, 0);
assert.equal(shaderRequest.finalizerFlagsHex, "00000000000000000000");
assert.equal(shaderRequest.palettizeTexturesFlagOffset, 4);
assert.deepEqual(renderStateRequest.materialParameterRequests[0], [
  "ALPHA_TEST",
  1,
]);

const archives = [
  [
    "DATA/FINAL/ShaderCache.dx11.wad.client",
    "69d8a3323ae93754ed3c3baafa41f52e4141f3a34bb41293e2987e17f237ceaf",
  ],
  [
    "DATA/FINAL/Shaders/Shaders.wad.client",
    "b0a9ff945ab37be935b06d6cd0d2bc84ac557c4c2d728a4495941587b6bd55d3",
  ],
];
for (const [name, sha] of archives)
  assert.equal(
    sha256(await Bun.file(`${installation}/Game/${name}`).bytes()),
    sha,
  );
const [dx11, sources] = await Promise.all(
  archives.map(([name]) =>
    openLocalWad(installation, name, Bun.zstdDecompressSync),
  ),
);
const view = (bytes) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const decode = new TextDecoder("utf-8", { fatal: true });
const stages = [];
for (const [kind, originalName, expectedCount, expectedDefineCount] of [
  ["vertex", shaderRequest.vertexStage, 16, 4],
  ["pixel", shaderRequest.pixelStage, 256, 8],
]) {
  assert.equal(
    originalName,
    kind === "vertex"
      ? "ParticleSystem/QUAD_VS.vs"
      : "ParticleSystem/QUAD_PS.ps",
  );
  const stem = `assets/shaders/hlsl/${originalName.toLowerCase()}`;
  const tocPath = `${stem}-dx11`;
  const toc = await dx11(tocPath);
  const tv = view(toc);
  let offset = 0;
  function string() {
    const length = tv.getUint32(offset, true);
    offset += 4;
    assert(length > 0 && length <= 64 && offset + length <= toc.length);
    const text = decode.decode(toc.subarray(offset, offset + length));
    offset += length;
    return text;
  }
  assert.equal(string(), "TOC3.0");
  const count = tv.getUint32(offset, true);
  const defineCount = tv.getUint32(offset + 4, true);
  assert.equal(count, expectedCount);
  assert.equal(defineCount, expectedDefineCount);
  assert.equal(tv.getUint32(offset + 8, true), count);
  assert.equal(tv.getUint32(offset + 12, true), kind === "pixel" ? 1 : 0);
  offset += 16;
  assert.equal(string(), "baseDefines");
  const declares = Array.from({ length: defineCount }, () => {
    const name = string();
    assert.equal(string(), "1");
    return name;
  });
  assert.equal(string(), "shaders");
  assert.equal(toc.length, offset + count * 12);

  const bundlePath = `${tocPath}_0`;
  const bundle = await dx11(bundlePath);
  const bv = view(bundle);
  const candidates = [];
  const controls =
    kind === "pixel"
      ? [
          ["ALPHA_TEST"],
          ["ALPHA_TEST", "PALETTIZE_TEXTURES"],
          ["ALPHA_TEST", "DISABLE_FOW"],
          ["ALPHA_TEST", "DISABLE_FOW", "PALETTIZE_TEXTURES"],
        ]
      : [[], ["DISABLE_FOW"]];
  for (const defines of controls) {
    assert(defines.every((name) => declares.includes(name)));
    const key = Bun.hash.xxHash64(defines.map((name) => `${name}=1`).join(""));
    const matches = [];
    for (let i = 0; i < count; i++)
      if (tv.getBigUint64(offset + i * 8, true) === key)
        matches.push(tv.getUint32(offset + count * 8 + i * 4, true));
    assert.equal(matches.length, 1);
    const [id] = matches;
    assert(id < 100);
    let rowOffset = 0;
    for (let i = 0; i < id; i++) rowOffset += 4 + bv.getUint32(rowOffset, true);
    const recordSize = bv.getUint32(rowOffset, true);
    const begin = rowOffset + 4;
    const dxbcSize = bv.getUint32(begin + 24, true);
    assert(
      dxbcSize >= 32 &&
        dxbcSize <= recordSize &&
        begin + recordSize <= bundle.length,
    );
    assert.equal(decode.decode(bundle.subarray(begin, begin + 4)), "DXBC");
    candidates.push({
      defines,
      key: key.toString(16),
      id,
      offset: begin,
      dxbcSize,
      sha256: sha256(bundle.subarray(begin, begin + dxbcSize)),
    });
  }
  const otherPathsProbed = [
    stem,
    `${stem}-metal`,
    `${stem}-gl`,
    `${stem}-gles`,
    stem.replace("/hlsl/", "/glsl/"),
    stem.replace("/hlsl/", "/metal/"),
  ];
  assert(
    otherPathsProbed.every((path) => !dx11.has(path) && !sources.has(path)),
  );
  let disassembly;
  if (python.length) {
    const [candidate] = candidates;
    const input = bundle.subarray(
      candidate.offset,
      candidate.offset + candidate.dxbcSize,
    );
    const reader = fileURLToPath(
      new URL("./disassemble-exact-projectile-shader.py", import.meta.url),
    );
    const result = Bun.spawnSync([...python, reader, kind], {
      stdin: Buffer.from(input),
      stderr: "inherit",
    });
    assert.equal(result.exitCode, 0);
    disassembly = JSON.parse(result.stdout.toString());
    assert.equal(disassembly.shaderId, candidate.id);
    assert.equal(disassembly.bundleOffset, candidate.offset);
    assert.equal(disassembly.dxbcBytes, candidate.dxbcSize);
    assert.equal(disassembly.dxbcSha256, candidate.sha256);
    if (kind === "pixel")
      disassembly.observedCutoff =
        renderStateRequest.materialParameterRequests[1][1][0];
  }
  stages.push({
    kind,
    originalName,
    tocPath,
    tocSha256: sha256(toc),
    bundlePath,
    bundleSha256: sha256(bundle),
    declares,
    candidates,
    otherPathsProbed,
    disassembly,
  });
}
await Bun.write(
  outputPath,
  `${JSON.stringify(
    {
      build: cpu.build,
      decoderSha256: cpu.decoderSha256,
      cpuReceiptSha256: sha256(cpuBytes),
      archives,
      stages,
      scope:
        "Exact installed Windows DXBC candidate rows for original macOS CPU stage names. Optional Windows system disassembly verifies the ordinary vertex and alpha-tested pixel rows. Probed named paths contain no Metal or GLSL source. Metal acquisition, full shader define environment, translation and browser pixels remain unverified.",
    },
    null,
    2,
  )}\n`,
);
