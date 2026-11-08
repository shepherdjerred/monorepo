import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { ClientLauncher } from "./client-launch.ts";
import { ownPrismGame } from "./prism-lifetime.ts";
import { preparePrismInstance } from "./prism.ts";

/** Owns an isolated instance; account credentials stay inside Prism. */
export const prismLauncher: ClientLauncher = async (spec) => {
  if (process.platform !== "darwin")
    throw new Error("Authenticated capture currently requires macOS and Prism");
  const instances = path.join(
    os.homedir(),
    "Library/Application Support/PrismLauncher/instances",
  );
  const instanceName = `storm-capture-${randomUUID()}`;
  const instance = path.join(instances, instanceName);
  const awake = Bun.spawn(["/usr/bin/caffeinate", "-du"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    const build = Bun.spawn(
      [
        "mise",
        "exec",
        "--",
        "gradle",
        "-p",
        path.join(spec.repoRoot, "packages/the-storm/client"),
        "stagePrism",
        "--console=plain",
      ],
      {
        stdout: Bun.file(spec.logPath),
        stderr: Bun.file(spec.logPath),
        env: {
          ...Bun.env,
          OP_SERVICE_ACCOUNT_TOKEN: undefined,
          MC_BRIDGE_TOKEN: undefined,
        },
      },
    );
    if ((await build.exited) !== 0)
      throw new Error(`Client build failed; inspect ${spec.logPath}`);
    await preparePrismInstance({
      root: path.dirname(instances),
      stagedMods: path.join(
        spec.repoRoot,
        "packages/the-storm/client/build/prism-mods",
      ),
      bootstrap: spec.bootstrapPath,
      instanceName,
    });
    const original = await readFile(
      path.join(instance, "instance.cfg"),
      "utf8",
    );
    const cfg = original
      .split("\n")
      .filter(
        (line) =>
          !/^(?:name|OverrideJavaArgs|JvmArgs|OverrideMemory|MinMemAlloc|MaxMemAlloc|LowMemWarning)=/u.test(
            line,
          ),
      )
      .join("\n");
    await Bun.write(
      path.join(instance, "instance.cfg"),
      cfg.replace(
        "[General]",
        `[General]\nname=Storm Capture\nOverrideMemory=true\nMinMemAlloc=512\nMaxMemAlloc=2048\nLowMemWarning=false\nOverrideJavaArgs=true\nJvmArgs=-Dstorm.client.session=${spec.bootstrapPath}`,
      ),
    );
    await Bun.write(
      path.join(instance, "minecraft/options.txt"),
      "onboardAccessibility:false\ntutorialStep:none\n",
    );
    const child = Bun.spawn(
      [
        "/Applications/Prism Launcher.app/Contents/MacOS/prismlauncher",
        "--launch",
        path.basename(instance),
        "--profile",
        spec.username,
      ],
      {
        stdout: Bun.file(spec.logPath),
        stderr: Bun.file(spec.logPath),
        stdin: "ignore",
        env: {
          ...Bun.env,
          OP_SERVICE_ACCOUNT_TOKEN: undefined,
          MC_BRIDGE_TOKEN: undefined,
        },
      },
    );
    return ownPrismGame(
      spec,
      {
        pid: child.pid,
        exited: child.exited,
        exitCode: () => child.exitCode,
        kill: (signal) => {
          child.kill(signal);
        },
      },
      async (completed) => {
        awake.kill();
        if (completed) await rm(instance, { recursive: true, force: true });
      },
    );
  } catch (error) {
    awake.kill();
    await rm(instance, { recursive: true, force: true });
    throw error;
  }
};
