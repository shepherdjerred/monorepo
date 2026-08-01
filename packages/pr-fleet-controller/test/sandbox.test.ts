import { describe, expect, test } from "bun:test";
import { sandboxProfile } from "@shepherdjerred/pr-fleet-controller/src/sandbox.ts";

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

  test("rejects a worktree path that could break out of the profile string", () => {
    expect(() => sandboxProfile('/tmp/"; (allow default)')).toThrow();
  });
});
