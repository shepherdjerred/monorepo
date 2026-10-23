import { describe, expect, test } from "vitest";
import {
  datasetName,
  parseArguments,
  parseZfsGet,
  planLz4,
  type ZfsVolume,
} from "./zfs-nvme-lz4.ts";

function volume(
  name: string,
  overrides: {
    node?: string;
    pool?: string;
    compression?: string;
    state?: string;
    volumeType?: string;
    deleting?: boolean;
  } = {},
): ZfsVolume {
  return {
    metadata: {
      name,
      ...(overrides.deleting === true
        ? { deletionTimestamp: "2026-10-22T00:00:00Z" }
        : {}),
    },
    spec: {
      ownerNodeID: overrides.node ?? "torvalds",
      poolName: overrides.pool ?? "zfspv-pool-nvme",
      volumeType: overrides.volumeType ?? "DATASET",
      ...(overrides.compression === undefined
        ? {}
        : { compression: overrides.compression }),
    },
    status: { state: overrides.state ?? "Ready" },
  };
}

describe("planLz4", () => {
  test("moves only uncompressed torvalds NVMe datasets", () => {
    const volumes = [
      volume("off", { compression: "off" }),
      volume("unset"),
      volume("unset-but-inherits-on"),
      volume("already-lz4", { compression: "lz4" }),
      volume("ci", { node: "liskov", compression: "off" }),
      volume("hdd", { pool: "zfspv-pool-hdd", compression: "off" }),
      volume("pending", { compression: "off", state: "Pending" }),
      volume("deleting", { compression: "off", deleting: true }),
      volume("zvol", { compression: "off", volumeType: "ZVOL" }),
      volume("missing", { compression: "off" }),
    ];
    const live = new Map([
      ["zfspv-pool-nvme/off", "off"],
      ["zfspv-pool-nvme/unset", "off"],
      ["zfspv-pool-nvme/unset-but-inherits-on", "on"],
      ["zfspv-pool-nvme/already-lz4", "lz4"],
      ["zfspv-pool-nvme/pending", "off"],
      ["zfspv-pool-nvme/deleting", "off"],
      ["zfspv-pool-nvme/zvol", "off"],
    ]);
    const plan = planLz4(volumes, live);

    expect(plan.candidates.map((candidate) => datasetName(candidate))).toEqual([
      "zfspv-pool-nvme/off",
      "zfspv-pool-nvme/unset",
    ]);
    expect(
      Object.fromEntries(
        plan.skipped.map(({ volume: skipped, reason }) => [
          skipped.metadata.name,
          reason,
        ]),
      ),
    ).toEqual({
      "unset-but-inherits-on": "live compression is already on",
      "already-lz4": "CR already declares compression=lz4",
      pending: "state Pending, not Ready",
      deleting: "being deleted",
      zvol: "volume type ZVOL",
      missing: "dataset not found on the pool",
    });
  });
});

describe("parseArguments", () => {
  test("defaults to a dry run", () => {
    expect(parseArguments([])).toEqual({ apply: false });
    expect(parseArguments(["--apply"])).toEqual({ apply: true });
  });

  test("rejects anything else", () => {
    expect(() => parseArguments(["--force"])).toThrow(/Unknown arguments/);
  });
});

describe("parseZfsGet", () => {
  test("reads tab-separated name and value", () => {
    expect(
      parseZfsGet("zfspv-pool-nvme/pvc-a\toff\nzfspv-pool-nvme/pvc-b\tlz4\n"),
    ).toEqual(
      new Map([
        ["zfspv-pool-nvme/pvc-a", "off"],
        ["zfspv-pool-nvme/pvc-b", "lz4"],
      ]),
    );
  });

  test("fails on unexpected output", () => {
    expect(() => parseZfsGet("one\ttwo\tthree")).toThrow(/Unexpected/);
  });
});
