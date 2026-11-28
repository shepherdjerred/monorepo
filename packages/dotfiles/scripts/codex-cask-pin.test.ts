import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";

const codexWrapperSource = path.resolve(
  import.meta.dir,
  "../dot_local/share/agent-bin/executable_codex",
);
const agentExecSource = path.resolve(
  import.meta.dir,
  "../dot_local/share/agent-bin/executable_agent-exec",
);

const temporaryDirectories: string[] = [];
const backgroundProcesses: Bun.Subprocess[] = [];

afterEach(async () => {
  while (backgroundProcesses.length > 0) {
    const proc = backgroundProcesses.pop();
    if (proc !== undefined) {
      proc.kill();
      await proc.exited;
    }
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const ReportSchema = z.object({
  exePath: z.string(),
  hostOutput: z.string(),
  agentCli: z.string().nullable(),
  aiAgent: z.string().nullable(),
  args: z.array(z.string()),
});

async function writeFakeCaskVersion(
  caskRoot: string,
  version: string,
  bunPath: string,
): Promise<string> {
  const versionDir = path.join(caskRoot, version);
  const binDir = path.join(versionDir, "bin");
  await mkdir(binDir, { recursive: true });

  const hostPath = path.join(binDir, "codex-code-mode-host");
  await Bun.write(hostPath, `#!/bin/sh\nprintf 'host-ok:%s' '${version}'\n`);
  await chmod(hostPath, 0o755);

  const runnerScript = path.join(versionDir, "runner.mjs");
  await Bun.write(
    runnerScript,
    [
      'import { realpathSync, rmSync } from "node:fs";',
      'import path from "node:path";',
      'import { spawnSync } from "node:child_process";',
      "const exePath = realpathSync(process.env.FAKE_CODEX_ARGV0);",
      "if (process.env.HOLD_OPEN_MS) {",
      '  console.log("ready");',
      "  setTimeout(() => process.exit(0), Number(process.env.HOLD_OPEN_MS));",
      "} else {",
      "  if (process.env.SIMULATE_CASK_UPGRADE_REMOVE) {",
      "    rmSync(process.env.SIMULATE_CASK_UPGRADE_REMOVE, { recursive: true, force: true });",
      "  }",
      '  const siblingHost = path.join(path.dirname(exePath), "codex-code-mode-host");',
      '  const res = spawnSync(siblingHost, [], { encoding: "utf8" });',
      "  if (res.status !== 0) {",
      "    process.stderr.write(`failed to spawn code-mode host ${siblingHost}: ${String(res.error ?? res.stderr)}`);",
      "    process.exit(1);",
      "  }",
      "  process.stdout.write(JSON.stringify({",
      "    exePath,",
      "    hostOutput: res.stdout,",
      "    agentCli: process.env.AGENT_CLI ?? null,",
      "    aiAgent: process.env.AI_AGENT ?? null,",
      "    args: process.argv.slice(2),",
      "  }));",
      "}",
      "",
    ].join("\n"),
  );

  const codexBin = path.join(binDir, "codex");
  await Bun.write(
    codexBin,
    `#!/bin/sh\nFAKE_CODEX_ARGV0="$0" exec "${bunPath}" "$(dirname "$0")/../runner.mjs" "$@"\n`,
  );
  await chmod(codexBin, 0o755);
  return versionDir;
}

describe("codex Caskroom runtime pinning (AI-791)", () => {
  test("clones Caskroom runtime before exec so mid-session brew upgrades keep codex-code-mode-host alive and reaps only unreferenced versions", async () => {
    const rawRoot = await mkdtemp(path.join(tmpdir(), "codex-cask-pin-"));
    temporaryDirectories.push(rawRoot);
    const root = await realpath(rawRoot);

    const homeDir = path.join(root, "home");
    const wrapperDir = path.join(root, "agent-bin");
    const brewBinDir = path.join(root, "homebrew", "bin");
    const caskRoot = path.join(root, "homebrew", "Caskroom", "codex");
    await Promise.all([
      mkdir(homeDir, { recursive: true }),
      mkdir(wrapperDir, { recursive: true }),
      mkdir(brewBinDir, { recursive: true }),
      mkdir(caskRoot, { recursive: true }),
    ]);

    const wrapperCodex = path.join(wrapperDir, "codex");
    const wrapperAgentExec = path.join(wrapperDir, "agent-exec");
    await Bun.write(wrapperCodex, await Bun.file(codexWrapperSource).text());
    await Bun.write(wrapperAgentExec, await Bun.file(agentExecSource).text());
    await Promise.all([
      chmod(wrapperCodex, 0o755),
      chmod(wrapperAgentExec, 0o755),
    ]);

    const bunPath = Bun.which("bun") ?? process.execPath;
    const v0168Dir = await writeFakeCaskVersion(caskRoot, "0.168.0", bunPath);
    const v0169Dir = await writeFakeCaskVersion(caskRoot, "0.169.0", bunPath);
    const v0171Dir = await writeFakeCaskVersion(caskRoot, "0.171.0", bunPath);

    const brewSymlink = path.join(brewBinDir, "codex");
    await symlink(path.join(v0168Dir, "bin", "codex"), brewSymlink);

    const baseEnv = {
      ...Bun.env,
      HOME: homeDir,
      PATH: [
        wrapperDir,
        brewBinDir,
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        path.dirname(bunPath),
      ].join(":"),
    };

    // 1. Launch 0.168.0 and let it exit so its pinned directory becomes unreferenced.
    const first = Bun.spawnSync(["/bin/sh", wrapperCodex, "prompt-1"], {
      env: baseEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(first.exitCode).toBe(0);
    const firstReport = ReportSchema.parse(JSON.parse(first.stdout.toString()));
    expect(firstReport.hostOutput).toBe("host-ok:0.168.0");
    expect(firstReport.agentCli).toBe("codex");
    expect(firstReport.aiAgent).toBe("codex");
    expect(firstReport.exePath).toBe(
      path.join(homeDir, ".local/state/codex-cask/0.168.0/bin/codex"),
    );

    // 2. Upgrade symlink to 0.169.0 and hold a live 0.169.0 session open.
    await rm(brewSymlink);
    await symlink(path.join(v0169Dir, "bin", "codex"), brewSymlink);

    const held0169 = Bun.spawn(["/bin/sh", wrapperCodex], {
      env: { ...baseEnv, HOLD_OPEN_MS: "30000" },
      stdout: "pipe",
      stderr: "pipe",
    });
    backgroundProcesses.push(held0169);

    const reader = held0169.stdout.getReader();
    const firstChunk = await reader.read();
    reader.releaseLock();
    expect(new TextDecoder().decode(firstChunk.value)).toContain("ready");

    // 0.168.0 had no live process so launching 0.169.0 reaped it.
    expect(
      await Bun.file(
        path.join(homeDir, ".local/state/codex-cask/0.168.0/bin/codex"),
      ).exists(),
    ).toBe(false);

    // 3. Simulate mid-session `brew upgrade`: delete 0.169.0 from Caskroom and point brew symlink at 0.171.0,
    // AND delete 0.171.0 from Caskroom AFTER 0.171.0 starts up before spawning codex-code-mode-host!
    await rm(v0169Dir, { recursive: true, force: true });
    await rm(brewSymlink);
    await symlink(path.join(v0171Dir, "bin", "codex"), brewSymlink);

    const upgraded = Bun.spawnSync(["/bin/sh", wrapperCodex, "prompt-2"], {
      env: {
        ...baseEnv,
        SIMULATE_CASK_UPGRADE_REMOVE: v0171Dir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(upgraded.exitCode).toBe(0);
    const upgradedReport = ReportSchema.parse(
      JSON.parse(upgraded.stdout.toString()),
    );
    expect(upgradedReport.hostOutput).toBe("host-ok:0.171.0");
    expect(upgradedReport.exePath).toBe(
      path.join(homeDir, ".local/state/codex-cask/0.171.0/bin/codex"),
    );

    // Live 0.169.0 session's pinned codex-code-mode-host MUST still exist despite Caskroom removal!
    expect(
      await Bun.file(
        path.join(
          homeDir,
          ".local/state/codex-cask/0.169.0/bin/codex-code-mode-host",
        ),
      ).exists(),
    ).toBe(true);

    // 4. Stop 0.169.0, restore 0.171.0 in Caskroom, launch once more -> 0.169.0 is now reaped.
    held0169.kill();
    await held0169.exited;
    await writeFakeCaskVersion(caskRoot, "0.171.0", bunPath);
    const cleanupRun = Bun.spawnSync(["/bin/sh", wrapperCodex, "prompt-3"], {
      env: baseEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(cleanupRun.exitCode).toBe(0);
    expect(
      await Bun.file(
        path.join(homeDir, ".local/state/codex-cask/0.169.0/bin/codex"),
      ).exists(),
    ).toBe(false);
  });
});
