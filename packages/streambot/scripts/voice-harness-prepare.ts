import path from "node:path";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { validateVoiceAssets } from "@shepherdjerred/streambot/voice/local-models.ts";

const repositoryRoot = path.resolve(import.meta.dir, "../../..");
const contextDir = path.join(repositoryRoot, ".context");
const targetDir = path.join(contextDir, "streambot-voice-models");

async function hasValidAssets(directory: string): Promise<boolean> {
  try {
    await validateVoiceAssets(directory);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(filename: string): Promise<boolean> {
  try {
    await stat(filename);
    return true;
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      refresh: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(`Prepare pinned Streambot voice models for the macOS probe.

Usage:
  bun run voice:harness:prepare
  bun run voice:harness:prepare --refresh

Assets are written to:
  ${targetDir}`);
    return;
  }
  if (!values.refresh && (await hasValidAssets(targetDir))) {
    console.log(`Voice assets are already prepared at ${targetDir}`);
    return;
  }
  if (!values.refresh && (await pathExists(targetDir))) {
    throw new Error(
      `Voice assets at ${targetDir} are invalid. Re-run with --refresh to replace them.`,
    );
  }
  if (Bun.which("docker") === null) {
    throw new Error(
      "Docker is required to export the pinned voice-model build stage.",
    );
  }

  await mkdir(contextDir, { recursive: true });
  const temporaryDir = await mkdtemp(
    path.join(contextDir, "streambot-voice-models-build-"),
  );
  const backupDir = `${targetDir}.backup-${crypto.randomUUID()}`;
  let movedExisting = false;
  try {
    const subprocess = Bun.spawn(
      [
        "docker",
        "buildx",
        "build",
        "--target",
        "voice-model-export",
        "--output",
        `type=local,dest=${temporaryDir}`,
        "-f",
        "packages/streambot/Dockerfile",
        ".",
      ],
      {
        cwd: repositoryRoot,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const exitCode = await subprocess.exited;
    if (exitCode !== 0) {
      throw new Error(
        `Voice-model Docker export failed with code ${String(exitCode)}.`,
      );
    }
    await validateVoiceAssets(temporaryDir);
    if (await pathExists(targetDir)) {
      await rename(targetDir, backupDir);
      movedExisting = true;
    }
    await rename(temporaryDir, targetDir);
    if (movedExisting) await rm(backupDir, { recursive: true, force: true });
    console.log(`Prepared checksum-verified voice assets at ${targetDir}`);
  } catch (error) {
    if (movedExisting && !(await pathExists(targetDir))) {
      await rename(backupDir, targetDir);
    }
    await rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

await main().catch((error: unknown) => {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
