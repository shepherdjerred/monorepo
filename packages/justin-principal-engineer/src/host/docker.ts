import path from "node:path";

import {
  AgentOutputSchema,
  AgentTurnInputSchema,
  type AgentOutput,
  type Config,
  type Provider,
} from "#src/domain/schemas.ts";
import { checkOpenAi } from "#src/integrations/preflight.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";
import { writeInfo } from "#src/runtime/output.ts";
import { verificationCommand } from "#src/host/verification.ts";

const RESULT_PREFIX = "JPE_RESULT:";

export class WorkspaceVerificationFailure extends Error {}

export function dockerRunnerSource(
  sourcePackage: string | undefined,
): string[] {
  return sourcePackage === undefined
    ? []
    : [
        "--volume",
        `${path.join(sourcePackage, "src")}:/jpe-runner/src:ro`,
        "--volume",
        `${path.join(sourcePackage, "package.json")}:/jpe-runner/package.json:ro`,
      ];
}

export function dockerRunnerCommand(
  sourcePackage: string | undefined,
): string[] {
  return sourcePackage === undefined
    ? ["bun", "run", "--cwd", "packages/justin-principal-engineer", "container"]
    : [
        "sh",
        "-c",
        "ln -s /workspace/packages/justin-principal-engineer/node_modules /jpe-runner/node_modules && exec bun /jpe-runner/src/container-entry.ts",
      ];
}

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
    path.join(config.repository.stableCheckout, "ci/ci-image/DIGEST"),
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
    private readonly sourcePackage?: string,
  ) {}

  public async verifyWorkspace(
    checkout: string,
    paths: readonly string[],
  ): Promise<string[]> {
    const command = await verificationCommand({
      checkout,
      paths,
      baseBranch: this.config.repository.baseBranch,
      run: this.run,
    });
    const image = await dockerImage(this.config);
    const containerName = `jpe-verify-${crypto.randomUUID()}`;
    const args = [
      "docker",
      "run",
      "--rm",
      "--platform",
      this.config.docker.platform,
      "--name",
      containerName,
      "--workdir",
      "/workspace",
      ...dockerWorkspaceMounts(checkout),
      image,
    ];
    writeInfo(`[verification] Running ${command.join(" ")}`);
    try {
      requireSuccess(
        "Verification dependency install",
        await this.run([...args, "bun", "install", "--frozen-lockfile"], {
          timeoutMs: 10 * 60_000,
        }),
      );
      const result = await this.run([...args, ...command], {
        timeoutMs: this.config.docker.turnTimeoutMinutes * 60_000,
      });
      if (result.exitCode !== 0) {
        throw new WorkspaceVerificationFailure(
          `Host workspace verification ${result.timedOut ? "timed out" : "failed"}:\n${(result.stdout + "\n" + result.stderr).slice(-60_000)}`,
        );
      }
      return [`PASSED: ${command.join(" ")}`];
    } finally {
      const cleanup = await this.run(
        ["docker", "rm", "--force", containerName],
        { timeoutMs: 60_000 },
      );
      if (
        cleanup.exitCode !== 0 &&
        !cleanup.stderr.includes("No such container")
      )
        requireSuccess("Verification container cleanup", cleanup);
    }
  }

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
    onStart?: () => Promise<void>;
  }): Promise<AgentOutput> {
    const credential = {
      name: "OPENAI_API_KEY",
      value: await checkOpenAi(this.config, this.run),
      model: this.config.agents.codex.model,
    };
    if (this.sourcePackage !== undefined) {
      for (const relative of ["package.json", "src/container-entry.ts"]) {
        if (
          !(await Bun.file(path.join(this.sourcePackage, relative)).exists())
        ) {
          throw new Error(`Local runner source is missing ${relative}`);
        }
      }
    }
    const image = await dockerImage(this.config);
    if (this.sourcePackage !== undefined)
      writeInfo("[agent] Installing Linux task dependencies");
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
    if (this.sourcePackage !== undefined)
      writeInfo("[agent] Building task dependencies");
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
          this.sourcePackage === undefined
            ? "--filter=@shepherdjerred/justin-principal-engineer"
            : "--filter=@shepherdjerred/justin-principal-engineer^...",
        ],
        { timeoutMs: 10 * 60_000 },
      ),
    );

    await input.onStart?.();
    const containerName = `jpe-${crypto.randomUUID()}`;
    if (this.sourcePackage !== undefined)
      writeInfo(
        `[agent] Running Codex with local source (${credential.model})`,
      );
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
          ...dockerRunnerSource(this.sourcePackage),
          "--env",
          credential.name,
          image,
          ...dockerRunnerCommand(this.sourcePackage),
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
