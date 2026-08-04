import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The semantic config-drift guard run by the Minecraft check-config-drift init
// container (inlined into its command at synth time — see
// minecraft-drift-check.ts). The test drives the script directly against
// fixture trees. It shells out to `yq` exactly as the container does; `yq` is
// provided by the repo toolchain (.mise.toml) both locally and in CI.
const scriptPath = path.join(
  import.meta.dir,
  "minecraft-config-drift-check.sh",
);

let root: string;

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(root, "tree-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

async function runGuard(
  ...pairs: string[]
): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["sh", scriptPath, ...pairs], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
  ]);
  return { code, stdout };
}

describe("minecraft-config-drift-check.sh", () => {
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "mc-drift-"));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes when a YAML file is only reformatted (reindent + quote flip)", async () => {
    // The exact class of change mcMMO/Bukkit YamlConfiguration makes on load:
    // 2-space → 4-space indentation and double → single quotes.
    const src = tree({
      "mcMMO/config.yml": 'General:\n  Enabled: true\n  Name: "mcMMO"\n',
    });
    const dest = tree({
      "mcMMO/config.yml": "General:\n    Enabled: true\n    Name: 'mcMMO'\n",
    });
    const { code, stdout } = await runGuard(src, dest);
    expect(stdout).toContain("OK reformatted");
    expect(code).toBe(0);
  });

  it("passes when a YAML file differs only by trailing whitespace / missing EOF newline", async () => {
    const src = tree({ "CoreProtect/config.yml": "donation-key:\nport: 80\n" });
    // trailing space after the null key + no trailing newline (SnakeYAML style)
    const dest = tree({ "CoreProtect/config.yml": "donation-key: \nport: 80" });
    const { code, stdout } = await runGuard(src, dest);
    expect(stdout).toContain("OK reformatted");
    expect(code).toBe(0);
  });

  it("passes when a JSON file differs only by key order / no trailing newline", async () => {
    const src = tree({
      "LuckPerms/contexts.json": '{\n  "a": {},\n  "b": {}\n}\n',
    });
    const dest = tree({ "LuckPerms/contexts.json": '{"b":{},"a":{}}' });
    const { code, stdout } = await runGuard(src, dest);
    expect(stdout).toContain("OK reformatted");
    expect(code).toBe(0);
  });

  it("passes when a text file differs only by line endings (CRLF vs LF)", async () => {
    const src = tree({
      "GravesX/placeholders.txt": "%uuid% - id\n%owner% - o\n",
    });
    const dest = tree({
      "GravesX/placeholders.txt": "%uuid% - id\r\n%owner% - o\r\n",
    });
    const { code, stdout } = await runGuard(src, dest);
    expect(stdout).toContain("OK reformatted");
    expect(code).toBe(0);
  });

  it("passes when the destination file does not exist yet (fresh PVC)", async () => {
    const src = tree({ "Sleeper/config.yml": "SleepInfo: hi\n" });
    const dest = tree({}); // empty dest tree — file not seeded yet
    const { code } = await runGuard(src, dest);
    expect(code).toBe(0);
  });

  it("fails (exit 1) and names the file when a YAML value really changes", async () => {
    const src = tree({ "Essentials/config.yml": "teleport-cooldown: 5\n" });
    const dest = tree({ "Essentials/config.yml": "teleport-cooldown: 60\n" });
    const { code, stdout } = await runGuard(src, dest);
    expect(code).toBe(1);
    expect(stdout).toContain("DRIFT DETECTED");
    expect(stdout).toContain("Essentials/config.yml");
  });

  it("fails (exit 1) when a JSON value really changes", async () => {
    const src = tree({ "LuckPerms/contexts.json": '{"a": 1}\n' });
    const dest = tree({ "LuckPerms/contexts.json": '{"a": 2}\n' });
    const { code, stdout } = await runGuard(src, dest);
    expect(code).toBe(1);
    expect(stdout).toContain("contexts.json");
  });

  it("fails (exit 1) when a text file's real content changes", async () => {
    const src = tree({ "GravesX/placeholders.txt": "line one\n" });
    const dest = tree({ "GravesX/placeholders.txt": "line two\n" });
    const { code, stdout } = await runGuard(src, dest);
    expect(code).toBe(1);
    expect(stdout).toContain("placeholders.txt");
  });

  it("ignores a real change in a runtime-owned file (spigot.yml)", async () => {
    // Paper bumps spigot.yml's config-version on upgrade — a real value change
    // that must NOT crash-loop the pod.
    const src = tree({ "spigot.yml": "config-version: 12\n" });
    const dest = tree({ "spigot.yml": "config-version: 13\n" });
    const { code, stdout } = await runGuard(src, dest);
    expect(code).toBe(0);
    expect(stdout).toContain("IGNORED (runtime-modified): ./spigot.yml");
  });

  it("fails (exit 1) when a managed file is malformed on the volume", async () => {
    const src = tree({ "Vault/config.yml": "a: 1\n" });
    // Broken YAML on disk — cannot be verified, so fail safe rather than pass.
    const dest = tree({ "Vault/config.yml": "a: 1\n  b: : :\n- x\n" });
    const { code, stdout } = await runGuard(src, dest);
    expect(code).toBe(1);
    expect(stdout).toContain("Vault/config.yml");
  });

  it("checks multiple (src, dest) tree pairs in one run", async () => {
    // Mirrors production: plugin tree + non-plugin tree. A real change in the
    // second pair must still fail the whole run.
    const pluginSrc = tree({
      "mcMMO/config.yml": "General:\n  Enabled: true\n",
    });
    const pluginDest = tree({
      "mcMMO/config.yml": "General:\n    Enabled: true\n",
    });
    const cfgSrc = tree({ "bukkit.yml": "settings:\n  allow-end: true\n" });
    const cfgDest = tree({ "bukkit.yml": "settings:\n  allow-end: false\n" });
    const { code, stdout } = await runGuard(
      pluginSrc,
      pluginDest,
      cfgSrc,
      cfgDest,
    );
    expect(code).toBe(1);
    expect(stdout).toContain("bukkit.yml");
    // the reformat-only plugin file should have passed
    expect(stdout).toContain("OK reformatted");
  });
});
