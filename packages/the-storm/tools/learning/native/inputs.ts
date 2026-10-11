import path from "node:path";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import { digestFile, readJson } from "#learning/preference/ledger.ts";
import { frozenManifest, root } from "#learning/sandbox.ts";

/** Build exactly the artifacts that will be fingerprinted and staged in the native owner. */
export async function buildCaptureInputs(): Promise<void> {
  for (const [directory, tasks] of [
    ["plugin", [":dist:shadowJar", ":dist:fixturesJar", ":rwfmap:installDist"]],
    ["client", ["assemble"]],
  ] as const) {
    const build = Bun.spawn(
      [
        "mise",
        "exec",
        "--",
        "gradle",
        "-p",
        path.join(root, directory),
        ...tasks,
        "--console=plain",
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    if ((await build.exited) !== 0)
      throw new Error(`Native capture build failed: ${directory}`);
  }
}

async function tree(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await tree(file)));
    else if (entry.isFile()) files.push(file);
    else throw new Error("Native capture inputs must be regular files");
  }
  return files;
}

/** Hash the actor, native environment, renderer source and actual built client inputs. */
export async function captureInputs(model: string) {
  const actor = await digestFile(path.join(model, "actor.onnx"));
  const manifest = z
    .object({
      schema: z.literal(1),
      kind: z.literal("rwf-trooper-ppo"),
      acceptance: z.literal("unaccepted"),
      onnx_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .parse(await readJson(path.join(model, "manifest.json")));
  if (manifest.onnx_sha256 !== actor)
    throw new Error("Native capture actor digest differs");
  const roots = [
    "client/src/main",
    "client/build/classes/java/main",
    "client/build/resources/main",
    "tools/client",
  ];
  const inventories = await Promise.all(
    roots.map((name) => tree(path.join(root, name))),
  );
  const sources = inventories.flat();
  const files = [
    ...sources,
    ...[
      "package.json",
      "../../bun.lock",
      "client/build.gradle.kts",
      "client/settings.gradle.kts",
      "client/gradle.lockfile",
      "client/settings-gradle.lockfile",
      "client/gradle/verification-metadata.xml",
      "client/build/libs/the-storm-client-1.0.0.jar",
    ].map((name) => path.join(root, name)),
  ].sort();
  const renderer = await Promise.all(
    files.map(async (file) => ({
      file: path.relative(root, file),
      sha256: await digestFile(file),
    })),
  );
  return {
    native: await frozenManifest(),
    renderer,
    artifacts: {
      actor,
      manifest: await digestFile(path.join(model, "manifest.json")),
    },
  };
}
