import path from "node:path";
import { resolveMise } from "./mise.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const mise = await resolveMise();
const resolved = Bun.spawnSync([mise, "where", "dotnet"], {
  cwd: repositoryRoot,
  stdout: "pipe",
  stderr: "inherit",
});
if (resolved.exitCode !== 0) {
  throw new Error(
    `mise where dotnet exited with status ${String(resolved.exitCode)}; run mise install at the repository root.`,
  );
}
const dotnetRoot = new TextDecoder().decode(resolved.stdout).trim();
const dotnet = path.join(
  dotnetRoot,
  process.platform === "win32" ? "dotnet.exe" : "dotnet",
);
if (!(await Bun.file(dotnet).exists())) {
  throw new Error(`mise resolved a .NET installation without ${dotnet}.`);
}
const argumentsList = Bun.argv.slice(2);
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
    // CultureInfo's static initializer before it runs any command. The abort
    // is inside the dotnet CLI host itself, so no csproj or runtimeconfig
    // property can prevent it -- only this variable can. Every culture-
    // sensitive call in this package already pins InvariantCulture, and this
    // configures the build tooling's own runtime rather than the shipped
    // app's, so the packaged Windows client keeps full globalization.
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1",
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
