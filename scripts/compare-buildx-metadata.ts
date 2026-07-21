#!/usr/bin/env bun

import { z } from "zod";

const EngineVersionSchema = z.looseObject({ Version: z.string().min(1) });

const BuildxMetadataSchema = z
  .object({
    mode: z.enum(["docker-container", "containerd-default"]),
    builder: z.string().min(1),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    benchmarkId: z.string().min(1),
    imageVersion: z.string().min(1),
    readCache: z.literal(false),
    buildxVersion: z.string().min(1),
    builderDetails: z.string().min(1),
    dockerVersion: z.looseObject({
      Client: EngineVersionSchema,
      Server: EngineVersionSchema,
    }),
    dockerInfo: z.record(z.string(), z.unknown()),
  })
  .strict();

type BuildxMetadata = z.infer<typeof BuildxMetadataSchema>;

function controlledSignature(metadata: BuildxMetadata): string {
  return JSON.stringify({
    commit: metadata.commit,
    benchmarkId: metadata.benchmarkId,
    imageVersion: metadata.imageVersion,
    readCache: metadata.readCache,
    buildxVersion: metadata.buildxVersion,
    dockerClientVersion: metadata.dockerVersion.Client.Version,
    dockerServerVersion: metadata.dockerVersion.Server.Version,
  });
}

function validateGroup(
  inputs: unknown[],
  expectedMode: BuildxMetadata["mode"],
  label: string,
): BuildxMetadata[] {
  if (inputs.length === 0) {
    throw new Error(`${label} metadata group is empty`);
  }
  const parsed = inputs.map((input) => BuildxMetadataSchema.parse(input));
  if (parsed.some((metadata) => metadata.mode !== expectedMode)) {
    throw new Error(`${label} metadata has an unexpected Buildx mode`);
  }
  const signatures = new Set(
    parsed.map((metadata) => controlledSignature(metadata)),
  );
  if (signatures.size !== 1) {
    throw new Error(
      `${label} fixtures do not share one controlled environment`,
    );
  }
  return parsed;
}

export function compareBuildxMetadata(
  baselineInputs: unknown[],
  candidateInputs: unknown[],
): void {
  if (baselineInputs.length !== candidateInputs.length) {
    throw new Error("Buildx baseline and candidate metadata counts differ");
  }
  const baseline = validateGroup(
    baselineInputs,
    "docker-container",
    "baseline",
  );
  const candidate = validateGroup(
    candidateInputs,
    "containerd-default",
    "candidate",
  );
  const baselineFirst = baseline[0];
  const candidateFirst = candidate[0];
  if (baselineFirst === undefined || candidateFirst === undefined) {
    throw new Error("Buildx metadata group unexpectedly became empty");
  }
  if (
    controlledSignature(baselineFirst) !== controlledSignature(candidateFirst)
  ) {
    throw new Error(
      "Buildx baseline and candidate do not share one controlled environment",
    );
  }
}

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await Bun.file(path).text());
}

async function main(): Promise<void> {
  const baselinePaths: string[] = [];
  const candidatePaths: string[] = [];
  const args = Bun.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const path = args[index + 1];
    if (
      path === undefined ||
      (flag !== "--baseline" && flag !== "--candidate")
    ) {
      throw new Error(
        "Usage: compare-buildx-metadata.ts --baseline <json>... --candidate <json>...",
      );
    }
    (flag === "--baseline" ? baselinePaths : candidatePaths).push(path);
  }
  compareBuildxMetadata(
    await Promise.all(baselinePaths.map((path) => loadJson(path))),
    await Promise.all(candidatePaths.map((path) => loadJson(path))),
  );
  console.log(
    "Buildx baseline and candidate metadata are controlled and valid",
  );
}

if (import.meta.main) {
  await main();
}
