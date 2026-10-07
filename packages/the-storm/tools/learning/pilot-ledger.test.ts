import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PilotConfigSchema, PilotLedger } from "./pilot-ledger.ts";

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "rwf-pilot-ledger-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const digest = "a".repeat(64);
const config = PilotConfigSchema.parse({
  version: 1,
  acceptance: "unaccepted",
  mode: "pilot",
  seeds: [11, 12, 13],
  seconds: 28_800,
  device: "mps",
  dataset: "/human",
  inputSha256: digest,
});
const frozen = (completedMs: number) => ({
  status: "frozen" as const,
  completedMs,
  weightsSha256: digest,
  manifestSha256: digest,
});

describe("durable pilot budget", () => {
  it("records three independent eight-hour windows and cannot recreate the pilot", async () => {
    const output = path.join(directory, "pilot");
    const ledger = await PilotLedger.create(output, config);
    for (let index = 0; index < 3; index++) {
      const started = 1000 + index * 28_800_000;
      const claim = await ledger.claim(index, started);
      expect(claim).toEqual({
        seed: config.seeds[index],
        startedMs: started,
        deadlineMs: started + 28_800_000,
      });
      await ledger.finish(index, frozen(claim.deadlineMs));
    }
    const reopened = await PilotLedger.read(output);
    expect(reopened.config).toEqual(config);
    await expect(PilotLedger.create(output, config)).rejects.toThrow();
    const last = await ledger.state(2);
    expect(last.status).toBe("frozen");
  });

  it("a crash preserves the original deadline and forbids a fresh claim", async () => {
    const output = path.join(directory, "pilot");
    const ledger = await PilotLedger.create(output, config);
    const original = await ledger.claim(0, 5000);
    const reopened = await PilotLedger.read(output);
    expect(await reopened.state(0)).toEqual({
      status: "running",
      claim: original,
    });
    await expect(reopened.claim(0, original.deadlineMs + 1)).rejects.toThrow(
      "cannot restart",
    );
    await expect(reopened.claim(1, original.deadlineMs + 1)).rejects.toThrow(
      "unfinished or failed",
    );
  });

  it("concurrent owners cannot both claim one seed", async () => {
    const output = path.join(directory, "pilot");
    const first = await PilotLedger.create(output, config);
    const second = await PilotLedger.read(output);
    const results = await Promise.allSettled([
      first.claim(0, 1000),
      second.claim(0, 2000),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const state = await first.state(0);
    expect(state.status).toBe("running");
  });

  it("rejects late freezes and never overwrites a failed result", async () => {
    const ledger = await PilotLedger.create(
      path.join(directory, "pilot"),
      config,
    );
    const claim = await ledger.claim(0, 1000);
    await expect(
      ledger.finish(0, frozen(claim.deadlineMs + 1)),
    ).rejects.toThrow("beyond its budget");
    await ledger.finish(0, {
      status: "failed",
      completedMs: claim.deadlineMs + 1,
      reason: "watchdog",
    });
    await expect(ledger.finish(0, frozen(claim.deadlineMs))).rejects.toThrow(
      "not running",
    );
    await expect(ledger.claim(1, claim.deadlineMs + 2)).rejects.toThrow(
      "unfinished or failed",
    );
  });

  it("can continue pending seeds after an orderly frozen result, and detects budget tampering", async () => {
    const output = path.join(directory, "pilot");
    const ledger = await PilotLedger.create(output, config);
    await ledger.claim(0, 1000);
    await ledger.finish(0, frozen(2000));
    const resumed = await PilotLedger.read(output);
    await resumed.claim(1, 3000);
    const claimPath = path.join(output, "seed-1.claimed.json");
    const raw: unknown = JSON.parse(await readFile(claimPath, "utf8"));
    const claim = Object.assign({}, raw, { deadlineMs: 99_999_999 });
    await writeFile(claimPath, JSON.stringify(claim));
    await expect(resumed.state(1)).rejects.toThrow("original pilot budget");
  });

  it("rejects duplicate seeds and diagnostic/human budget mixing", () => {
    expect(
      PilotConfigSchema.safeParse({ ...config, seeds: [11, 11, 13] }).success,
    ).toBe(false);
    expect(
      PilotConfigSchema.safeParse({ ...config, seconds: 300 }).success,
    ).toBe(false);
    expect(
      PilotConfigSchema.safeParse({ ...config, mode: "diagnostic" }).success,
    ).toBe(false);
  });
});
