import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pins = {
  profile: "7edb0da20ea01e1617201cd12e038d8647b53761520634cc98feffacca3b2ee0",
  pages: "087dce77eb40947cedccbb8a8263ab7e0b8156897b6356236cba706350d44f9b",
  runtime: "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
};

async function readPinned(path, digest) {
  const bytes = await Bun.file(path).bytes();
  assert.equal(
    Bun.CryptoHasher.hash("sha256", bytes, "hex"),
    digest,
    "Rift startup proof input digest differs",
  );
  return bytes;
}

export async function buildRiftStartupWorker(profile, runtime, decompress) {
  const [profileBytes, runtimeBytes, pages] = await Promise.all([
    readPinned(profile, pins.profile),
    readPinned(runtime, pins.runtime),
    readPinned(join(dirname(profile), "pages.bin"), pins.pages),
  ]);
  const sources = new Map([
    ["/rift-startup-profile.json", { contents: profileBytes, loader: "json" }],
    ["/rift-startup-emulator.mjs", { contents: runtimeBytes, loader: "js" }],
  ]);
  const build = await Bun.build({
    entrypoints: [
      fileURLToPath(
        new URL("./native-rift-startup-worker.mjs", import.meta.url),
      ),
    ],
    target: "browser",
    format: "esm",
    plugins: [
      {
        name: "verified-rift-startup-sources",
        setup(plugin) {
          plugin.onResolve({ filter: /^\/fzstd\.mjs$/u }, () => ({
            path: resolve(decompress),
          }));
          plugin.onResolve(
            { filter: /^\/rift-startup-(profile\.json|emulator\.mjs)$/u },
            ({ path }) => ({
              path,
              namespace: "rift-startup",
            }),
          );
          plugin.onLoad(
            { filter: /.*/, namespace: "rift-startup" },
            ({ path }) => sources.get(path),
          );
        },
      },
    ],
  });
  if (!build.success || build.outputs.length !== 1)
    throw new AggregateError(build.logs, "Rift startup worker bundle failed");
  return new Map([
    ["rift-startup-worker.mjs", build.outputs[0]],
    ["rift-startup-pages.bin", pages],
  ]);
}
