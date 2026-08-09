#!/usr/bin/env bun

export type ArtifactDownloadRunner = (
  artifactName: string,
  sourceStep: string,
) => Promise<number>;

function requiredArgument(index: number, name: string): string {
  const value = Bun.argv[index];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function metadata(key: string): Promise<string> {
  const child = Bun.spawn(
    ["buildkite-agent", "meta-data", "get", key, "--default", "{}"],
    { stdout: "pipe", stderr: "inherit" },
  );
  const valueText = await new Response(child.stdout).text();
  const value = valueText.trim();
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`could not read metadata ${key}`);
  return value;
}

export function artifactNameFromMetadata(value: string): string | undefined {
  if (!value.startsWith("artifact:")) return undefined;
  const name = value.slice("artifact:".length);
  if (!/^\w[\w.-]*\.json$/.test(name)) {
    throw new Error(`invalid Buildkite handoff artifact pointer ${name}`);
  }
  return name;
}

async function downloadArtifact(name: string, step: string): Promise<number> {
  const child = Bun.spawn(
    ["buildkite-agent", "artifact", "download", name, ".", "--step", step],
    { stdout: "inherit", stderr: "inherit" },
  );
  return child.exited;
}

export async function readHandoffValue(
  value: string,
  sourceStep: string,
  downloader: ArtifactDownloadRunner = downloadArtifact,
): Promise<string> {
  const name = artifactNameFromMetadata(value);
  if (name === undefined) return `${value}\n`;
  if ((await downloader(name, sourceStep)) !== 0) {
    throw new Error(`could not download Buildkite handoff artifact ${name}`);
  }
  return Bun.file(name).text();
}

async function main(): Promise<void> {
  const key = requiredArgument(2, "metadata key");
  const step = requiredArgument(3, "source step key");
  const value = await metadata(key);
  process.stdout.write(await readHandoffValue(value, step));
}

if (import.meta.main) await main();
