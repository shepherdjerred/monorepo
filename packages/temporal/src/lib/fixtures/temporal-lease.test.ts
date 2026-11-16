import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { attachTemporalEnvironmentLease } from "#lib/fixtures/temporal-lease.ts";

describe("attachTemporalEnvironmentLease", () => {
  let directory = "";

  afterEach(async () => {
    if (directory !== "") {
      await rm(directory, { recursive: true, force: true });
      directory = "";
    }
  });

  test("reuses one lease per TestWorkflowEnvironment and releases on teardown", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "temporal-env-lease-"));
    let toreDown = false;
    const fakeEnv = Object.assign(Object.create(null), {
      address: "127.0.0.1:41234",
      teardown: () => {
        toreDown = true;
        return Promise.resolve();
      },
    });

    const first = await attachTemporalEnvironmentLease(fakeEnv, {
      tendDir: directory,
      ttlMs: 60_000,
    });
    const second = await attachTemporalEnvironmentLease(fakeEnv, {
      tendDir: directory,
    });
    expect(second.id).toBe(first.id);
    expect(first.record.target).toBe("127.0.0.1:41234");

    await fakeEnv.teardown();
    expect(toreDown).toBe(true);
    await expect(stat(first.leasePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
