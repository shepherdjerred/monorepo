/**
 * A role that does not declare lake access cannot read the lake anyway.
 *
 * The defect this closes was a composition defect, not a query bug. The boot
 * gate in `runtime/subsystems.ts` verifies a published build only for roles
 * whose `reportLakeAccess` is true, so a role that declares `false` and then
 * reads the lake regardless is invisible to it — declaring `false` is what
 * skips the check. The gateway role did exactly that: `/scout ask` and the
 * Dare commands execute the Explore agent in the process that received the
 * interaction, which is a synchronous DuckDB read with no Temporal queue in
 * it, and a lake-less pod answered every question "no games found" and called
 * it a success.
 *
 * The table now says what the gateway does (`runtime-role.test.ts` pins it),
 * so no role sets this false today. That is the intended end state, not a
 * reason to drop the guard — it is what makes the next role's claim true, or
 * makes it fail loudly on the first read instead of answering nothing.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import configuration from "#src/configuration.ts";
import { RuntimeCapabilityError } from "#src/configuration/runtime-capability-error.ts";
import {
  SCOUT_RUNTIME_ROLES,
  scoutRuntimeCapabilities,
} from "#src/configuration/runtime-role.ts";
import { ensureLakeScaffold } from "#src/report-lake/paths.ts";
import {
  assertReportLakeAccess,
  resolveLakeFiles,
} from "#src/reports/duckdb/lake.ts";

const roots: string[] = [];

async function emptyLake(): Promise<string> {
  const lakeDir = await mkdtemp(path.join(tmpdir(), "scout-lake-capability-"));
  roots.push(lakeDir);
  await ensureLakeScaffold(lakeDir);
  return lakeDir;
}

afterAll(async () => {
  for (const root of roots) {
    await rm(root, { force: true, recursive: true });
  }
});

describe("the lake read site", () => {
  test("refuses a role without reportLakeAccess", async () => {
    // Driven through the real `resolveLakeFiles`, because the assertion is
    // only worth anything if it sits on the path every reader takes.
    const lakeDir = await emptyLake();
    await expect(
      resolveLakeFiles(lakeDir, { reportLakeAccess: false }),
    ).rejects.toBeInstanceOf(RuntimeCapabilityError);
  });

  test("names the capability it refused on", async () => {
    const lakeDir = await emptyLake();
    await expect(
      resolveLakeFiles(lakeDir, { reportLakeAccess: false }),
    ).rejects.toMatchObject({ capability: "reportLakeAccess" });
  });

  test("refuses BEFORE touching the directory, so an absent lake is not the signal", async () => {
    // A missing directory must not be what makes this fail: the whole problem
    // is that a missing directory does NOT fail, it returns zero rows.
    await expect(
      resolveLakeFiles("/nonexistent/lake/for/a/roleless/pod", {
        reportLakeAccess: false,
      }),
    ).rejects.toBeInstanceOf(RuntimeCapabilityError);
  });

  test("allows a role that declares it, even with nothing published yet", async () => {
    // Absence stays the boot gate's business; this guard is about the claim.
    const lakeDir = await emptyLake();
    const files = await resolveLakeFiles(lakeDir, { reportLakeAccess: true });
    expect(files.matchesParquet).toEqual([]);
  });

  test("defaults to this process's own declared capabilities", async () => {
    const lakeDir = await emptyLake();
    // Tests run as the default `combined` role, which declares access.
    expect(configuration.runtimeCapabilities.reportLakeAccess).toBe(true);
    await expect(resolveLakeFiles(lakeDir)).resolves.toMatchObject({
      matchesParquet: [],
    });
  });
});

describe("assertReportLakeAccess", () => {
  test("passes for every role in the table", () => {
    // No role declares false today — the gateway was the last one, and it read
    // the lake anyway. Pinned so that adding a role without lake access is a
    // deliberate act that also has to answer for this guard.
    for (const role of SCOUT_RUNTIME_ROLES) {
      expect(() =>
        assertReportLakeAccess(scoutRuntimeCapabilities(role)),
      ).not.toThrow();
    }
  });

  test("throws a neutral capability error, not a transport-shaped one", () => {
    // Deliberately NOT customs' HTTP-shaped refusal: this guard sits on a path
    // reached from Discord interactions, Temporal activities and tRPC alike,
    // so it names a capability and lets each transport map it.
    const thrown = (() => {
      try {
        assertReportLakeAccess({ reportLakeAccess: false });
      } catch (error) {
        return error;
      }
      throw new Error("expected the read to be refused");
    })();
    expect(thrown).toBeInstanceOf(RuntimeCapabilityError);
    expect(thrown).toBeInstanceOf(Error);
  });
});
