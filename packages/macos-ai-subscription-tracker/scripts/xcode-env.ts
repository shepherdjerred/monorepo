import { join, resolve } from "node:path";

export const DEFAULT_XCODE_DEVELOPER_DIR =
  "/Applications/Xcode.app/Contents/Developer";
export const SOURCEKIT_RELATIVE_PATH =
  "Toolchains/XcodeDefault.xctoolchain/usr/lib/sourcekitdInProc.framework/Versions/A/sourcekitdInProc";

export type XcodeEnvironmentOptions = {
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fileExists?: (filePath: string) => Promise<boolean> | boolean;
};

export async function resolveXcodeEnvironment(
  options: XcodeEnvironmentOptions = {},
): Promise<Record<string, string | undefined>> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? Bun.env;
  if (platform !== "darwin") {
    return { ...env };
  }

  const fileExists =
    options.fileExists ?? ((filePath: string) => Bun.file(filePath).exists());
  const explicitDeveloperDir = env.DEVELOPER_DIR?.trim() ?? "";

  if (explicitDeveloperDir.length > 0) {
    const explicitSourceKit = join(
      explicitDeveloperDir,
      SOURCEKIT_RELATIVE_PATH,
    );
    if (await fileExists(explicitSourceKit)) {
      return { ...env, DEVELOPER_DIR: explicitDeveloperDir };
    }
    throw new Error(
      `DEVELOPER_DIR='${explicitDeveloperDir}' does not include SourceKit (${explicitSourceKit}). Point DEVELOPER_DIR to a full Xcode installation such as ${DEFAULT_XCODE_DEVELOPER_DIR} (Command Line Tools omit XcodeDefault.xctoolchain's sourcekitdInProc.framework).`,
    );
  }

  const defaultSourceKit = join(
    DEFAULT_XCODE_DEVELOPER_DIR,
    SOURCEKIT_RELATIVE_PATH,
  );
  if (await fileExists(defaultSourceKit)) {
    return { ...env, DEVELOPER_DIR: DEFAULT_XCODE_DEVELOPER_DIR };
  }

  throw new Error(
    `Full Xcode with SourceKit is required on macOS (missing ${defaultSourceKit}). Install Xcode at /Applications/Xcode.app or set DEVELOPER_DIR to a valid Contents/Developer directory.`,
  );
}

async function main(): Promise<void> {
  const rawArgs = Bun.argv.slice(2);
  const command = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  const [executable, ...rest] = command;
  if (executable === undefined) {
    throw new Error("A command is required for xcode-env.ts.");
  }
  const env = await resolveXcodeEnvironment();
  const packageRoot = resolve(import.meta.dir, "..");
  const child = Bun.spawn([executable, ...rest], {
    cwd: packageRoot,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await child.exited);
}

if (import.meta.main) {
  await main();
}
