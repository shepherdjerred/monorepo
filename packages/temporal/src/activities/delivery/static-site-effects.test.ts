import { describe, expect, test } from "vitest";
import {
  activateStaticArchive,
  assertNoReservedStaticFiles,
} from "./static-site-effects.ts";
import type { StaticActivationReceipt } from "./static-site-effects.ts";

const receipt: StaticActivationReceipt = {
  deploymentId: "deployment:1",
  versionSetRevisionId: "set:1",
  archiveDigest: `sha256:${"a".repeat(64)}`,
  bucket: "wiki-sjer-red",
};
function fixture() {
  let stored: StaticActivationReceipt | null = null;
  const calls: string[] = [];
  return {
    calls,
    effects: {
      readReceipt: async () => {
        calls.push("read");
        return stored;
      },
      matchesArchive: async () => {
        calls.push("verify");
        return true;
      },
      synchronize: async () => {
        calls.push("sync");
      },
      writeReceipt: async (value: StaticActivationReceipt) => {
        calls.push("receipt");
        stored = value;
      },
      purge: async () => {
        calls.push("purge");
      },
    },
  };
}

describe("static activation effects", () => {
  test("archives cannot also own preserved runtime files", () => {
    expect(() =>
      assertNoReservedStaticFiles(
        ["index.html", "data/manifest.json"],
        ["data/*"],
      ),
    ).toThrow("runtime-owned object");
    expect(() =>
      assertNoReservedStaticFiles(
        ["index.html", "data/nested/manifest.json"],
        ["data/*"],
      ),
    ).toThrow("runtime-owned object");
    expect(() =>
      assertNoReservedStaticFiles(
        ["index.html", "assets/app.js"],
        ["data/*", ".release-version"],
      ),
    ).not.toThrow();
  });
  test("certifies all bytes before advancing the activation receipt", async () => {
    const { effects, calls } = fixture();
    await activateStaticArchive(receipt, effects);
    expect(calls).toEqual([
      "read",
      "sync",
      "verify",
      "receipt",
      "read",
      "purge",
    ]);
  });
  test("lost mutation responses are never retried in the Activity", async () => {
    const { effects, calls } = fixture();
    effects.synchronize = async () => {
      calls.push("sync");
      throw new Error("response lost");
    };
    await expect(activateStaticArchive(receipt, effects)).rejects.toThrow(
      "response lost",
    );
    expect(calls).toEqual(["read", "sync"]);
  });
  test("a byte mismatch cannot create an acceptance receipt", async () => {
    const { effects, calls } = fixture();
    effects.matchesArchive = async () => false;
    await expect(activateStaticArchive(receipt, effects)).rejects.toThrow(
      "readback differs",
    );
    expect(calls).not.toContain("receipt");
  });
  test("an inspected completed receipt can settle a lost response without resync", async () => {
    const { effects, calls } = fixture();
    await effects.writeReceipt(receipt);
    calls.length = 0;
    await activateStaticArchive(receipt, effects);
    expect(calls).toEqual(["read", "verify", "purge"]);
  });
  test("a matching receipt with corrupt bytes fails loudly instead of silently repairing", async () => {
    const { effects, calls } = fixture();
    await effects.writeReceipt(receipt);
    calls.length = 0;
    effects.matchesArchive = async () => false;
    await expect(activateStaticArchive(receipt, effects)).rejects.toThrow(
      "operator recovery required",
    );
    expect(calls).not.toContain("sync");
  });
});
