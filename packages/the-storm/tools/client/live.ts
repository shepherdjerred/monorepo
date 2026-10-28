import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  request,
  socketReady,
  StatusSchema,
  waitFor,
  type Session,
} from "./protocol.ts";

const root = path.resolve(import.meta.dirname, "../..");
const prism = "/Applications/Prism Launcher.app/Contents/MacOS/prismlauncher";
const instances = path.join(
  os.homedir(),
  "Library/Application Support/PrismLauncher/instances",
);
const fabricVersion = "0.165.0+26.3";

/** Launch an isolated Prism instance with the existing authenticated account. */
export async function live(): Promise<void> {
  const build = Bun.spawn(
    [
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      path.join(root, "client"),
      "assemble",
      "--console=plain",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await build.exited) !== 0) throw new Error("Client build failed");
  const fabricRoot = path.join(
    os.homedir(),
    ".gradle/caches/modules-2/files-2.1/net.fabricmc.fabric-api/fabric-api",
    fabricVersion,
  );
  const matches = [
    ...new Bun.Glob("*/*.jar").scanSync({ cwd: fabricRoot, absolute: true }),
  ].filter((name) => name.endsWith(`fabric-api-${fabricVersion}.jar`));
  if (matches.length !== 1)
    throw new Error("Expected one pinned Fabric API jar in the Gradle cache");
  const fabric = matches[0];
  if (fabric === undefined) throw new Error("Missing Fabric API jar");
  const privateDir = await mkdtemp(path.join(os.tmpdir(), "storm-live-"));
  await chmod(privateDir, 0o700);
  const instance = await mkdtemp(path.join(instances, "storm-capture-"));
  const artifacts = path.join(root, ".cache/client", path.basename(privateDir));
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  const session: Session = {
    socket: path.join(privateDir, "client.sock"),
    control: path.join(privateDir, "client.sock"),
    artifacts,
    server: "mc.ts-mc.net:30000",
  };
  let child: ReturnType<typeof Bun.spawn> | undefined;
  const { promise: interrupted, resolve: interrupt } =
    Promise.withResolvers<undefined>();
  let stopping = false;
  const onSignal = () => {
    stopping = true;
    interrupt(undefined);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const { control: _control, ...bootstrap } = session;
    const bootstrapPath = path.join(privateDir, "bootstrap.json");
    await Bun.write(bootstrapPath, JSON.stringify(bootstrap));
    await chmod(bootstrapPath, 0o600);
    await Bun.write(
      path.join(artifacts, "session.json"),
      JSON.stringify(session),
    );
    await chmod(path.join(artifacts, "session.json"), 0o600);
    const base = path.join(instances, "26.3");
    await copyFile(
      path.join(base, "mmc-pack.json"),
      path.join(instance, "mmc-pack.json"),
    );
    const original = await readFile(path.join(base, "instance.cfg"), "utf8");
    const cfg = original
      .split("\n")
      .filter((line) => !/^(?:name|OverrideJavaArgs|JvmArgs)=/u.test(line))
      .join("\n");
    await Bun.write(
      path.join(instance, "instance.cfg"),
      cfg.replace(
        "[General]",
        `[General]\nname=Storm Capture\nOverrideJavaArgs=true\nJvmArgs=-Dstorm.client.session=${bootstrapPath}`,
      ),
    );
    const mods = path.join(instance, "minecraft", "mods");
    await mkdir(mods, { recursive: true });
    await Bun.write(
      path.join(instance, "minecraft", "options.txt"),
      "tutorialStep:none\n",
    );
    await copyFile(fabric, path.join(mods, "fabric-api.jar"));
    await copyFile(
      path.join(root, "client/build/libs/the-storm-client-1.0.0.jar"),
      path.join(mods, "storm-client.jar"),
    );
    child = Bun.spawn(
      [prism, "--launch", path.basename(instance), "--profile", "XiguaJerred"],
      { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
    );
    await waitFor(
      "authenticated live client",
      async () => {
        if (stopping) throw new Error("Live client interrupted");
        if (child?.exitCode !== null)
          throw new Error(
            "Prism exited before the live client connected; check account sign-in and launcher state",
          );
        return (
          (await socketReady(session.socket)) &&
          StatusSchema.parse(await request(session, "status")).connected
        );
      },
      Boolean,
      180_000,
    );
    process.stdout.write(
      `Live client ready. Session: ${path.join(artifacts, "session.json")}\n`,
    );
    await Promise.race([child.exited, interrupted]);
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    if (child?.exitCode === null) {
      await request(session, "shutdown").catch(() => child?.kill("SIGTERM"));
      await child.exited;
    }
    await rm(instance, { recursive: true, force: true });
    await rm(privateDir, { recursive: true, force: true });
  }
}
