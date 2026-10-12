import { describe, expect, test } from "vitest";
import { z } from "zod";
import { resetMiningWorldWithDependencies } from "./mining-reset.ts";

type FakeResult = { stdout: string; stderr: string; exitCode: number };

class FakeCluster {
  readonly events: string[] = [];
  readonly serverAnnotations: Record<string, string> = {};
  readonly serviceAnnotations: Record<string, string> = {};
  backup: Record<string, unknown> | undefined;
  job: Record<string, unknown> | undefined;
  serverImage = "server@sha256:example";
  serverReplicas = 0;
  failNextJob = false;
  failReleaseOnce = false;

  private ok(value: unknown): FakeResult {
    return { stdout: JSON.stringify(value), stderr: "", exitCode: 0 };
  }

  private get(joined: string): FakeResult {
    const resources = new Map<string, unknown>([
      [
        "statefulset",
        {
          metadata: {
            name: "minecraft-tsmc",
            resourceVersion: "1",
            annotations: this.serverAnnotations,
          },
          spec: {
            replicas: this.serverReplicas,
            template: {
              spec: { containers: [{ image: this.serverImage }] },
            },
          },
          status: { replicas: this.serverReplicas },
        },
      ],
      [
        "service",
        {
          metadata: {
            name: "minecraft-tsmc",
            resourceVersion: "1",
            annotations: this.serviceAnnotations,
          },
        },
      ],
      ["pods", { items: [] }],
      [
        "pvc",
        {
          items: [
            {
              metadata: { name: "datadir-minecraft-tsmc-0" },
              status: { phase: "Bound" },
            },
          ],
        },
      ],
      ["backup", this.backup],
      ["job", this.job],
    ]);
    const kind = /\bget (\w+)/.exec(joined)?.[1];
    if (kind === undefined) {
      throw new Error(`No resource kind in ${joined}`);
    }
    const value = resources.get(kind);
    return value === undefined
      ? { stdout: "", stderr: "NotFound", exitCode: 1 }
      : this.ok(value);
  }

