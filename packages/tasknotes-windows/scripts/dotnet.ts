import path from "node:path";
import { resolveDotnetExecutable } from "./mise.ts";

const HELP_FLAGS = new Set(["--help", "-h", "-?"]);

/**
 * Under .NET 10's Microsoft.Testing.Platform, `dotnet test ... -- --help`
 * leaves `dotnet test`'s internal help state unset while forwarding `--help`
 * to the test executable over IPC, causing `TestApplication` to crash with
 * `Environment.FailFast` (exit 134). Lifting the help flag before `--` lets
 * `dotnet test` enter help mode and query extension options cleanly.
 */
export function normalizeDotnetArgs(args: readonly string[]): string[] {
  if (args[0] !== "test") {
    return [...args];
  }
  const separatorIndex = args.indexOf("--");
  if (separatorIndex === -1) {
    return [...args];
  }
  const before = args.slice(0, separatorIndex);
  const after = args.slice(separatorIndex + 1);
  const helpFlag = after.find((arg) => HELP_FLAGS.has(arg));
  if (helpFlag === undefined) {
    return [...args];
  }
  const liftedBefore = before.some((arg) => HELP_FLAGS.has(arg))
    ? before
    : [...before, helpFlag];
  const remainingAfter = after.filter((arg) => !HELP_FLAGS.has(arg));
  return remainingAfter.length === 0
    ? liftedBefore
    : [...liftedBefore, "--", ...remainingAfter];
}

async function main(): Promise<void> {
  const packageRoot = path.resolve(import.meta.dir, "..");
  const repositoryRoot = path.resolve(packageRoot, "..", "..");
  const dotnet = await resolveDotnetExecutable(repositoryRoot);
  const dotnetRoot = path.dirname(dotnet);
  const argumentsList = normalizeDotnetArgs(Bun.argv.slice(2));
  if (argumentsList.length === 0) {
    throw new Error("A dotnet command is required.");
  }
  const child = Bun.spawn([dotnet, ...argumentsList], {
    cwd: packageRoot,
    env: {
      ...Bun.env,
      DOTNET_MULTILEVEL_LOOKUP: "0",
      DOTNET_ROOT: dotnetRoot,
      // The Linux CI image carries no libicu, so the SDK aborts during
      // CultureInfo's static initializer before it runs any command. Windows
      // resource tooling requires real locale data and rejects even en-US in
      // invariant mode, so keep the workaround scoped to its intended host.
      ...(process.platform === "linux"
        ? { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1" }
        : {}),
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await child.exited);
}

if (import.meta.main) {
  await main();
}
