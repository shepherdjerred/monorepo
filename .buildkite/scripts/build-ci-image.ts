import { builderCreateCommand, ciImageBuildCommand } from "./migration-core.ts";

async function execute(command: readonly string[]): Promise<number> {
  const child = Bun.spawn([...command], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

if (import.meta.main) {
  const commit = Bun.env["BUILDKITE_COMMIT"];
  if (commit === undefined) throw new Error("BUILDKITE_COMMIT is required");
  const inspect = await execute(["docker", "buildx", "inspect", "ci"]);
  if (inspect !== 0 && (await execute(builderCreateCommand)) !== 0) {
    throw new Error("Could not create the remote BuildKit builder");
  }
  for (const [image, dockerfile] of [
    ["ghcr.io/shepherdjerred/ci-base", ".buildkite/ci-image/Dockerfile"],
    [
      "ghcr.io/shepherdjerred/ci-playwright",
      ".buildkite/ci-playwright/Dockerfile",
    ],
  ] as const) {
    const build = await execute(ciImageBuildCommand(image, dockerfile, commit));
    if (build !== 0) throw new Error(`CI image build failed for ${image}`);
  }
}