  private patch(joined: string, payload: string): FakeResult {
    if (
      this.failReleaseOnce &&
      joined.includes("service") &&
      payload.includes('"op":"remove"')
    ) {
      this.failReleaseOnce = false;
      throw new Error("simulated release failure");
    }
    const operations = z
      .array(
        z.object({
          op: z.string(),
          path: z.string(),
          value: z.unknown().optional(),
        }),
      )
      .parse(JSON.parse(payload));
    const annotations = joined.includes("statefulset")
      ? this.serverAnnotations
      : this.serviceAnnotations;
    for (const operation of operations) {
      if (!operation.path.startsWith("/metadata/annotations/")) {
        continue;
      }
      const key = operation.path.split("/").at(-1)?.replaceAll("~1", "/");
      if (key === undefined) {
        throw new Error("Missing annotation key");
      }
      if (operation.op === "add") {
        annotations[key] = z.string().parse(operation.value);
      } else if (operation.op === "remove") {
        Reflect.deleteProperty(annotations, key);
      }
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  private create(input: string): FakeResult {
    const manifest = z
      .object({ kind: z.string() })
      .loose()
      .parse(JSON.parse(input));
    if (manifest.kind === "Backup") {
      this.events.push("backup-created");
      this.backup = {
        ...manifest,
        status: {
          phase: "Completed",
          errors: 0,
          warnings: 0,
          volumeSnapshotsAttempted: 1,
          volumeSnapshotsCompleted: 1,
        },
      };
    } else if (manifest.kind === "Job") {
      this.events.push("job-created");
      this.job = {
        ...manifest,
        status: this.failNextJob ? { failed: 1 } : { succeeded: 1 },
      };
      this.failNextJob = false;
    } else {
      throw new Error(`Unexpected resource kind ${manifest.kind}`);
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  async command(args: readonly string[], input?: string): Promise<FakeResult> {
    const joined = args.join(" ");
    this.events.push(joined);
    if (joined.includes(" patch ")) {
      return this.patch(joined, args.at(-1) ?? "[]");
    }
    if (joined.includes(" get ")) {
      return this.get(joined);
    }
    if (joined === "create -f -" && input !== undefined) {
      return this.create(input);
    }
    if (joined.includes(" delete job ")) {
      this.job = undefined;
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    throw new Error(`Unexpected command: ${joined}`);
  }
}

describe("mining reset orchestration", () => {
  test("defers without touching storage while a world restoration holds the lease", async () => {
    const cluster = new FakeCluster();
    cluster.serverAnnotations["sjer.red/world-restore-lease"] =
      "restore-request";
    const result = await resetMiningWorldWithDependencies("2026q4", {
      command: cluster.command.bind(cluster),
      heartbeat: () => {
        throw new Error("A deferred restore must not heartbeat a reset");
      },
      sleep: async () => {
        throw new Error("A deferred restore must not wait on a reset");
      },
    });
    expect(result).toEqual({ kind: "deferred" });
    expect(cluster.serverAnnotations).toEqual({
      "sjer.red/world-restore-lease": "restore-request",
    });
    expect(cluster.backup).toBeUndefined();
    expect(cluster.job).toBeUndefined();
    expect(cluster.serviceAnnotations).toEqual({});
  });
  test("holds the server lock until backup and reset Job succeed", async () => {
    const cluster = new FakeCluster();
    const result = await resetMiningWorldWithDependencies("2026q4", {
      command: cluster.command.bind(cluster),
      heartbeat: (phase: string) => {
        cluster.events.push(`heartbeat-${phase}`);
      },
      sleep: async () => {
        cluster.events.push("sleep");
      },
    });
    expect(result).toEqual({
      kind: "completed",
      message: "Mining world reset 2026q4 after a completed Velero snapshot",
    });
    expect(cluster.events.indexOf("backup-created")).toBeLessThan(
      cluster.events.indexOf("job-created"),
    );
    expect(
      cluster.serverAnnotations["sjer.red/mining-reset-lock"],
    ).toBeUndefined();
    expect(
      cluster.serviceAnnotations["mc-router.itzg.me/autoScaleUp"],
    ).toBeUndefined();
  });

  test("defers without a lock or backup while players keep the server awake", async () => {
    const cluster = new FakeCluster();
    cluster.serverReplicas = 1;

    const result = await resetMiningWorldWithDependencies("2026q4", {
      command: cluster.command.bind(cluster),
      heartbeat: (phase) => {
        cluster.events.push(`heartbeat-${phase}`);
      },
      sleep: async () => {
        cluster.events.push("sleep");
      },
    });

    expect(result).toEqual({ kind: "deferred" });
    expect(cluster.serverAnnotations).toEqual({});
    expect(cluster.backup).toBeUndefined();
    expect(cluster.job).toBeUndefined();
  });

  test("recreates a validated failed Job for the same period", async () => {
    const cluster = new FakeCluster();
    cluster.failNextJob = true;

    await resetMiningWorldWithDependencies("2026q4", {
      command: cluster.command.bind(cluster),
      heartbeat: (phase) => {
        cluster.events.push(`heartbeat-${phase}`);
      },
      sleep: async () => {
        cluster.events.push("sleep");
      },
    });

    expect(
      cluster.events.filter((event) => event === "job-created"),
    ).toHaveLength(2);
    expect(cluster.events.some((event) => event.includes(" delete job "))).toBe(
      true,
    );
  });

  test("pins the Job image across Activity retries and a server rollout", async () => {
    const cluster = new FakeCluster();
    cluster.failReleaseOnce = true;
    const dependencies = {
      command: cluster.command.bind(cluster),
      heartbeat: (phase: string) => {
        cluster.events.push(`heartbeat-${phase}`);
      },
      sleep: async () => {
        cluster.events.push("sleep");
      },
    };

    await expect(
      resetMiningWorldWithDependencies("2026q4", dependencies),
    ).rejects.toThrow("simulated release failure");
    cluster.serverImage = "server@sha256:rolled-out";
    await resetMiningWorldWithDependencies("2026q4", dependencies);

    expect(
      cluster.events.filter((event) => event === "job-created"),
    ).toHaveLength(1);
    expect(cluster.serverAnnotations["sjer.red/mining-reset-image"]).toBe(
      undefined,
    );
  });
});
