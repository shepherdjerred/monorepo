import path from "node:path";

import {
  AgentOutputSchema,
  AgentTurnInputSchema,
  type AgentOutput,
  type Config,
  type Provider,
} from "#src/domain/schemas.ts";
import { readOpReference } from "#src/integrations/secrets.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";

const RESULT_PREFIX = "JPE_RESULT:";

export function dockerWorkspaceMounts(checkout: string): string[] {
  return [
    "--volume",
    `${checkout}:/workspace`,
    "--volume",
    `${path.join(checkout, ".git")}:/workspace/.git:ro`,
  ];
}

async function dockerImage(config: Config): Promise<string> {
  if (config.docker.image !== undefined) return config.docker.image;
  const digestText = await Bun.file(
    path.join(config.repository.stableCheckout, ".buildkite/ci-image/DIGEST"),
  ).text();
  const digest = digestText.trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error("The pinned CI base image digest is invalid");
  }
  return `ghcr.io/shepherdjerred/ci-base@${digest}`;
}

export class DockerAgentRunner {
  public constructor(
    private readonly config: Config,
    private readonly run: CommandRunner,
  ) {}

  public async captureScreenshot(input: {
    checkout: string;
    outputDirectory: string;
    outputName: string;
    packageName: string;
    route: string;
    waitForSelector?: string | undefined;
  }): Promise<void> {
    const image = await dockerImage(this.config);
    const serverName = `jpe-screenshot-${crypto.randomUUID()}`;
    const serverArgs = [
      "docker",
      "run",
      "--detach",
      "--name",
      serverName,
      "--platform",
      this.config.docker.platform,
      "--network",
      "host",
      "--workdir",
      "/workspace",
      ...dockerWorkspaceMounts(input.checkout),
      "--volume",
      `${this.config.repository.stableCheckout}:/trusted:ro`,
      image,
      "bun",
      "run",
      "/trusted/packages/toolkit/src/index.ts",
      "screenshot-server",
      input.packageName,
    ];
    try {
      requireSuccess(
        "Sandboxed visual verification server",
        await this.run(serverArgs, { timeoutMs: 60_000 }),
      );
      const baseUrl = await this.waitForScreenshotServer(serverName);
      const outputPath = `/jpe-evidence/${input.outputName}`;
      const args = [
        "docker",
        "run",
        "--rm",
        "--platform",
        this.config.docker.platform,
        "--network",
        "host",
        "--workdir",
        "/trusted",
        "--volume",
        `${this.config.repository.stableCheckout}:/trusted:ro`,
        "--volume",
        `${input.outputDirectory}:/jpe-evidence`,
      ];
      const pinchtabEnv: Record<string, string> = {};
      for (const name of [
        "PINCHTAB_BASE_URL",
        "PINCHTAB_TOKEN",
        "PINCHTAB_PROFILE",
      ]) {
        const value = Bun.env[name];
        if (value !== undefined) {
          args.push("--env", name);
          pinchtabEnv[name] = value;
        }
      }
      const pinchtabConfig = Bun.env["PINCHTAB_CONFIG"];
      if (pinchtabConfig !== undefined) {
        args.push(
          "--volume",
          `${pinchtabConfig}:/root/.pinchtab/config.json:ro`,
          "--env",
          "PINCHTAB_CONFIG=/root/.pinchtab/config.json",
        );
      }
      args.push(
        image,
        "bun",
        "run",
        "/trusted/packages/toolkit/src/index.ts",
        "screenshot",
        input.packageName,
        input.route,
        "--base-url",
        baseUrl,
        "--out",
        outputPath,
        ...(input.waitForSelector === undefined
          ? []
          : ["--wait-for-selector", input.waitForSelector]),
        "--json",
      );
      requireSuccess(
        "Sandboxed visual verification",
        await this.run(args, {
          env: pinchtabEnv,
          timeoutMs: 10 * 60_000,
        }),
      );
    } finally {
      const cleanup = await this.run(["docker", "rm", "--force", serverName], {
        timeoutMs: 60_000,
      });
      if (
        cleanup.exitCode !== 0 &&
        !cleanup.stderr.includes("No such container")
      ) {
        requireSuccess("Sandboxed visual verification cleanup", cleanup);
      }
    }
  }

