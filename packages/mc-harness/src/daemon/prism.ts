import {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { CLIENT_PROJECT } from "#protocol/paths.ts";

const INSTANCE = "StormControl";
const MARKER = "storm-control-owned";

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** Prepare a dedicated instance; Prism retains and uses its own signed-in account. */
export async function preparePrismInstance(options: {
  root?: string;
  stagedMods: string;
  bootstrap: string;
  instanceName?: string;
}): Promise<boolean> {
  if (/\s/u.test(options.bootstrap)) {
    throw new Error("Prism bootstrap path must not contain whitespace");
  }
  const root =
    options.root ??
    path.join(os.homedir(), "Library/Application Support/PrismLauncher");
  const name = z
    .string()
    .regex(/^[\w-]+$/u)
    .parse(options.instanceName ?? INSTANCE);
  const instance = path.join(root, "instances", name);
  const marker = path.join(instance, MARKER);
  const created = !(await exists(instance));
  if (created) {
    await mkdir(path.dirname(instance), { recursive: true, mode: 0o700 });
    await mkdir(instance, { mode: 0o700 });
    await writeFile(marker, "storm-control-v1\n", { flag: "wx", mode: 0o600 });
  } else {
    if (
      !(await exists(marker)) ||
      (await readFile(marker, "utf8")) !== "storm-control-v1\n"
    ) {
      throw new Error(
        `Refusing to overwrite an unmanaged Prism instance: ${instance}`,
      );
    }
  }
  const mods = path.join(instance, "minecraft", "mods");
  await mkdir(mods, { recursive: true, mode: 0o700 });
  const metadata = z
    .strictObject({
      minecraft: z.string().regex(/^[\w.+-]+$/u),
      fabricLoader: z.string().regex(/^[\w.+-]+$/u),
      clientJar: z.string().regex(/^[\w.+-]+\.jar$/u),
    })
    .parse(
      JSON.parse(
        await readFile(path.join(options.stagedMods, "metadata.json"), "utf8"),
      ),
    );
  await copyFile(
    path.join(options.stagedMods, "fabric-api.jar"),
    path.join(mods, "fabric-api.jar"),
  );
  await copyFile(
    path.join(options.stagedMods, metadata.clientJar),
    path.join(mods, "storm-client.jar"),
  );
  await writeFile(
    path.join(instance, "instance.cfg"),
    `[General]\nInstanceType=OneSix\nname=The Storm (controlled)\niconKey=default\nOverrideJavaArgs=true\nJvmArgs=-Dstorm.client.session=${options.bootstrap}\n`,
  );
  await writeFile(
    path.join(instance, "mmc-pack.json"),
    JSON.stringify(
      {
        formatVersion: 1,
        components: [
          {
            uid: "net.minecraft",
            version: metadata.minecraft,
            important: true,
          },
          { uid: "net.fabricmc.fabric-loader", version: metadata.fabricLoader },
        ],
      },
      null,
      2,
    ),
  );
  return created;
}

export const PRISM_INSTANCE = INSTANCE;

async function readLogTail(logPath: string, offset: number) {
  const file = await open(logPath, "r");
  try {
    const info = await file.stat();
    if (info.size < offset) offset = 0;
    const buffer = Buffer.alloc(info.size - offset);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    return {
      text: buffer.toString("utf8", 0, bytesRead),
      offset: offset + bytesRead,
    };
  } finally {
    await file.close();
  }
}

/** Wait for a running Prism process to discover a newly created instance. */
export async function waitForPrismDiscovery(
  logPath: string,
  offset: number,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let pending = "";
  while (Date.now() < deadline) {
    try {
      const tail = await readLogTail(logPath, offset);
      offset = tail.offset;
      pending += tail.text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      if (
        lines.some(
          (line) =>
            line.includes('Loaded instance "The Storm (controlled)"') &&
            line.includes('/instances/StormControl"'),
        )
      )
        return;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    "Prism did not discover the new controlled instance; restart Prism and try again",
  );
}

async function launcherFailure(child: Bun.Subprocess): Promise<never> {
  if ((await child.exited) !== 0)
    throw new Error("Prism Launcher could not start the controlled instance");
  return Promise.withResolvers<never>().promise;
}

export async function stageAndLaunchPrism(options: {
  repoRoot: string;
  artifacts: string;
  bootstrap: string;
}): Promise<{ failure: Promise<never>; pid: number }> {
  // Neither the bridge token nor the 1Password service account reaches Gradle or Prism.
  const env = {
    ...Bun.env,
    MC_BRIDGE_TOKEN: undefined,
    OP_SERVICE_ACCOUNT_TOKEN: undefined,
  };
  const log = Bun.file(path.join(options.artifacts, "build.log"));
  const stage = Bun.spawn(
    [
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      path.join(options.repoRoot, CLIENT_PROJECT),
      "stagePrism",
      "--console=plain",
    ],
    { cwd: options.repoRoot, env, stdout: log, stderr: log },
  );
  if ((await stage.exited) !== 0)
    throw new Error(
      `Prism mod build failed; see ${options.artifacts}/build.log`,
    );
  const prismRoot = path.join(
    os.homedir(),
    "Library/Application Support/PrismLauncher",
  );
  const prismLog = path.join(prismRoot, "logs/PrismLauncher-0.log");
  const running =
    Bun.spawnSync(["pgrep", "-x", "prismlauncher"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0;
  const logInfo =
    running && (await exists(prismLog)) ? await stat(prismLog) : undefined;
  const offset = logInfo?.size ?? 0;
  const created = await preparePrismInstance({
    stagedMods: path.join(options.repoRoot, CLIENT_PROJECT, "build/prism-mods"),
    bootstrap: options.bootstrap,
  });
  if (running && created) await waitForPrismDiscovery(prismLog, offset);
  const launcher = Bun.which("prismlauncher");
  if (launcher === null) throw new Error("Prism Launcher is not installed");
  const child = Bun.spawn([launcher, "--launch", PRISM_INSTANCE], {
    env,
    stdout: "ignore",
    stderr: "ignore",
  });
  return { failure: launcherFailure(child), pid: child.pid };
}
