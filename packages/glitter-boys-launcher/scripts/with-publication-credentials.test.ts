import { expect, test } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("release children receive resolved credentials without the vault token", async () => {
  const scratch = await mkdtemp(
    path.join(os.tmpdir(), "glitter-credential-test-"),
  );
  try {
    const entry = path.join(scratch, "inspect.ts");
    await Bun.write(
      entry,
      `console.log(JSON.stringify({token: Boolean(Bun.env.OP_SERVICE_ACCOUNT_TOKEN), key: Bun.env.SEAWEEDFS_SITES_ACCESS_KEY_ID, secret: Bun.env.SEAWEEDFS_SITES_SECRET_ACCESS_KEY})); process.exit(process.argv[2] === "47" ? 47 : 0);`,
    );
    const baseEnv = {
      ...process.env,
      OP_SERVICE_ACCOUNT_TOKEN: "test-vault-token",
    };
    Reflect.deleteProperty(baseEnv, "SEAWEEDFS_SITES_ACCESS_KEY_ID");
    Reflect.deleteProperty(baseEnv, "SEAWEEDFS_SITES_SECRET_ACCESS_KEY");
    const invoke = async (
      env: Record<string, string | undefined>,
      args: string[],
    ) => {
      const child = Bun.spawn(
        [
          process.execPath,
          path.join(import.meta.dir, "with-publication-credentials.ts"),
          entry,
          ...args,
        ],
        { env, stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, code };
    };
    const supplied = await invoke(
      {
        ...baseEnv,
        SEAWEEDFS_SITES_ACCESS_KEY_ID: "test-key",
        SEAWEEDFS_SITES_SECRET_ACCESS_KEY: "test-secret",
      },
      ["47"],
    );
    expect(supplied.code).toBe(47);
    expect(JSON.parse(supplied.stdout)).toEqual({
      token: false,
      key: "test-key",
      secret: "test-secret",
    });
    const dryRun = await invoke(baseEnv, ["--dry-run"]);
    expect(dryRun.code).toBe(0);
    expect(JSON.parse(dryRun.stdout)).toEqual({ token: false });
    const partial = await invoke(
      { ...baseEnv, SEAWEEDFS_SITES_ACCESS_KEY_ID: "test-key" },
      [],
    );
    expect(partial.code).not.toBe(0);
    expect(partial.stdout).toBe("");
    expect(partial.stderr).toContain(
      "Both static-site publication credentials must be injected together",
    );
  } finally {
    const resolved = await realpath(scratch);
    if (
      path.dirname(resolved) !== (await realpath(os.tmpdir())) ||
      !path.basename(resolved).startsWith("glitter-credential-test-")
    )
      throw new Error("Unexpected test directory");
    await rm(resolved, { recursive: true });
  }
});
