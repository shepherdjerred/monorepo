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
            replicas: 0,
            template: {
              spec: { containers: [{ image: "server@sha256:example" }] },
            },
          },
          status: { replicas: 0 },
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
      this.job = { ...manifest, status: { succeeded: 1 } };
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
    throw new Error(`Unexpected command: ${joined}`);
  }
}

describe("mining reset orchestration", () => {
  test("holds the server lock until backup and reset Job succeed", async () => {
    const cluster = new FakeCluster();
    const result = await resetMiningWorldWithDependencies("2026q4", {
      command: cluster.command.bind(cluster),
      heartbeat: (phase) => {
        cluster.events.push(`heartbeat-${phase}`);
      },
      sleep: async () => {
        cluster.events.push("sleep");
      },
    });
    expect(result).toContain("2026q4");
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
});
