import { describe, expect, it } from "bun:test";
import {
  parseManagedZfsPools,
  runZfsMaintenanceWithDependencies,
  selectZfsCollectorPods,
  type ZfsCollectorPodCandidate,
  type ZfsMaintenanceDependencies,
} from "./zfs-maintenance.ts";

function readyPod(node: string, pod: string): ZfsCollectorPodCandidate {
  return {
    metadata: { name: pod },
    spec: { nodeName: node },
    status: {
      phase: "Running",
      conditions: [{ type: "Ready", status: "True" }],
    },
  };
}

function dependenciesFor(
  pods: readonly ZfsCollectorPodCandidate[],
  execute: ZfsMaintenanceDependencies["execInPod"],
  heartbeat: ZfsMaintenanceDependencies["heartbeat"] = (details) => {
    expect(details.phase).toBeDefined();
  },
): ZfsMaintenanceDependencies {
  return {
    listCollectorPods: async () => pods,
    execInPod: execute,
    heartbeat,
  };
}

describe("selectZfsCollectorPods", () => {
  it("returns one Running and Ready collector per node in stable order", () => {
    expect(
      selectZfsCollectorPods([
        readyPod("torvalds", "zfs-torvalds"),
        readyPod("liskov", "zfs-liskov"),
        {
          metadata: { name: "zfs-pending" },
          spec: { nodeName: "ignored" },
          status: {
            phase: "Pending",
            conditions: [{ type: "Ready", status: "False" }],
          },
        },
      ]),
    ).toEqual([
      { node: "liskov", pod: "zfs-liskov" },
      { node: "torvalds", pod: "zfs-torvalds" },
    ]);
  });

  it("fails on duplicate Ready collectors for one node", () => {
    expect(() =>
      selectZfsCollectorPods([
        readyPod("torvalds", "zfs-a"),
        readyPod("torvalds", "zfs-b"),
      ]),
    ).toThrow("Multiple Running and Ready");
  });

  it("fails when no collector is Running and Ready", () => {
    expect(() => selectZfsCollectorPods([])).toThrow(
      "No Running and Ready zfs-zpool-collector pods",
    );
  });

  it("fails when a Ready collector lacks node identity", () => {
    expect(() =>
      selectZfsCollectorPods([
        {
          metadata: { name: "zfs-collector" },
          status: {
            phase: "Running",
            conditions: [{ type: "Ready", status: "True" }],
          },
        },
      ]),
    ).toThrow("missing metadata.name or spec.nodeName");
  });
});

describe("parseManagedZfsPools", () => {
  it("filters unmanaged pools and sorts managed pools", () => {
    expect(
      parseManagedZfsPools("zfspv-pool-nvme\nrpool\nzfspv-pool-hdd\n", {
        node: "torvalds",
        pod: "zfs-torvalds",
      }),
    ).toEqual(["zfspv-pool-hdd", "zfspv-pool-nvme"]);
  });

  it("fails when a node has no managed pools", () => {
    expect(() =>
      parseManagedZfsPools("rpool\n", { node: "liskov", pod: "zfs-liskov" }),
    ).toThrow("No managed ZFS pools");
  });

  it("rejects pool names that cannot safely be passed to the shell", () => {
    expect(() =>
      parseManagedZfsPools("zfspv-pool-nvme; rm -rf /\n", {
        node: "torvalds",
        pod: "zfs-torvalds",
      }),
    ).toThrow("Invalid ZFS pool name");
  });
});

describe("runZfsMaintenanceWithDependencies", () => {
  it("includes node and pool details in heartbeats and results", async () => {
    const heartbeats: Parameters<ZfsMaintenanceDependencies["heartbeat"]>[0][] =
      [];
    const deps = dependenciesFor(
      [readyPod("liskov", "zfs-liskov")],
      async (_pod, command) => {
        if (command === "zpool list -H -o name") {
          return "zfspv-pool-nvme\n";
        }
        if (command.startsWith("zpool status")) {
          return "state: ONLINE\n";
        }
        return "";
      },
      (details) => {
        heartbeats.push(details);
      },
    );

    const result = await runZfsMaintenanceWithDependencies(deps);

    expect(heartbeats).toContainEqual({
      phase: "autotrim",
      node: "liskov",
      pod: "zfs-liskov",
      pool: "zfspv-pool-nvme",
    });
    expect(result).toContain("liskov/zfspv-pool-nvme");
  });

  it("routes each node's discovered pools to its own collector pod", async () => {
    const calls: { node: string; command: string }[] = [];
    const deps = dependenciesFor(
      [readyPod("torvalds", "zfs-torvalds"), readyPod("liskov", "zfs-liskov")],
      async (pod, command) => {
        calls.push({ node: pod.node, command });
        if (command === "zpool list -H -o name") {
          return pod.node === "liskov"
            ? "zfspv-pool-nvme\n"
            : "zfspv-pool-hdd\nzfspv-pool-nvme\n";
        }
        if (command.startsWith("zpool status")) {
          return "state: ONLINE\n";
        }
        return "";
      },
    );

    const result = await runZfsMaintenanceWithDependencies(deps);

    expect(result).toContain("liskov/zfspv-pool-nvme");
    expect(result).toContain("torvalds/zfspv-pool-hdd");
    expect(result).toContain("torvalds/zfspv-pool-nvme");
    expect(
      calls.filter(
        ({ node, command }) =>
          node === "liskov" && command.includes("zfspv-pool-hdd"),
      ),
    ).toEqual([]);
    expect(
      calls.filter(
        ({ node, command }) =>
          node === "torvalds" && command.includes("zfspv-pool-hdd"),
      ).length,
    ).toBe(3);
  });

  it("does not start a scrub that is already in progress", async () => {
    const commands: string[] = [];
    const deps = dependenciesFor(
      [readyPod("torvalds", "zfs-torvalds")],
      async (_pod, command) => {
        commands.push(command);
        if (command === "zpool list -H -o name") {
          return "zfspv-pool-nvme\n";
        }
        if (command.startsWith("zpool status")) {
          return "scan: scrub in progress\n";
        }
        return "";
      },
    );

    const result = await runZfsMaintenanceWithDependencies(deps);

    expect(result).toContain("already in progress, skipped");
    expect(commands).not.toContain("zpool scrub zfspv-pool-nvme");
  });

  it("includes node, pool, and command context when a command fails", async () => {
    const deps = dependenciesFor(
      [readyPod("torvalds", "zfs-torvalds")],
      async (_pod, command) => {
        if (command === "zpool list -H -o name") {
          return "zfspv-pool-nvme\n";
        }
        throw new Error("permission denied");
      },
    );

    await expect(runZfsMaintenanceWithDependencies(deps)).rejects.toThrow(
      "ZFS maintenance command failed: node=torvalds, pod=zfs-torvalds, pool=zfspv-pool-nvme, command=zpool set autotrim=on zfspv-pool-nvme",
    );
  });
});
