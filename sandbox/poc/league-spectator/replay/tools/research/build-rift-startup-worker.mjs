import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readReviewedCombatAudioWav } from "./read-local-combat-audio-comparison.mjs";

const pins = {
  profile: "7edb0da20ea01e1617201cd12e038d8647b53761520634cc98feffacca3b2ee0",
  pages: "087dce77eb40947cedccbb8a8263ab7e0b8156897b6356236cba706350d44f9b",
};
const runtimePin =
  "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716";
const combatAudioPins = {
  profile: "c4389d7964e2f70a7f7e0194b640b0657744ae1b4698d74d44d0940d4846378b",
  pages: "cbb5494db63fd39a1956c5946f4c20c0ebdd76ea2fece2056703fb01bfe9faa8",
};

async function readPinned(path, digest) {
  const bytes = await Bun.file(path).bytes();
  assert.equal(
    Bun.CryptoHasher.hash("sha256", bytes, "hex"),
    digest,
    "Rift native replay resource digest differs",
  );
  return bytes;
}

async function buildRiftWorker(name, profile, runtime, decompress, proofPins) {
  const [profileBytes, runtimeBytes, pages] = await Promise.all([
    readPinned(profile, proofPins.profile),
    readPinned(runtime, runtimePin),
    readPinned(join(dirname(profile), "pages.bin"), proofPins.pages),
  ]);
  const sources = new Map([
    [`/${name}-profile.json`, { contents: profileBytes, loader: "json" }],
    [`/${name}-emulator.mjs`, { contents: runtimeBytes, loader: "js" }],
  ]);
  const build = await Bun.build({
    entrypoints: [
      fileURLToPath(new URL(`./native-${name}-worker.mjs`, import.meta.url)),
    ],
    target: "browser",
    format: "esm",
    plugins: [
      {
        name: `verified-${name}-sources`,
        setup(plugin) {
          plugin.onResolve({ filter: /^\/fzstd\.mjs$/u }, () => ({
            path: resolve(decompress),
          }));
          plugin.onResolve(
            {
              filter:
                /^\/rift-(startup|combat-audio)-(profile\.json|emulator\.mjs)$/u,
            },
            ({ path }) => ({
              path,
              namespace: name,
            }),
          );
          plugin.onLoad({ filter: /.*/, namespace: name }, ({ path }) =>
            sources.get(path),
          );
        },
      },
    ],
  });
  if (!build.success || build.outputs.length !== 1)
    throw new AggregateError(build.logs, `Could not bundle ${name}`);
  return new Map([
    [`${name}-worker.mjs`, build.outputs[0]],
    [`${name}-pages.bin`, pages],
  ]);
}

export function buildRiftStartupWorker(profile, runtime, decompress) {
  return buildRiftWorker("rift-startup", profile, runtime, decompress, pins);
}

export async function buildRiftCombatAudioWorker(
  profile,
  runtime,
  decompress,
  wav,
) {
  const [files, sound] = await Promise.all([
    buildRiftWorker(
      "rift-combat-audio",
      profile,
      runtime,
      decompress,
      combatAudioPins,
    ),
    readReviewedCombatAudioWav(wav),
  ]);
  files.set("combat-audio/329446178.wav", sound);
  return files;
}