  private async waitForScreenshotServer(serverName: string): Promise<string> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const logs = await this.run(["docker", "logs", serverName]);
      const ready = logs.stdout
        .split("\n")
        .find((line) => line.startsWith("JPE_SCREENSHOT_SERVER_READY:"));
      if (ready !== undefined) {
        const baseUrl = ready.slice("JPE_SCREENSHOT_SERVER_READY:".length);
        if (/^https?:\/\/\S+$/.test(baseUrl)) return baseUrl;
        throw new Error("Screenshot server emitted an invalid base URL");
      }
      if (logs.exitCode !== 0) {
        throw new Error(
          `Screenshot server exited before readiness: ${logs.stderr.trim()}`,
        );
      }
      await Bun.sleep(250);
    }
    throw new Error("Screenshot server did not become ready within 60 seconds");
  }

  public async runTurn(input: {
    checkout: string;
    provider: Provider;
    prompt: string;
  }): Promise<AgentOutput> {
    const image = await dockerImage(this.config);
    requireSuccess(
      "Container dependency install",
      await this.run(
        [
          "docker",
          "run",
          "--rm",
          "--platform",
          this.config.docker.platform,
          "--workdir",
          "/workspace",
          ...dockerWorkspaceMounts(input.checkout),
          image,
          "bun",
          "install",
          "--frozen-lockfile",
        ],
        { timeoutMs: 10 * 60_000 },
      ),
    );
    requireSuccess(
      "Container dependency build",
      await this.run(
        [
          "docker",
          "run",
          "--rm",
          "--platform",
          this.config.docker.platform,
          "--workdir",
          "/workspace",
          ...dockerWorkspaceMounts(input.checkout),
          image,
          "bunx",
          "turbo",
          "run",
          "build",
          "--filter=@shepherdjerred/justin-principal-engineer",
        ],
        { timeoutMs: 10 * 60_000 },
      ),
    );

    const credential = {
      name: "OPENAI_API_KEY",
      value: await readOpReference(
        this.config.agents.codex.openAiApiKey,
        this.run,
      ),
      model: this.config.agents.codex.model,
    };
    const containerName = `jpe-${crypto.randomUUID()}`;
    try {
      const result = await this.run(
        [
          "docker",
          "run",
          "--rm",
          "--interactive",
          "--platform",
          this.config.docker.platform,
          "--name",
          containerName,
          "--workdir",
          "/workspace",
          ...dockerWorkspaceMounts(input.checkout),
          "--env",
          credential.name,
          image,
          "bun",
          "run",
          "--cwd",
          "packages/justin-principal-engineer",
          "container",
        ],
        {
          env: { [credential.name]: credential.value },
          stdin: JSON.stringify(
            AgentTurnInputSchema.parse({
              provider: input.provider,
              model: credential.model,
              prompt: input.prompt,
            }),
          ),
          timeoutMs: this.config.docker.turnTimeoutMinutes * 60_000,
          graceMs: 15_000,
        },
      );
      requireSuccess("Agent container", result);
      const line = result.stdout
        .split("\n")
        .findLast((candidate) => candidate.startsWith(RESULT_PREFIX));
      if (line === undefined) {
        throw new Error("Agent container did not emit a structured result");
      }
      return AgentOutputSchema.parse(
        JSON.parse(line.slice(RESULT_PREFIX.length)),
      );
    } finally {
      const cleanup = await this.run(
        ["docker", "rm", "--force", containerName],
        {
          timeoutMs: 60_000,
        },
      );
      if (
        cleanup.exitCode !== 0 &&
        !cleanup.stderr.includes("No such container")
      ) {
        requireSuccess("Agent container cleanup", cleanup);
      }
    }
  }
}
