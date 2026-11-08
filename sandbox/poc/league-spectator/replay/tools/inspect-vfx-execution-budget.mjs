// Controlled execution evidence for the block-level instruction budget.
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLatestVfxSpawn,
  spawnPreviewMath,
} from "../latest-vfx-spawn.mjs";

const [packagePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-execution-budget.mjs <decoder> <evidence>",
  );
const root = resolve(packagePath),
  vendor = resolve(dirname(root), "vendor"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  definitionBytes = await Bun.file(`${root}/vfx-spawn.json`).arrayBuffer(),
  definition = JSON.parse(new TextDecoder().decode(definitionBytes)),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  runtimeBytes = await Bun.file(
    `${vendor}/unicorn_x86_candidate.mjs`,
  ).arrayBuffer();
if (hash(runtimeBytes) !== definition.runtimeSha256)
  throw Error("Budget runtime source mismatch");
const { default: createUnicorn } = await import(
    pathToFileURL(`${vendor}/unicorn_x86_candidate.mjs`).href
  ),
  uc = await createUnicorn(),
  k = await createLatestVfxSpawn(
    uc,
    profile,
    image,
    definitionBytes,
    await Bun.file(`${root}/${definition.templates[0].file}`).arrayBuffer(),
    spawnPreviewMath,
  ),
  results = [];
try {
  k.reset(1n);
  const at = 0x101f0000,
    counter = at + 0x1000;
  for (const [bytes, count] of [
    [new Uint8Array([0x90, 0x90, 0xc3]), 3],
    [new Uint8Array([0x66, 0x90, 0xc3]), 2],
  ]) {
    k.engine.mem_write(at, bytes);
    k.engine.ctl_remove_cache(BigInt(at), BigInt(at + bytes.length));
    k.callNative(at - profile.imageBase, {});
    if (
      k.lastExecutionBudget.instructions !== count ||
      k.lastExecutionBudget.exceeded
    )
      throw Error(
        `Owned-code mutation instruction count mismatch: ${JSON.stringify({ code: Buffer.from(bytes).toString("hex"), expected: count, actual: k.lastExecutionBudget })}`,
      );
    results.push({
      kind: "owned-code-mutation",
      explicitCacheInvalidation: true,
      codeHex: Buffer.from(bytes).toString("hex"),
      ...k.lastExecutionBudget,
    });
  }
  // One block: 500 single-byte NOPs, one memory increment, one backward jump.
  // Its counter proves that the first denied block did not execute.
  const loop = new Uint8Array(511).fill(0x90),
    dv = new DataView(loop.buffer);
  loop[500] = 0xff;
  loop[501] = 0x05;
  dv.setInt32(502, counter - (at + 506), true);
  loop[506] = 0xe9;
  dv.setInt32(507, -511, true);
  k.engine.mem_write(at, loop);
  k.engine.ctl_remove_cache(BigInt(at), BigInt(at + loop.length));
  k.engine.mem_write(counter, new Uint8Array(4));
  let exhausted = false;
  try {
    k.callNative(at - profile.imageBase, {});
  } catch (error) {
    if (!String(error).includes("execution instruction budget exceeded"))
      throw error;
    exhausted = true;
  }
  const iterations = k.readU32(counter),
    expected = Math.floor(5000000 / 502);
  if (
    !exhausted ||
    !k.lastExecutionBudget.exceeded ||
    iterations !== expected ||
    k.lastExecutionBudget.instructions !== iterations * 502 ||
    k.lastExecutionBudget.instructions > 5000000
  )
    throw Error(
      `Instruction limit was not enforced before denied block: ${JSON.stringify({ iterations, expected, budget: k.lastExecutionBudget })}`,
    );
  results.push({
    kind: "bounded-loop",
    iterations,
    expected,
    codeSha256: hash(loop),
    ...k.lastExecutionBudget,
  });
  k.callNative(0x11880, {});
  if (
    k.lastExecutionBudget.exceeded ||
    k.lastExecutionBudget.instructions !== 4
  )
    throw Error("Execution did not recover after controlled budget exhaustion");
  results.push({
    kind: "original-noop-after-exhaustion",
    ...k.lastExecutionBudget,
  });
  const target = profile.imageBase + 0x11880,
    before = hash(k.read(target, 16)),
    write = new Uint8Array([
      0x48, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0xc6, 0, 0xc3, 0xc3,
    ]);
  new DataView(write.buffer).setBigUint64(2, BigInt(target), true);
  k.engine.mem_write(at, write);
  k.engine.ctl_remove_cache(BigInt(at), BigInt(at + write.length));
  let protectedWrite = false;
  try {
    k.callNative(at - profile.imageBase, {});
  } catch (error) {
    if (!String(error).includes(`code ${uc.ERR_WRITE_PROT}`)) throw error;
    protectedWrite = true;
  }
  if (!protectedWrite || hash(k.read(target, 16)) !== before)
    throw Error("Native executable write protection failed");
  results.push({
    kind: "executable-write-protection",
    targetRva: 0x11880,
    unchanged: true,
  });
} finally {
  k.close();
}
const result = {
  schema: 1,
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  definitionSha256: hash(definitionBytes),
  decoderImageSha256: profile.decoderImageSha256,
  runtimeSha256: hash(runtimeBytes),
  moduleSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-spawn.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  results,
  scope:
    "Controlled owned-code instruction counts, cache behavior after same-size code mutation with explicit cache invalidation, five-million-instruction bound with a memory counter proving the denied block did not execute, recovery through original client code, and protection against emulated writes to executable pages. Block admission uses Unicorn's exact cached instruction counts; whole-block charging can stop earlier than a per-instruction counter. Does not establish browser rendering, native function coverage or game A/V fidelity.",
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ cases: results.length, results }));
