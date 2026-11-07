// Bit-level comparison of a translated motion component against original code.
import { resolve } from "node:path";
import { createLatestMissileMotion } from "../latest-missiles.mjs";

const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-missile-motion.mjs <package-dir> <native-motion.json> <evidence.json>",
  );
const root = resolve(packagePath),
  profile = await Bun.file(`${root}/profile.json`).json(),
  motionBytes = await Bun.file(`${root}/missile-motion.json`).arrayBuffer(),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  hash(motionBytes) !== profile.missileMotionSha256 ||
  native.missileMotionSha256 !== profile.missileMotionSha256 ||
  native.build !== profile.clientVersion ||
  native.decoderImageSha256 !== profile.decoderImageSha256
)
  throw Error("Native motion comparison package mismatch");
const definition = JSON.parse(new TextDecoder().decode(motionBytes)),
  { fixedSpeedStep } = createLatestMissileMotion(definition),
  bits = (values) =>
    Array.from(new Uint32Array(new Float32Array(values).buffer)),
  mismatches = [];
for (const sample of native.cases) {
  const actual = fixedSpeedStep(
    sample.position,
    sample.target,
    sample.speed,
    sample.seconds,
  );
  if (
    JSON.stringify(bits(actual.velocity)) !==
      JSON.stringify(sample.velocityBits) ||
    JSON.stringify(bits(actual.displacement)) !==
      JSON.stringify(sample.displacementBits)
  )
    mismatches.push({
      ...sample,
      actualVelocityBits: bits(actual.velocity),
      actualDisplacementBits: bits(actual.displacement),
    });
}
const result = {
  schema: 1,
  build: profile.clientVersion,
  missileMotionSha256: profile.missileMotionSha256,
  nativeEvidenceSha256: hash(nativeBytes),
  stepRva: definition.stepRva,
  vectorHelperRva: definition.vectorHelperRva,
  packetInputs: new Set(native.cases.map((sample) => sample.key)).size,
  matched: native.cases.length - mismatches.length,
  mismatches,
  scope: native.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    packetInputs: result.packetInputs,
    matched: result.matched,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) throw Error("Native fixed-speed component disagreement");
