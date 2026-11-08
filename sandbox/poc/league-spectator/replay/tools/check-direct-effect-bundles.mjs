import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
for (const name of [
  "latest-viewer.mjs",
  "latest-direct-effect-worker.mjs",
  "latest-targeted-missile-worker.mjs",
]) {
  const result = await Bun.build({
    entrypoints: [`${root}/${name}`],
    target: "browser",
    external: ["three", "/assets/*"],
    write: false,
  });
  if (!result.success || result.outputs.length !== 1)
    throw new AggregateError(result.logs, `Browser build failed: ${name}`);
  const source = await result.outputs[0].text();
  if (
    name.includes("worker") &&
    /emu_start|NativeDecoder|unicorn/i.test(source)
  )
    throw Error("Direct simulation worker includes an emulation dependency");
  console.log(
    JSON.stringify({
      module: name,
      browserBundleBytes: result.outputs[0].size,
      ...(name.includes("worker") ? { emulationDependency: false } : {}),
    }),
  );
}
