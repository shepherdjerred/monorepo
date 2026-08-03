import { afterEach, describe, expect, test } from "bun:test";
import {
  sandboxProfile,
  sanitizedEnvironment,
  setupEnvironment,
  setupSandboxProfile,
} from "@shepherdjerred/pr-fleet-controller/src/sandbox.ts";
import { SETUP_COMMANDS } from "@shepherdjerred/pr-fleet-controller/src/tools.ts";

describe("validation sandbox profile", () => {
  const worktree = "/tmp/pr-fleet-worktree";
  const profile = sandboxProfile(worktree);

  test("denies reads and network by default and allows the assigned worktree", () => {
    expect(profile).toContain("(deny default)");
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain(`(allow file-read* (subpath "${worktree}"))`);
    expect(profile).toContain(`(allow file-write* (subpath "${worktree}"))`);
  });

  test("does not grant a blanket read of the /private hierarchy", () => {
    // The whole /private tree holds same-user temp and app-cache data whose
    // contents would be exfiltrated through tool output.
    expect(profile).not.toContain('(allow file-read* (subpath "/private"))');
    // But the /etc target (CA certs, host config) is allowed.
    expect(profile).toContain('(allow file-read* (subpath "/private/etc"))');
  });

  test("never grants a read of home credential stores", () => {
    // Home is not blanket-readable; only toolchain caches are. A credential
    // store must not appear anywhere in the read allowlist.
    for (const secret of [".aws", ".ssh", ".config/gh", ".git-credentials"]) {
      expect(profile).not.toContain(`${secret}"))`);
    }
  });

  test("scopes home caches to specific tool directories, not whole caches", () => {
    // ~/.cache and ~/Library/Caches hold arbitrary application caches; only the
    // specific toolchain cache directories are readable.
    expect(profile).not.toContain('/.cache"))');
    expect(profile).not.toContain('/Library/Caches"))');
    expect(profile).toContain('/.cache/mise"))');
    expect(profile).toContain('/.cache/go-build"))');
  });

  test("rejects a worktree path that could break out of the profile string", () => {
    expect(() => sandboxProfile('/tmp/"; (allow default)')).toThrow();
  });
});

describe("credential env scrubbing", () => {
  afterEach(() => {
    delete Bun.env["LLM_ACCESS"];
    delete Bun.env["OPENAI_API_KEY"];
  });

  test("strips a configured api-key-env name the heuristic does not match", () => {
    Bun.env["LLM_ACCESS"] = "sk-secret";
    Bun.env["OPENAI_API_KEY"] = "sk-heuristic";

    // Without the configured name, the arbitrarily-named key survives (proving
    // the heuristic misses it), while the conventional name is always stripped.
    const heuristicOnly = sanitizedEnvironment();
    expect(heuristicOnly["LLM_ACCESS"]).toBe("sk-secret");
    expect(heuristicOnly["OPENAI_API_KEY"]).toBeUndefined();

    // Passing the configured name removes it from validation and setup envs.
    expect(sanitizedEnvironment(["LLM_ACCESS"])["LLM_ACCESS"]).toBeUndefined();
    const miseConfig = "/tmp/pr-fleet-worktree/.mise.toml";
    const setup = setupEnvironment(["LLM_ACCESS"], miseConfig);
    expect(setup["LLM_ACCESS"]).toBeUndefined();
    expect(setup["GIT_CONFIG_GLOBAL"]).toBe("/dev/null");
    expect(setup["MISE_PARANOID"]).toBe("1");
    expect(setup["MISE_TRUSTED_CONFIG_PATHS"]).toBe(miseConfig);
  });
});

describe("setup sandbox write scope", () => {
  const worktree = "/tmp/pr-fleet/stack-1";
  const profile = setupSandboxProfile(worktree, {
    gitCommonDir: "/tmp/checkout/.git",
    gitDir: "/tmp/checkout/.git/worktrees/stack-1",
    checkoutRoot: "/tmp/checkout",
  });
  const home = Bun.env["HOME"] ?? "";

  test("allows the bun module cache but denies toolchain binary/install dirs", () => {
    expect(profile).toContain(
      `(allow file-write* (subpath "${home}/.bun/install/cache"))`,
    );
    // The persistence vectors — toolchain bin/install dirs — are NOT writable.
    expect(profile).not.toContain(
      `(allow file-write* (subpath "${home}/.bun"))`,
    );
    expect(profile).not.toContain(
      `(allow file-write* (subpath "${home}/.cargo"))`,
    );
    expect(profile).not.toContain(
      `(allow file-write* (subpath "${home}/.local/share/mise"))`,
    );
  });

  test("still permits network and denies the operator's credential stores", () => {
    expect(profile).toContain("(allow network*)");
    expect(profile).toContain(`(deny file-read* (subpath "${home}"))`);
  });

  test("never runs persistent trust for PR-controlled mise configuration", () => {
    expect(
      SETUP_COMMANDS.some(
        (command) =>
          command.executable === "mise" && command.args.includes("trust"),
      ),
    ).toBe(false);
  });
});
