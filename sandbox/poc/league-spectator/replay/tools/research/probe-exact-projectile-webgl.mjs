import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { openLocalWad } from "../wad.mjs";
import { runExactProjectileWebglControl } from "./exact-projectile-webgl-control.mjs";

const [installation, cpuPath, shaderPath, exporterPath, chromePath, proofPath] =
  process.argv.slice(2);
assert(
  proofPath && process.platform === "win32",
  "Usage: bun probe-exact-projectile-webgl.mjs <local source files> <CPU receipt> <DXBC receipt> <TerrainTextureMips.dll> <Chrome executable> <fresh private proof directory>",
);
const proof = resolve(proofPath);
const cache = await realpath(".cache");
const parent = await realpath(dirname(proof));
assert(parent === cache || parent.startsWith(cache + sep));
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const cpuBytes = await Bun.file(cpuPath).bytes();
const shaderBytes = await Bun.file(shaderPath).bytes();
const cpu = JSON.parse(new TextDecoder().decode(cpuBytes));
const shader = JSON.parse(new TextDecoder().decode(shaderBytes));
assert.equal(cpu.build, "16.23.840.6595");
assert.equal(shader.build, cpu.build);
assert.equal(shader.cpuReceiptSha256, sha(cpuBytes));
const [vertex, pixel] = shader.stages;
assert.equal(
  vertex.disassembly.dxbcSha256,
  "cad9787f486b62aaf4928859674d8f3f21315197b4f1175f9d844cbf0243f3a4",
);
assert.equal(
  pixel.disassembly.dxbcSha256,
  "876c2e284a8a8f4e39804e0aa0dffd20e358d7e54247c7e10c794b8f7f65697c",
);
const [reviewed] = cpu.assets.flatMap(
  (asset) => asset.effect.reviewedEmitter ?? [],
);
const { cpuQuad, cpuMaterial } = reviewed.nativeEmitterObservation;
assert.equal(cpuQuad.vertexStrideBytes, 28);
assert.equal(cpuQuad.verticesHex.length, 4 * 28 * 2);
assert.deepEqual(cpuQuad.indices, [0, 1, 2, 0, 2, 3]);
assert.equal(cpuQuad.sameClockQuadUnchanged, true);
assert.equal(cpuQuad.emptyPoolIndices, 0);
assert.equal(cpuQuad.suppliedSystemAlpha, 1);
assert.equal(cpuQuad.lifetimeControl.expiredIndexCount, 0);
assert.deepEqual(
  cpuQuad.packedColorBytes,
  Array.from({ length: 4 }, () => [182, 93, 73, 140]),
);
assert.deepEqual(
  cpuMaterial.textureControls.map(
    ({ descriptorPrefixHex }) => descriptorPrefixHex,
  ),
  ["0000000101", "0101010101"],
);
assert.equal(
  cpuMaterial.renderStateRequest.descriptorHex,
  "3f0000000403000000000606070700010f000000000000000000000000000000",
);
const cutoff =
  cpuMaterial.renderStateRequest.materialParameterRequests[1][1][0];
assert.equal(cutoff, Math.fround(5 / 255));
assert.equal(pixel.disassembly.observedCutoff, cutoff);

await mkdir(proof);
const wad = await openLocalWad(
  installation,
  "DATA/FINAL/Champions/Zoe.wad.client",
  Bun.zstdDecompressSync,
);
const textureJobs = {};
const textures = {};
for (const [key, name, digest] of [
  [
    "base",
    "baseTexture",
    "fcfa5d138c2df39c6ca189ec47a00973e0bd13d0585dfdf81ab026cfacd35835",
  ],
  [
    "particleColor",
    "paletteTexture",
    "bc06557b44402fee1498430bd4008df9598085f44b29fea2f02218473674b2f8",
  ],
]) {
  const texture = reviewed.textures[key];
  const data = await wad(texture.path);
  assert.equal(sha(data), digest);
  assert.equal(texture.sha256, digest);
  const raw = join(proof, name + ".tex");
  const png = join(proof, name + ".png");
  await Bun.write(raw, data);
  textureJobs[raw] = png;
  textures[name] = { original: texture, raw, png };
}
const jobsPath = join(proof, "texture-jobs.json");
await Bun.write(jobsPath, JSON.stringify(textureJobs));
const exported = Bun.spawnSync(["dotnet", resolve(exporterPath), jobsPath], {
  stderr: "inherit",
});
assert.equal(exported.exitCode, 0);
const mipResults = JSON.parse(exported.stdout.toString());
const routes = new Map();
for (const [name, item] of Object.entries(textures)) {
  const mip = mipResults[item.raw];
  assert.deepEqual(mip, {
    mipLevel: 0,
    width: item.original.format.width,
    height: item.original.format.height,
  });
  const png = await Bun.file(item.png).bytes();
  routes.set("/" + name + ".png", { png });
  Object.assign(item, { mip, projectionSha256: sha(png) });
}

