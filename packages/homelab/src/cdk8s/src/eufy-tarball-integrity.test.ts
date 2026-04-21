import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import versions, { EUFY_TARBALL_SHA256 } from "./versions.ts";

/**
 * Eufy tarball integrity check.
 *
 * The Home Assistant init container verifies the `fuatakgun/eufy_security`
 * release tarball against `EUFY_TARBALL_SHA256` before extracting it onto the
 * config PVC. If those two values diverge, the init container fails with a
 * sha256 mismatch and the pod gets stuck in `Init:CrashLoopBackOff`.
 *
 * Renovate bumps the version string automatically but cannot refresh the hash,
 * so this test exists to force any version bump PR to also update the hash --
 * a mismatch here fails CI long before the broken values reach the cluster.
 *
 * CI-only: requires network access. Gate with the same environment the other
 * network tests in this package use (BUILDKITE / CI / explicit opt-in).
 */

const shouldRun =
  Bun.env["CI"] === "true" ||
  Bun.env["BUILDKITE"] === "true" ||
  Bun.env["EUFY_TARBALL_TEST"] === "1";

const describeFn = shouldRun ? describe : describe.skip;

describeFn("fuatakgun/eufy_security tarball integrity", () => {
  it("recorded SHA-256 matches the actual GitHub release tarball", async () => {
    const version = versions["fuatakgun/eufy_security"];
    const url = `https://github.com/fuatakgun/eufy_security/archive/refs/tags/${version}.tar.gz`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${String(response.status)} ${response.statusText}`,
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");

    expect(actual).toBe(EUFY_TARBALL_SHA256);
  }, 120_000);
});
