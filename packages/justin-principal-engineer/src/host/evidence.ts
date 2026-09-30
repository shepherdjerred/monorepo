import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { AgentOutput } from "#src/domain/schemas.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";

export async function captureEvidence(input: {
  output: AgentOutput;
  checkout: string;
  prNumber: number;
  githubEnv: Readonly<Record<string, string>>;
  paths: RuntimePaths;
  identifier: string;
  run: CommandRunner;
  capture: (input: {
    outputDirectory: string;
    outputName: string;
    packageName: string;
    route: string;
    waitForSelector?: string | undefined;
  }) => Promise<void>;
}): Promise<string[]> {
  if (input.output.visualTargets.length === 0) return [];
  const directory = path.join(
    input.paths.root,
    "evidence",
    input.identifier.toLowerCase(),
  );
  await mkdir(directory, { recursive: true });
  const markdown: string[] = [];
  for (const target of input.output.visualTargets) {
    const destination = path.join(directory, `${target.name}.png`);
    await input.capture({
      outputDirectory: directory,
      outputName: `${target.name}.png`,
      packageName: target.package,
      route: target.route,
      ...(target.waitForSelector === undefined
        ? {}
        : { waitForSelector: target.waitForSelector }),
    });
    const trustedPath = path.join(
      directory,
      `.trusted-${crypto.randomUUID()}.png`,
    );
    requireSuccess(
      "Visual evidence regular-file check",
      await input.run(["/usr/bin/test", "-f", destination]),
    );
    const symlink = await input.run(["/usr/bin/test", "-L", destination]);
    if (symlink.exitCode === 0) {
      throw new Error("visual evidence must not be a symlink");
    }
    if (symlink.exitCode !== 1)
      requireSuccess("Visual evidence symlink check", symlink);
    const bytes = new Uint8Array(await Bun.file(destination).arrayBuffer());
    if (
      bytes.length < 8 ||
      ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      )
    ) {
      throw new Error("visual evidence is not a PNG");
    }
    await Bun.write(trustedPath, bytes);
    let asset: ReturnType<typeof requireSuccess>;
    try {
      asset = requireSuccess(
        "PR evidence upload",
        await input.run(
          [
            "toolkit",
            "pr",
            "asset",
            String(input.prNumber),
            trustedPath,
            "--profile",
            "seaweedfs",
            "--markdown",
          ],
          { cwd: input.checkout, env: input.githubEnv },
        ),
      );
    } finally {
      await Bun.file(trustedPath).delete();
    }
    markdown.push(asset.stdout.trim());
  }
  return markdown;
}