const inputs = {
  verticesHex: cpuQuad.verticesHex,
  indicesHex: cpuQuad.indicesHex,
  emptyPoolIndices: cpuQuad.emptyPoolIndices,
  retainedIndexCount: cpuQuad.indices.length,
  expiredIndexCount: cpuQuad.lifetimeControl.expiredIndexCount,
  cutoff,
};
const resultPath = "/result-" + crypto.randomUUID();
const script = `
  const run = ${runExactProjectileWebglControl.toString()};
  const report = (result) => fetch(${JSON.stringify(resultPath)}, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });
  run(${JSON.stringify(inputs)}).then(
    report, (error) => report({ error: String(error), stack: error.stack })
  );`;
const result = Promise.withResolvers();
const requests = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    requests.push(path === resultPath ? "result" : path);
    if (path === resultPath && request.method === "POST") {
      try {
        result.resolve(await request.json());
        return new Response(null, { status: 204 });
      } catch (error) {
        result.reject(error);
        return new Response(null, { status: 400 });
      }
    }
    if (path === "/")
      return new Response(
        '<!doctype html><meta charset="utf-8"><script src="/proof.js" defer></script>',
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy":
              "default-src 'none'; script-src 'self'; connect-src 'self'",
          },
        },
      );
    if (path === "/proof.js")
      return new Response(script, {
        headers: { "Content-Type": "text/javascript" },
      });
    if (routes.has(path))
      return new Response(routes.get(path).png, {
        headers: { "Content-Type": "image/png" },
      });
    return new Response(null, { status: 404 });
  },
});
let browserOutput;
let child;
let timeout;
try {
  child = Bun.spawn(
    [
      resolve(chromePath),
      "--headless=new",
      "--no-first-run",
      "--disable-background-networking",
      "--disable-extensions",
      "--mute-audio",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--no-proxy-server",
      "--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE 127.0.0.1",
      "--user-data-dir=" + join(proof, "browser-profile"),
      server.url.href,
    ],
    { stdout: "pipe", stderr: "pipe", timeout: 30000 },
  );
  const terminated = Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]).then(([status, stderr]) => {
    throw Error(
      `Headless Chrome exited without a readback (${status}) \n ${stderr}`,
    );
  });
  const deadline = new Promise(
    (_, reject) =>
      (timeout = setTimeout(
        () =>
          reject(
            Error(
              `Headless browser readback timed out after requests: ${requests.join(", ")}`,
            ),
          ),
        15000,
      )),
  );
  browserOutput = await Promise.race([result.promise, terminated, deadline]);
} finally {
  clearTimeout(timeout);
  if (child) {
    child.kill();
    await child.exited;
  }
  server.stop(true);
}
assert(!browserOutput.error, JSON.stringify(browserOutput));
assert.deepEqual(browserOutput.sourceDimensions, {
  baseTexture: [128, 128],
  paletteTexture: [8, 8],
});
const [empty, active, repeated, expired, rejected] = browserOutput.cases;
assert.equal(empty.changedPixels, 0);
assert.equal(expired.sha256, empty.sha256);
assert.equal(rejected.sha256, empty.sha256);
assert(active.changedPixels > 0 && active.strongest);
assert.equal(repeated.sha256, active.sha256);
assert.deepEqual(browserOutput.blendState, {
  enabled: true,
  equation: [0x8006, 0x8006],
  source: [0x0302, 0x0302],
  destination: [0x0303, 0x0303],
  depthTest: false,
  depthWrite: false,
});
const { source, expected, actual } = browserOutput.blendReadback;
assert(source[3] > 0 && source[3] < 255);
assert.deepEqual(actual, active.strongest.rgba);
assert(actual.every((value, index) => Math.abs(value - expected[index]) <= 2));
const { png, ...readback } = browserOutput;
const image = Buffer.from(png.slice("data:image/png;base64,".length), "base64");
await Bun.write(join(proof, "retained-framebuffer.png"), image);
await Bun.write(
  join(proof, "receipt.json"),
  JSON.stringify(
    {
      schema: 1,
      build: cpu.build,
      cpuReceiptSha256: sha(cpuBytes),
      dxbcReceiptSha256: sha(shaderBytes),
      browserShaderHarnessSha256: sha(
        Buffer.from(runExactProjectileWebglControl.toString()),
      ),
      textureExporterSha256: sha(await Bun.file(exporterPath).bytes()),
      textures,
      suppliedInputs: {
        basis: "identity",
        camera: "orthographic view along negative Z with zero camera pushback",
        cameraAtlas: [1, 1, 1],
        fog: [0, 0, 0, 255],
        remap: [0, 0, 0, 0],
        target: "linear RGBA8",
        projection: "magnified on both axes to use authored mip 0",
      },
      ...readback,
      retainedFramebufferPngSha256: sha(image),
      scope:
        "Headless WebGL2 readback for one controlled Zoe emitter using the translated ordinary quad shader branch, archived texture mip 0 and original packed vertices. Supplied camera, transform, fog and remap. Replay world attachment and full native effect appearance remain unverified.",
    },
    null,
    2,
  ) + "\n",
);
