import path from "node:path";

import type { Config } from "#src/domain/schemas.ts";
import { createGitHubAuth } from "#src/integrations/github-app.ts";
import { readOpReference } from "#src/integrations/secrets.ts";
import { LinearClient } from "#src/integrations/linear.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";
import { writeInfo } from "#src/runtime/output.ts";

const REQUIRED_LABELS = [
  "agent:ready",
  "agent:codex",
  "agent:needs-human",
] as const;

export async function doctor(input: {
  config: Config;
  paths: RuntimePaths;
  run: CommandRunner;
}): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("The first iteration supports macOS only");
  }
  if (input.config.repository.stableCheckout.includes("/.herdr/worktrees/")) {
    throw new Error("The configured checkout is a temporary Herdr worktree");
  }
  const configExists = await Bun.file(input.paths.config).exists();
  if (!configExists) throw new Error(`Missing ${input.paths.config}`);
  for (const executable of [
    "bun",
    "docker",
    "gh",
    "git",
    "git-spice",
    "lockf",
    "op",
    "toolkit",
  ]) {
    requireSuccess(
      `Required executable ${executable}`,
      await input.run(["which", executable]),
    );
  }
  requireSuccess("Docker daemon", await input.run(["docker", "info"]));
  requireSuccess(
    "Stable checkout",
    await input.run(["git", "rev-parse", "--show-toplevel"], {
      cwd: input.config.repository.stableCheckout,
    }),
  );
  const digestText = await Bun.file(
    path.join(
      input.config.repository.stableCheckout,
      ".buildkite/ci-image/DIGEST",
    ),
  ).text();
  const digest = digestText.trim();
  if (
    input.config.docker.image === undefined &&
    !/^sha256:[0-9a-f]{64}$/.test(digest)
  ) {
    throw new Error(
      "The stable checkout does not have a valid CI image digest",
    );
  }
  const image =
    input.config.docker.image ?? `ghcr.io/shepherdjerred/ci-base@${digest}`;
  requireSuccess(
    "Docker agent image",
    await input.run(
      [
        "docker",
        "run",
        "--rm",
        "--platform",
        input.config.docker.platform,
        image,
        "bun",
        "--version",
      ],
      { timeoutMs: 10 * 60_000 },
    ),
  );

  const linearApiKey = await readOpReference(
    input.config.linear.apiKey,
    input.run,
  );
  const linear = new LinearClient(input.config.linear.team, input.run, {
    LINEAR_API_KEY: linearApiKey,
  });
  const labels = await linear.labelNames();
  const missing = REQUIRED_LABELS.filter((label) => !labels.has(label));
  if (missing.length > 0) {
    throw new Error(`Missing Linear labels: ${missing.join(", ")}`);
  }

  await Promise.all([
    readOpReference(input.config.buildkite.apiToken, input.run),
    readOpReference(input.config.agents.codex.openAiApiKey, input.run),
  ]);
  const github = await createGitHubAuth(input.config, input.paths, input.run);
  try {
    requireSuccess(
      "GitHub App repository access",
      await input.run(
        ["gh", "api", `repos/${input.config.repository.slug}`, "--silent"],
        { env: github.env },
      ),
    );
  } finally {
    await github.cleanup();
  }
  writeInfo(
    "Doctor passed: macOS, tools, Docker, Linear, 1Password, and GitHub App are ready",
  );
}
