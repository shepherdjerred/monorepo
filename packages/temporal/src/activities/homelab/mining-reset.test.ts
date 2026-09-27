import { afterEach, describe, expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertCompletedBackup,
  assertExactlyOneBackedUpClaim,
  assertMatchingResetJob,
  miningResetScript,
} from "./mining-reset-contract.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "the-storm-mining-reset-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "mining", "region"), { recursive: true });
  await writeFile(path.join(root, "mining", "level.dat"), "mining world");
  await mkdir(path.join(root, "world"));
  await writeFile(path.join(root, "world", "level.dat"), "main world");
  return root;
}

async function runScript(root: string): Promise<number> {
  const process = Bun.spawn(["sh", "-eu", "-c", miningResetScript(root)], {
    env: { RESET_PERIOD: "2026q4", PATH: Bun.env["PATH"] ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return process.exited;
}

describe("The Storm mining reset", () => {
  test("removes only mining and writes a durable quarter marker", async () => {
    const root = await fixtureRoot();
    expect(await runScript(root)).toBe(0);
    expect(
      await Bun.file(path.join(root, "mining", "level.dat")).exists(),
    ).toBe(false);
    expect(await readFile(path.join(root, "world", "level.dat"), "utf8")).toBe(
      "main world",
    );
    expect(
      await readFile(path.join(root, ".mining-reset", "2026q4.done"), "utf8"),
    ).toBe("2026q4\n");

    await mkdir(path.join(root, "mining"));
    await writeFile(path.join(root, "mining", "new.txt"), "regenerated");
    expect(await runScript(root)).toBe(0);
    expect(await readFile(path.join(root, "mining", "new.txt"), "utf8")).toBe(
      "regenerated",
    );
  });

  test("rejects a symlink at the mining path", async () => {
    const root = await fixtureRoot();
    await rm(path.join(root, "mining"), { recursive: true });
    await symlink(path.join(root, "world"), path.join(root, "mining"));
    expect(await runScript(root)).toBe(23);
    expect(await readFile(path.join(root, "world", "level.dat"), "utf8")).toBe(
      "main world",
    );
  });

  test("requires one bound claim and one completed snapshot", () => {
    const claim = {
      metadata: { name: "datadir-minecraft-tsmc-0" },
      status: { phase: "Bound" },
    };
    expect(() =>
      assertExactlyOneBackedUpClaim({ items: [claim] }),
    ).not.toThrow();
    expect(() =>
      assertExactlyOneBackedUpClaim({ items: [claim, claim] }),
    ).toThrow();
    const backup = {
      metadata: {
        name: "mining-reset-2026q4",
        labels: { "sjer.red/mining-reset-period": "2026q4" },
      },
      spec: {
        includedNamespaces: ["minecraft-tsmc"],
        labelSelector: { matchLabels: { "velero.io/backup": "enabled" } },
        snapshotVolumes: true,
        storageLocation: "default",
      },
      status: {
        phase: "Completed",
        errors: 0,
        warnings: 0,
        volumeSnapshotsAttempted: 1,
        volumeSnapshotsCompleted: 1,
      },
    };
    expect(assertCompletedBackup(backup, "2026q4")).toBe(true);
    expect(
      assertCompletedBackup(
        {
          ...backup,
          status: {
            phase: "Completed",
            volumeSnapshotsAttempted: 1,
            volumeSnapshotsCompleted: 1,
          },
        },
        "2026q4",
      ),
    ).toBe(true);
    expect(() =>
      assertCompletedBackup(
        { ...backup, status: { ...backup.status, warnings: 1 } },
        "2026q4",
      ),
    ).toThrow();
    expect(() =>
      assertCompletedBackup(
        {
          ...backup,
          status: { ...backup.status, volumeSnapshotsCompleted: 0 },
        },
        "2026q4",
      ),
    ).toThrow();
  });

  test("rejects a colliding Job with a different command", () => {
    const container = {
      name: "mining-reset",
      image: "server@sha256:example",
      command: ["/bin/sh", "-eu", "-c", miningResetScript("/data")],
      env: [{ name: "RESET_PERIOD", value: "2026q4" }],
      volumeMounts: [{ name: "data", mountPath: "/data" }],
    };
    const job = {
      metadata: {
        name: "mining-reset-2026q4",
        labels: { "sjer.red/mining-reset-period": "2026q4" },
      },
      spec: {
        template: {
          spec: {
            containers: [container],
            volumes: [
              {
                name: "data",
                persistentVolumeClaim: {
                  claimName: "datadir-minecraft-tsmc-0",
                },
              },
            ],
          },
        },
      },
      status: { succeeded: 1 },
    };
    expect(assertMatchingResetJob(job, "2026q4", "server@sha256:example")).toBe(
      true,
    );
    const wrong = {
      ...job,
      spec: {
        template: {
          spec: {
            ...job.spec.template.spec,
            containers: [{ ...container, command: ["/bin/sh", "-c", "true"] }],
          },
        },
      },
    };
    expect(() =>
      assertMatchingResetJob(wrong, "2026q4", "server@sha256:example"),
    ).toThrow();
  });
});
