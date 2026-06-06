import { mkdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const imageTag = Bun.env["BIRMEL_DOCKER_IMAGE"] ?? "birmel-openclaw-e2e:local";
const volumeName = `birmel-openclaw-e2e-${Date.now().toString()}`;

async function run(command: string[], cwd = repoRoot): Promise<string> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exited] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exited !== 0) {
    throw new Error(
      [`Command failed: ${command.join(" ")}`, stdout, stderr]
        .filter((part) => part.length > 0)
        .join("\n\n"),
    );
  }
  return stdout;
}

async function buildImageIfNeeded(): Promise<void> {
  if (Bun.env["BIRMEL_DOCKER_IMAGE"] != null) {
    return;
  }
  const imageTar = path.join(repoRoot, ".tmp", "birmel-openclaw-e2e.tar");
  await mkdir(path.dirname(imageTar), { recursive: true });
  await run([
    "dagger",
    "call",
    "build-image",
    "--pkg-dir",
    "./packages/birmel",
    "--pkg",
    "birmel",
    "--dep-names",
    "eslint-config,llm-observability",
    "--dep-dirs",
    "./packages/eslint-config",
    "--dep-dirs",
    "./packages/llm-observability",
    "export",
    "--path",
    imageTar,
  ]);
  const loaded = await run(["docker", "load", "--input", imageTar]);
  if (!loaded.includes(imageTag)) {
    await run([
      "docker",
      "tag",
      loaded.trim().split(/\s+/).at(-1) ?? imageTag,
      imageTag,
    ]);
  }
}

async function runPhase(phase: "setup" | "verify"): Promise<void> {
  await run([
    "docker",
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    "--volume",
    `${volumeName}:/workspace/packages/birmel/data`,
    "--volume",
    `${path.join(repoRoot, "packages/birmel/e2e")}:/workspace/packages/birmel/e2e:ro`,
    "--env",
    "DISCORD_TOKEN=e2e-token",
    "--env",
    "DISCORD_CLIENT_ID=e2e-client",
    "--env",
    "OPENAI_API_KEY=e2e-openai",
    "--env",
    "ANTHROPIC_API_KEY=dummy",
    "--env",
    "DATABASE_URL=file:/workspace/packages/birmel/data/openclaw-e2e.db",
    "--env",
    "MEMORY_DB_PATH=file:/workspace/packages/birmel/data/openclaw-memory.db",
    "--env",
    "BIRMEL_MOCK_DISCORD_DELIVERY=true",
    "--env",
    "BROWSER_PROVIDER=pinchtab",
    "--env",
    "PINCHTAB_BASE_URL=http://localhost:9867",
    "--env",
    "PINCHTAB_PROFILE=birmel-e2e",
    imageTag,
    "-lc",
    `bun run generate && bunx --trust prisma db push --accept-data-loss && bun e2e/openclaw-capabilities-container.ts ${phase}`,
  ]);
}

await buildImageIfNeeded();
await run(["docker", "volume", "create", volumeName]);
try {
  await runPhase("setup");
  await runPhase("verify");
} finally {
  await run(["docker", "volume", "rm", volumeName]);
}
