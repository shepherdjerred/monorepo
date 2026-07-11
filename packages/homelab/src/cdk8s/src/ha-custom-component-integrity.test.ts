import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HA_CUSTOM_COMPONENTS } from "./resources/home/ha-custom-components.ts";

/**
 * HA custom-component tarball integrity check.
 *
 * The Home Assistant init containers verify each pinned custom-component/plugin
 * release tarball against its recorded SHA-256 before extracting it onto the
 * config PVC. If a component's version and hash diverge, its init container
 * fails with a sha256 mismatch and the pod gets stuck in `Init:CrashLoopBackOff`.
 *
 * Renovate bumps each version string automatically but cannot refresh the
 * matching hash, so this test exists to force any version-bump PR to also
 * update the hash -- a mismatch here fails CI long before the broken values
 * reach the cluster. For components with checked-in patches (eufy_security,
 * mysa), this also re-verifies each patch still applies cleanly against the
 * freshly-verified pristine source, so a version bump that shifts a patch's
 * context fails CI instead of crash-looping the pod.
 *
 * CI-only: requires network access. Gate with the same environment the other
 * network tests in this package use (BUILDKITE / CI / explicit opt-in).
 */

const shouldRun =
  Bun.env["CI"] === "true" ||
  Bun.env["BUILDKITE"] === "true" ||
  Bun.env["HA_CUSTOM_COMPONENT_TARBALL_TEST"] === "1";

const describeFn = shouldRun ? describe : describe.skip;

async function applyPatchesDryRun(
  extractedDir: string,
  slug: string,
  patchFiles: string[],
): Promise<void> {
  for (const patchFile of patchFiles) {
    const patchPath = path.join(import.meta.dir, "../patches", slug, patchFile);
    const proc = Bun.spawn(["patch", "-p1", "--dry-run", "-d", extractedDir], {
      stdin: Bun.file(patchPath),
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `[${slug}] patch ${patchFile} failed to apply (dry-run) against the pinned tarball:\n${stderr}`,
      );
    }
  }
}

describeFn("HA custom-component tarball integrity", () => {
  for (const spec of HA_CUSTOM_COMPONENTS) {
    it(`${spec.repo}: recorded SHA-256 (${spec.sha256ConstName}) matches the actual GitHub release tarball`, async () => {
      const url = `https://github.com/${spec.repo}/archive/refs/tags/${spec.version}.tar.gz`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `[${spec.repo}] Failed to fetch ${url}: ${String(response.status)} ${response.statusText}`,
        );
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const actual = createHash("sha256").update(bytes).digest("hex");

      expect(actual).toBe(spec.sha256);

      if (spec.install.kind !== "custom_components" || !spec.install.patches) {
        return;
      }

      const extractedDir = await mkdtemp(path.join(tmpdir(), "ha-component-"));
      try {
        const tarProc = Bun.spawn(
          ["tar", "-xz", "-C", extractedDir, "--strip-components=1"],
          { stdin: "pipe", stderr: "pipe" },
        );
        await tarProc.stdin.write(bytes);
        await tarProc.stdin.end();
        const tarExit = await tarProc.exited;
        if (tarExit !== 0) {
          const stderr = await new Response(tarProc.stderr).text();
          throw new Error(
            `[${spec.repo}] Failed to extract tarball: ${stderr}`,
          );
        }

        await applyPatchesDryRun(
          extractedDir,
          spec.install.slug,
          spec.install.patches,
        );
      } finally {
        await rm(extractedDir, { recursive: true, force: true });
      }
    }, 120_000);
  }
});
