import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClientLauncher } from "./client-launch.ts";
import { ownPrismGame } from "./prism-lifetime.ts";

/** Owns an isolated instance; account credentials stay inside Prism. */
export const prismLauncher: ClientLauncher = async (spec) => {
  if (process.platform !== "darwin")
    throw new Error("Authenticated capture currently requires macOS and Prism");
  const instances = path.join(
    os.homedir(),
    "Library/Application Support/PrismLauncher/instances",
  );
  const instance = await mkdtemp(path.join(instances, "storm-capture-"));
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
        "assemble",
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
    const fabricVersion = "0.165.0+26.3";
    const cache = path.join(
      os.homedir(),
      ".gradle/caches/modules-2/files-2.1/net.fabricmc.fabric-api/fabric-api",
      fabricVersion,
    );
    const jars = [
      ...new Bun.Glob(`*/fabric-api-${fabricVersion}.jar`).scanSync({
        cwd: cache,
        absolute: true,
      }),
    ];
    const [fabric] = jars;
    if (fabric === undefined || jars.length !== 1)
      throw new Error("Expected exactly one pinned Fabric API jar");
    await copyFile(
      path.join(instances, "26.3/mmc-pack.json"),
      path.join(instance, "mmc-pack.json"),
    );
    const original = await readFile(
      path.join(instances, "26.3/instance.cfg"),
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
    const mods = path.join(instance, "minecraft/mods");
    await mkdir(mods, { recursive: true });
    await Bun.write(
      path.join(instance, "minecraft/options.txt"),
      "onboardAccessibility:false\ntutorialStep:none\n",
    );
    await copyFile(fabric, path.join(mods, "fabric-api.jar"));
    await copyFile(
      path.join(
        spec.repoRoot,
        "packages/the-storm/client/build/libs/the-storm-client-1.0.0.jar",
      ),
      path.join(mods, "storm-client.jar"),
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
