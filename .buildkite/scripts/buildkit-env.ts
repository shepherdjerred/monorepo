import { registryLoginCommand } from "./build-ci-image-core.ts";

if (import.meta.main) {
  const token = Bun.env["GH_TOKEN"];
  const command = registryLoginCommand(token);
  if (command !== undefined && token !== undefined) {
    const login = Bun.spawn(command, {
      stdin: new Blob([token]),
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await login.exited;
    if (exitCode !== 0)
      throw new Error(`docker login exited ${exitCode.toString()}`);
  }
}
