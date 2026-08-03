import { chmod, lstat, readdir } from "node:fs/promises";
import path from "node:path";
import {
  RunArtifactSchema,
  RunArtifactsSchema,
  type RunArtifact,
  type RunArtifacts,
} from "./run-events.ts";

const PRIVATE_FILE_MODE = 0o600;

async function artifactExists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function describeRunArtifact(file: string): Promise<RunArtifact> {
  if (!(await artifactExists(file))) {
    return { state: "absent" };
  }
  const stats = await lstat(file);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Run artifact is not a regular file: ${file}`);
  }
  const hasher = new Bun.CryptoHasher("sha256");
  let bytes = 0;
  for await (const chunk of Bun.file(file).stream()) {
    hasher.update(chunk);
    bytes += chunk.byteLength;
  }
  return RunArtifactSchema.parse({
    state: "present",
    bytes,
    sha256: hasher.digest("hex"),
  });
}

export async function describeRunArtifacts(paths: {
  mastra: string;
  observability: string;
}): Promise<RunArtifacts> {
  return RunArtifactsSchema.parse({
    mastra: await describeRunArtifact(paths.mastra),
    observability: await describeRunArtifact(paths.observability),
  });
}

async function verifyRunArtifact(
  name: string,
  file: string,
  expected: RunArtifact,
): Promise<void> {
  const actual = await describeRunArtifact(file);
  if (expected.state === "absent") {
    if (actual.state !== "absent") {
      throw new Error(
        `Run artifact ${name} was recorded absent but is present`,
      );
    }
    return;
  }
  if (actual.state === "absent") {
    throw new Error(`Run artifact ${name} is missing`);
  }
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    throw new Error(`Run artifact ${name} does not match its recorded digest`);
  }
}

export async function verifyRunArtifacts(
  paths: { mastra: string; observability: string },
  expected: RunArtifacts,
): Promise<void> {
  await verifyRunArtifact("mastra.db", paths.mastra, expected.mastra);
  await verifyRunArtifact(
    "observability.duckdb",
    paths.observability,
    expected.observability,
  );
}

export async function secureRunArtifactFiles(
  runDirectory: string,
): Promise<void> {
  const entries = await readdir(runDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const artifact = path.join(runDirectory, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Unexpected non-file run artifact: ${artifact}`);
    }
    await chmod(artifact, PRIVATE_FILE_MODE);
  }
}
