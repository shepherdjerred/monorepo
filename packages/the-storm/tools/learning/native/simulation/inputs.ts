import path from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { z } from "zod";
import { root } from "#learning/sandbox.ts";
import { digestFile } from "#learning/preference/ledger.ts";

export async function simulationGradle(tasks: string[], log?: string) {
  const process = Bun.spawn(
    [
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      path.join(root, "plugin"),
      ...tasks,
      "--console=plain",
    ],
    {
      stdout: log === undefined ? "inherit" : Bun.file(log),
      stderr: "inherit",
    },
  );
  if ((await process.exited) !== 0)
    throw new Error("Authored simulation producer build or execution failed");
}

type RuntimeFile = {
  file: string;
  kind: "absent" | "directory" | "file";
  sha256: string | null;
};

async function inventory(file: string): Promise<RuntimeFile[]> {
  const status = await lstat(file).catch((error: unknown) => {
    const boundary = z.object({ code: z.literal("ENOENT") }).safeParse(error);
    if (boundary.success) return null;
    throw error;
  });
  // Java permits empty resource/classpath locations; retain and revalidate their absence too.
  if (status === null) {
    if (file.endsWith(".jar"))
      throw new Error("Required simulation runtime jar missing");
    return [{ file, kind: "absent", sha256: null }];
  }
  if (status.isFile())
    return [{ file, kind: "file", sha256: await digestFile(file) }];
  if (!status.isDirectory())
    throw new Error(
      "Simulation runtime inputs must be regular files or directories",
    );
  const children = await readdir(file);
  children.sort();
  const entries = await Promise.all(
    children.map((child) => inventory(path.join(file, child))),
  );
  return [{ file, kind: "directory", sha256: null }, ...entries.flat()];
}

/** Fingerprint the actual Java test runtime and original producer sources, not just the Paper jar. */
export async function simulationInputs() {
  const classpathFile = path.join(
    root,
    "plugin/modules/rwfbots/build/simulation-classpath.json",
  );
  const classpath = z
    .array(z.string().min(1).refine(path.isAbsolute))
    .min(1)
    .parse(await Bun.file(classpathFile).json());
  if (new Set(classpath).size !== classpath.length)
    throw new Error("Simulation classpath contains duplicate entries");
  const directories = [
    "plugin/modules/rwfbots/src/test/java/com/shepherdjerred/thestorm/rwfbots/sim",
  ];
  const sourceFiles = [
    "plugin/modules/rwfbots/build.gradle.kts",
    "plugin/modules/rwfbots/src/test/java/com/shepherdjerred/thestorm/rwfbots/domain/Fixtures.java",
    "plugin/modules/rwfbots/src/test/java/com/shepherdjerred/thestorm/rwfbots/domain/map/TrainingYardNav.java",
  ];
  for (const directory of directories) {
    const files = await readdir(path.join(root, directory));
    sourceFiles.push(
      ...files
        .filter((file) => file.endsWith(".java"))
        .sort()
        .map((file) => path.join(directory, file)),
    );
  }
  const compiled = path.join(root, "plugin/modules/rwfbots/build");
  for (const file of classpath)
    if (
      !file.endsWith(".jar") &&
      !file.startsWith(path.join(compiled, "classes") + path.sep) &&
      !file.startsWith(path.join(compiled, "resources") + path.sep)
    )
      throw new Error(
        "Simulation classpath differs from its compiled classes/resources and runtime jars",
      );
  const entries = await Promise.all(classpath.map((file) => inventory(file)));
  const hashes = entries.flat();
  if (
    !hashes.some(
      (row) =>
        row.file.endsWith("/rwfbots/sim/SimulationCapture.class") &&
        row.sha256 !== null,
    )
  )
    throw new Error("Simulation runtime lacks its compiled original producer");
  return {
    classpath_sha256: await digestFile(classpathFile),
    classpath,
    hashes,
    sources: await Promise.all(
      sourceFiles.map(async (file) => ({
        file,
        sha256: await digestFile(path.join(root, file)),
      })),
    ),
  };
}
