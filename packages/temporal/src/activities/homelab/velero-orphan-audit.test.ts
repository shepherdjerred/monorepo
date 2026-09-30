import { describe, expect, it } from "vitest";
import {
  parseZfsInventory,
  selectOrphanZfsBackupCrs,
  selectZfsNodePods,
} from "./velero-orphan-audit.ts";

describe("selectZfsNodePods", () => {
  it("returns one Running and Ready pod per node in stable order", () => {
    expect(
      selectZfsNodePods([
        {
          metadata: { name: "zfs-torvalds" },
          spec: { nodeName: "torvalds" },
          status: {
            phase: "Running",
            conditions: [{ type: "Ready", status: "True" }],
          },
        },
        {
          metadata: { name: "zfs-pending" },
          spec: { nodeName: "ignored" },
          status: {
            phase: "Pending",
            conditions: [{ type: "Ready", status: "False" }],
          },
        },
        {
          metadata: { name: "zfs-liskov" },
          spec: { nodeName: "liskov" },
          status: {
            phase: "Running",
            conditions: [{ type: "Ready", status: "True" }],
          },
        },
      ]),
    ).toEqual([
      { node: "liskov", pod: "zfs-liskov" },
      { node: "torvalds", pod: "zfs-torvalds" },
    ]);
  });

  it("fails on duplicate Ready pods for one node", () => {
    expect(() =>
      selectZfsNodePods([
        {
          metadata: { name: "zfs-a" },
          spec: { nodeName: "torvalds" },
          status: {
            phase: "Running",
            conditions: [{ type: "Ready", status: "True" }],
          },
        },
        {
          metadata: { name: "zfs-b" },
          spec: { nodeName: "torvalds" },
          status: {
            phase: "Running",
            conditions: [{ type: "Ready", status: "True" }],
          },
        },
      ]),
    ).toThrow("Multiple Running and Ready");
  });

  it("fails when no node pod is Running and Ready", () => {
    expect(() => selectZfsNodePods([])).toThrow("No Running and Ready");
  });
});

describe("parseZfsInventory", () => {
  it("aggregates live and orphan snapshots across NVMe and SATA pools", () => {
    const result = parseZfsInventory(
      "torvalds",
      [
        "zfspv-pool-nvme\tfilesystem\t1024",
        "zfspv-pool-nvme/pvc-a\tfilesystem\t512",
        "zfspv-pool-nvme/pvc-a@backup-live\tsnapshot\t128",
        "zfspv-pool-nvme/pvc-a@backup-removed\tsnapshot\t64",
        "zfspv-pool-hdd\tfilesystem\t2048",
        "zfspv-pool-hdd/pvc-b\tvolume\t1024",
      ].join("\n"),
      ["backup-live"],
    );

    expect(result).toEqual([
      {
        node: "torvalds",
        pool: "zfspv-pool-hdd",
        dataset: "zfspv-pool-hdd/pvc-b",
        orphanCount: 0,
        orphanBytes: 0,
        liveCount: 0,
      },
      {
        node: "torvalds",
        pool: "zfspv-pool-nvme",
        dataset: "zfspv-pool-nvme/pvc-a",
        orphanCount: 1,
        orphanBytes: 64,
        liveCount: 1,
      },
    ]);
  });

  it("handles a node with one pool and datasets without snapshots", () => {
    const result = parseZfsInventory(
      "liskov",
      [
        "zfspv-pool-nvme\tfilesystem\t1024",
        "zfspv-pool-nvme/pvc-ci\tfilesystem\t512",
      ].join("\n"),
      [],
    );

    expect(result).toEqual([
      {
        node: "liskov",
        pool: "zfspv-pool-nvme",
        dataset: "zfspv-pool-nvme/pvc-ci",
        orphanCount: 0,
        orphanBytes: 0,
        liveCount: 0,
      },
    ]);
  });

  it("fails on malformed rows instead of silently dropping data", () => {
    expect(() =>
      parseZfsInventory("torvalds", "zfspv-pool-nvme/pvc-a\tsnapshot", []),
    ).toThrow("expected 3 tab-separated fields");
    expect(() =>
      parseZfsInventory(
        "torvalds",
        "zfspv-pool-nvme/pvc-a@backup\tsnapshot\tnot-a-number",
        [],
      ),
    ).toThrow("used bytes is not an integer");
  });

  it("fails when a snapshot has no corresponding dataset row", () => {
    expect(() =>
      parseZfsInventory(
        "torvalds",
        "zfspv-pool-nvme/pvc-a@backup\tsnapshot\t1",
        [],
      ),
    ).toThrow("has no dataset row");
  });
});

describe("selectOrphanZfsBackupCrs", () => {
  const NOW = Date.parse("2026-09-24T20:00:00Z");

  it("reports only old CRs whose backup is gone, in stable order", () => {
    expect(
      selectOrphanZfsBackupCrs(
        [
          {
            name: "pvc-b.backup-removed",
            creationTimestamp: "2026-09-20T20:00:00Z",
          },
          {
            name: "pvc-a.backup-live",
            creationTimestamp: "2026-09-24T19:00:00Z",
          },
          {
            name: "pvc-a.backup-removed",
            creationTimestamp: "2026-09-23T19:00:00Z",
          },
        ],
        ["backup-live"],
        NOW,
      ),
    ).toEqual({
      orphan: [
        { name: "pvc-a.backup-removed", ageSeconds: 25 * 3600 },
        { name: "pvc-b.backup-removed", ageSeconds: 4 * 24 * 3600 },
      ],
      blocked: [],
      liveAttached: 1,
    });
  });

  it("fails closed on young, unparseable, and timestamp-less CRs", () => {
    expect(
      selectOrphanZfsBackupCrs(
        [
          // Young orphan: inside the 24h fence.
          {
            name: "pvc-a.backup-removed",
            creationTimestamp: "2026-09-24T19:00:00Z",
          },
          // Exactly at the fence: still blocked.
          {
            name: "pvc-b.backup-removed",
            creationTimestamp: "2026-09-23T20:00:00Z",
          },
          {
            name: "no-dot-separator",
            creationTimestamp: "2026-06-01T00:00:00Z",
          },
          { name: "too.many.dots", creationTimestamp: "2026-06-01T00:00:00Z" },
          {
            name: ".backup-removed",
            creationTimestamp: "2026-06-01T00:00:00Z",
          },
          { name: "pvc-c.backup-removed", creationTimestamp: undefined },
          {
            name: "pvc-d.backup-removed",
            creationTimestamp: "not-a-timestamp",
          },
        ],
        ["backup-live"],
        NOW,
      ),
    ).toEqual({
      orphan: [],
      blocked: [
        ".backup-removed",
        "no-dot-separator",
        "pvc-a.backup-removed",
        "pvc-b.backup-removed",
        "pvc-c.backup-removed",
        "pvc-d.backup-removed",
        "too.many.dots",
      ],
      liveAttached: 0,
    });
  });

  it("handles an empty cluster", () => {
    expect(selectOrphanZfsBackupCrs([], [], NOW)).toEqual({
      orphan: [],
      blocked: [],
      liveAttached: 0,
    });
  });
});
