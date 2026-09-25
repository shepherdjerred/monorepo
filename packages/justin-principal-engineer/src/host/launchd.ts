import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { Config } from "#src/domain/schemas.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";
import { writeInfo } from "#src/runtime/output.ts";

const LABEL = "com.sjerred.justin-principal-engineer";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderLaunchAgent(input: {
  bun: string;
  cli: string;
  checkout: string;
  path: string;
  linearApiKeyReference: string;
  woodpeckerTokenReference: string;
  pinchtabConfigPath: string;
  stdout: string;
  stderr: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>LINEAR_API_KEY=${escapeXml(input.linearApiKeyReference)}</string>
    <string>WOODPECKER_TOKEN=${escapeXml(input.woodpeckerTokenReference)}</string>
    <string>PINCHTAB_CONFIG=${escapeXml(input.pinchtabConfigPath)}</string>
    <string>op</string>
    <string>run</string>
    <string>--</string>
    <string>${escapeXml(input.bun)}</string>
    <string>${escapeXml(input.cli)}</string>
    <string>reconcile</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(input.checkout)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(input.path)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <!-- This package is a local macOS operator tool, not a hosted workload;
       its requested first iteration intentionally has no Temporal worker. -->
  <key>StartInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(input.stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(input.stderr)}</string>
</dict>
</plist>
`;
}

export class LaunchdService {
  private readonly domain = `gui/${String(process.getuid?.() ?? 0)}`;

  public constructor(
    private readonly paths: RuntimePaths,
    private readonly run: CommandRunner,
  ) {}

  public async isLoaded(): Promise<boolean> {
    const result = await this.run([
      "launchctl",
      "print",
      `${this.domain}/${LABEL}`,
    ]);
    return result.exitCode === 0;
  }

  public async install(config: Config): Promise<void> {
    if (config.repository.stableCheckout.includes("/.herdr/worktrees/")) {
      throw new Error(
        "Refusing to install launchd from a temporary Herdr worktree",
      );
    }
    const cli = path.join(
      config.repository.stableCheckout,
      "packages/justin-principal-engineer/src/cli.ts",
    );
    const cliExists = await Bun.file(cli).exists();
    if (!cliExists) {
      throw new Error(`Runner entrypoint does not exist at ${cli}`);
    }
    const bun = requireSuccess(
      "Locate Bun",
      await this.run(["which", "bun"]),
    ).stdout.trim();
    const processPath = Bun.env["PATH"];
    if (processPath === undefined || processPath.trim() === "") {
      throw new Error("PATH is required to install the LaunchAgent");
    }
    await Promise.all([
      mkdir(path.dirname(this.paths.launchAgent), { recursive: true }),
      mkdir(this.paths.logs, { recursive: true }),
    ]);
    await Bun.write(
      this.paths.launchAgent,
      renderLaunchAgent({
        bun,
        cli,
        checkout: config.repository.stableCheckout,
        path: processPath,
        linearApiKeyReference: config.linear.apiKey,
        woodpeckerTokenReference: config.woodpecker.apiToken,
        pinchtabConfigPath: config.pinchtab.configPath,
        stdout: path.join(this.paths.logs, "stdout.log"),
        stderr: path.join(this.paths.logs, "stderr.log"),
      }),
    );
    if (await this.isLoaded()) await this.stop();
    await this.start();
    writeInfo(`Installed ${this.paths.launchAgent}`);
  }

  public async start(): Promise<void> {
    if (await this.isLoaded()) {
      requireSuccess(
        "Kickstart LaunchAgent",
        await this.run([
          "launchctl",
          "kickstart",
          "-k",
          `${this.domain}/${LABEL}`,
        ]),
      );
      return;
    }
    const launchAgentExists = await Bun.file(this.paths.launchAgent).exists();
    if (!launchAgentExists) {
      throw new Error("LaunchAgent is not installed");
    }
    requireSuccess(
      "Bootstrap LaunchAgent",
      await this.run([
        "launchctl",
        "bootstrap",
        this.domain,
        this.paths.launchAgent,
      ]),
    );
  }

  public async stop(): Promise<void> {
    if (!(await this.isLoaded())) return;
    requireSuccess(
      "Stop LaunchAgent",
      await this.run(["launchctl", "bootout", `${this.domain}/${LABEL}`]),
    );
  }

  public async status(): Promise<void> {
    const loaded = await this.isLoaded();
    writeInfo(`${LABEL}: ${loaded ? "loaded" : "stopped"}`);
    writeInfo(`LaunchAgent: ${this.paths.launchAgent}`);
    writeInfo(`Logs: ${this.paths.logs}`);
  }

  public async uninstall(): Promise<void> {
    await this.stop();
    await rm(this.paths.launchAgent, { force: true });
    writeInfo(`Removed ${this.paths.launchAgent}; task state was preserved`);
  }
}
