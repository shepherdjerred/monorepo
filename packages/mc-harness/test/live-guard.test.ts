import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Box, Player } from "#protocol/bridge.ts";
import {
  LIVE_HEADERS,
  type LiveJournalEntry,
  liveWriteHeaders,
  parseAffects,
  readLiveWriteFlags,
} from "#protocol/live.ts";
import {
  backupState,
  BackupListSchema,
  harnessBackupManifest,
  harnessBackupName,
  latestUsableBackup,
} from "#src/live/backup.ts";
import {
  assessLiveWrite,
  authorizeLiveWrite,
  classifyCommand,
  type LiveGuardConfig,
  LiveGuardRefusal,
} from "#src/live/guard.ts";
import { distanceToBox } from "#src/box.ts";
import { LiveJournal, undoBlocker } from "#src/live/journal.ts";
import { pasteBoxFor } from "#src/live/paste-box.ts";
import {
  liveRefusal,
  parseLiveStatus,
  StatefulSetSchema,
} from "#src/live/status.ts";

const fixtures = path.join(import.meta.dirname, "fixtures", "live");
const fixture = async (name: string): Promise<unknown> =>
  Bun.file(path.join(fixtures, name)).json();

const config: LiveGuardConfig = {
  writes: true,
  worlds: ["world", "wilds", "peaks"],
  maxRegionVolume: 1000,
  backupMaxAgeHours: 24,
  nearPlayerRadius: 32,
  maxSnapshotVolume: 100_000,
};

const box = (
  min: [number, number, number],
  max: [number, number, number],
  world = "world",
): Box => ({
  world,
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] },
});

function player(
  name: string,
  x: number,
  z: number,
  { npc = false, world = "world" }: { npc?: boolean; world?: string } = {},
): Player {
  return {
    name,
    uuid: `00000000-0000-4000-8000-${name.padStart(12, "0").slice(-12)}`,
    world,
    pos: { x, y: 64, z },
    gameMode: "SURVIVAL",
    npc,
  };
}

/** `//set air` over a 1x1 row from x=0 to x=max. */
function setAirRow(max: number) {
  return {
    kind: "we" as const,
    world: "world",
    ops: [
      {
        command: "//set air",
        pos1: { x: 0, y: 0, z: 0 },
        pos2: { x: max, y: 0, z: 0 },
      },
    ],
  };
}

function backup(status: Record<string, unknown>) {
  return {
    metadata: { name: "b" },
    spec: { includedNamespaces: ["minecraft-tsmc"], snapshotVolumes: true },
    status,
  };
}

describe("classifyCommand", () => {
  it.each([
    ["list", "read"],
    ["/list", "read"],
    ["data get entity Steve Pos", "read"],
    ["execute if block 0 64 0 minecraft:stone", "read"],
    ["time query daytime", "read"],
    ["co lookup u:Steve t:1h", "read"],
    ["lp user Steve info", "read"],
    ["time set day", "write"],
    ["give Steve minecraft:diamond 1", "write"],
    ["tp Steve 0 70 0", "write"],
    ["execute as @a run tp @s 0 70 0", "write"],
    ["stop", "dangerous"],
    ["kill @e", "dangerous"],
    ["minecraft:kill @e[type=zombie]", "dangerous"],
    ["whitelist off", "dangerous"],
    ["deop Steve", "dangerous"],
    ["save-off", "dangerous"],
    ["co rollback u:griefer t:1h r:#global", "dangerous"],
    ["execute as @a run stop", "dangerous"],
    ["lp user Steve permission set *", "dangerous"],
    ["fill 0 64 0 10 70 10 air", "block"],
    ["setblock 0 64 0 stone", "block"],
    ["//set stone", "block"],
  ] as const)("%s → %s", (command, expected) => {
    expect(classifyCommand(command)).toBe(expected);
  });
});

describe("assessLiveWrite", () => {
  it("passes reads through", () => {
    expect(
      assessLiveWrite({ kind: "command", command: "list" }, config).read,
    ).toBe(true);
  });

  it("puts writes on tier 0 and dangerous commands on tier 2", () => {
    expect(
      assessLiveWrite({ kind: "command", command: "time set day" }, config),
    ).toMatchObject({
      read: false,
      tier: 0,
      box: null,
    });
    expect(
      assessLiveWrite({ kind: "command", command: "kill @e" }, config),
    ).toMatchObject({
      tier: 2,
      dangerous: true,
    });
  });

  it("refuses console block edits", () => {
    expect(() =>
      assessLiveWrite(
        { kind: "command", command: "fill 0 0 0 1 1 1 air" },
        config,
      ),
    ).toThrow(/use toolkit mc we\/paste/u);
  });

  it("bounds selection WorldEdit ops by pos1/pos2", () => {
    const assessment = assessLiveWrite(
      {
        kind: "we",
        world: "world",
        ops: [
          {
            command: "//set stone",
            pos1: { x: 5, y: 60, z: 5 },
            pos2: { x: 0, y: 62, z: 0 },
          },
        ],
      },
      config,
    );
    expect(assessment).toMatchObject({ tier: 1, world: "world" });
    expect(assessment.box).toEqual(box([0, 60, 0], [5, 62, 5]));
  });

  it("needs --affects for ops that reach beyond the selection", () => {
    const op = {
      kind: "we" as const,
      world: "world",
      ops: [{ command: "//sphere stone 3", at: { x: 0, y: 64, z: 0 } }],
    };
    expect(() => assessLiveWrite(op, config)).toThrow(/--affects/u);
    expect(
      assessLiveWrite(op, config, box([-3, 61, -3], [3, 67, 3])).box,
    ).toEqual(box([-3, 61, -3], [3, 67, 3]));
  });

  it("moves large regions to tier 2 and refuses ones too big to undo", () => {
    expect(assessLiveWrite(setAirRow(9), config).tier).toBe(1);
    expect(assessLiveWrite(setAirRow(2000), config).tier).toBe(2);
    expect(() => assessLiveWrite(setAirRow(200_000), config)).toThrow(
      /split it/u,
    );
  });

  it("refuses worlds outside the allowlist", () => {
    expect(() =>
      assessLiveWrite(
        {
          kind: "paste",
          world: "mining",
          box: box([0, 0, 0], [1, 1, 1], "mining"),
        },
        config,
      ),
    ).toThrow(/allowlist/u);
  });

  it("treats //regen as dangerous", () => {
    expect(
      assessLiveWrite(
        {
          kind: "we",
          world: "world",
          ops: [
            {
              command: "//regen",
              pos1: { x: 0, y: 0, z: 0 },
              pos2: { x: 1, y: 1, z: 1 },
            },
          ],
        },
        config,
      ),
    ).toMatchObject({ tier: 2, dangerous: true });
  });

  it("boxes actor block actions and classifies actor commands", () => {
    expect(
      assessLiveWrite(
        {
          kind: "actor-act",
          name: "alice",
          act: "break",
          pos: { x: 1, y: 2, z: 3 },
          world: "world",
        },
        config,
      ),
    ).toMatchObject({ tier: 1, box: box([1, 2, 3], [1, 2, 3]) });
    expect(
      assessLiveWrite(
        { kind: "actor-act", name: "alice", act: "command", command: "stop" },
        config,
      ),
    ).toMatchObject({ tier: 2, dangerous: true, read: false });
    expect(
      assessLiveWrite({ kind: "actor-act", name: "alice", act: "goto" }, config)
        .tier,
    ).toBe(0);
  });
});

describe("authorizeLiveWrite", () => {
  const now = new Date("2026-10-04T20:00:00Z");
  const block = assessLiveWrite(
    {
      kind: "we",
      world: "world",
      ops: [
        {
          command: "//set stone",
          pos1: { x: 0, y: 60, z: 0 },
          pos2: { x: 4, y: 64, z: 4 },
        },
      ],
    },
    config,
  );
  const base = {
    flags: { reason: "test" },
    players: [],
    latestBackupAt: null,
    now,
    config,
  };

  it("requires a reason", () => {
    expect(() =>
      authorizeLiveWrite({ ...base, assessment: block, flags: {} }),
    ).toThrow(/--reason/u);
    expect(() =>
      authorizeLiveWrite({
        ...base,
        assessment: block,
        flags: { reason: "  " },
      }),
    ).toThrow(/--reason/u);
  });

  it("honours the kill switch", () => {
    expect(() =>
      authorizeLiveWrite({
        ...base,
        assessment: block,
        config: { ...config, writes: false },
      }),
    ).toThrow(/disabled/u);
  });

  it("refuses humans inside the box, ignores NPCs and other worlds", () => {
    expect(() =>
      authorizeLiveWrite({
        ...base,
        assessment: block,
        players: [player("Steve", 2, 2)],
      }),
    ).toThrow(/Steve is inside/u);
    expect(
      authorizeLiveWrite({
        ...base,
        assessment: block,
        players: [
          player("npc", 2, 2, { npc: true }),
          player("Alex", 2, 2, { world: "wilds" }),
        ],
      }).humansOnline,
    ).toEqual(["Alex"]);
  });

  it("needs --allow-players for humans nearby", () => {
    const players = [player("Steve", 20, 2)];
    expect(() =>
      authorizeLiveWrite({ ...base, assessment: block, players }),
    ).toThrow(/--allow-players/u);
    expect(
      authorizeLiveWrite({
        ...base,
        assessment: block,
        players,
        flags: { reason: "test", allowPlayers: true },
      }),
    ).toEqual({ reason: "test", humansOnline: ["Steve"] });
    expect(
      authorizeLiveWrite({
        ...base,
        assessment: block,
        players: [player("Far", 200, 200)],
      }).humansOnline,
    ).toEqual(["Far"]);
  });

  it("needs --confirm-dangerous and a fresh backup for dangerous commands", () => {
    const danger = assessLiveWrite(
      { kind: "command", command: "kill @e" },
      config,
    );
    expect(() => authorizeLiveWrite({ ...base, assessment: danger })).toThrow(
      /--confirm-dangerous/u,
    );
    const flags = { reason: "test", confirmDangerous: true };
    expect(() =>
      authorizeLiveWrite({ ...base, assessment: danger, flags }),
    ).toThrow(/live backup/u);
    expect(() =>
      authorizeLiveWrite({
        ...base,
        assessment: danger,
        flags,
        latestBackupAt: new Date("2026-10-02T00:00:00Z"),
      }),
    ).toThrow(/live backup/u);
    expect(
      authorizeLiveWrite({
        ...base,
        assessment: danger,
        flags,
        latestBackupAt: new Date("2026-10-04T18:00:00Z"),
      }).reason,
    ).toBe("test");
  });

  it("measures distance to a box from float positions", () => {
    const b = box([0, 60, 0], [4, 64, 4]);
    expect(distanceToBox(b, { x: 4.9, y: 64.5, z: 0.1 })).toBe(0);
    expect(distanceToBox(b, { x: 8, y: 62, z: 2 })).toBe(3);
  });

  it("raises LiveGuardRefusal", () => {
    expect(() =>
      authorizeLiveWrite({ ...base, assessment: block, flags: {} }),
    ).toThrow(LiveGuardRefusal);
  });
});

describe("live write headers", () => {
  it("round-trip flags including a non-ASCII reason and an affects box", () => {
    const headers = new Headers(
      liveWriteHeaders({
        reason: "fix Ömer's roof",
        allowPlayers: true,
        confirmDangerous: true,
        affects: parseAffects("world", "3,70,3", "-3,61,-3"),
      }),
    );
    expect(headers.get(LIVE_HEADERS.allowPlayers)).toBe("1");
    expect(readLiveWriteFlags(headers)).toEqual({
      reason: "fix Ömer's roof",
      allowPlayers: true,
      confirmDangerous: true,
      affects: box([-3, 61, -3], [3, 70, 3]),
    });
    expect(readLiveWriteFlags(new Headers())).toEqual({
      reason: undefined,
      allowPlayers: false,
      confirmDangerous: false,
      affects: undefined,
    });
  });
});

describe("live status", () => {
  it("parses the recorded StatefulSet and pod as usable", async () => {
    const status = parseLiveStatus(
      await fixture("statefulset.json"),
      await fixture("pod.json"),
    );
    expect(status).toMatchObject({
      replicas: 1,
      readyReplicas: 1,
      podPhase: "Running",
      podReady: true,
      miningResetLock: null,
    });
    expect(status.image).toMatch(
      /^ghcr\.io\/shepherdjerred\/the-storm-server:/u,
    );
    expect(liveRefusal(status)).toBeNull();
  });

  it("refuses asleep, starting and locked servers", async () => {
    const sts = StatefulSetSchema.parse(await fixture("statefulset.json"));
    const asleep = {
      ...sts,
      spec: { ...sts.spec, replicas: 0 },
      status: { readyReplicas: 0 },
    };
    expect(liveRefusal(parseLiveStatus(asleep, null))).toMatch(/asleep/u);
    expect(liveRefusal(parseLiveStatus(sts, null))).toMatch(/not ready/u);
    const locked = {
      ...sts,
      metadata: {
        ...sts.metadata,
        annotations: {
          ...sts.metadata.annotations,
          "sjer.red/mining-reset-lock": "2026q4",
        },
      },
    };
    expect(
      liveRefusal(parseLiveStatus(locked, await fixture("pod.json"))),
    ).toMatch(/mining reset/u);
  });
});

describe("velero backups", () => {
  it("names and scopes harness backups like the mining reset", () => {
    expect(harnessBackupName(new Date("2026-10-04T18:15:30.123Z"))).toBe(
      "mc-harness-20261004t181530z",
    );
    expect(JSON.parse(harnessBackupManifest("mc-harness-x"))).toEqual({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: {
        name: "mc-harness-x",
        namespace: "velero",
        labels: { "sjer.red/mc-harness": "true" },
      },
      spec: {
        includedNamespaces: ["minecraft-tsmc"],
        labelSelector: { matchLabels: { "velero.io/backup": "enabled" } },
        snapshotVolumes: true,
        storageLocation: "default",
        ttl: "720h",
      },
    });
  });

  it("accepts the recorded scheduled all-namespace backup as recent", async () => {
    const list = BackupListSchema.parse(await fixture("backups.json"));
    expect(latestUsableBackup(list)).toEqual({
      name: "6hourly-backup-20261004181530",
      completedAt: new Date("2026-10-04T18:25:39Z"),
    });
  });

  it("judges completion like the mining reset", () => {
    expect(backupState(backup({ phase: "InProgress" })).state).toBe("pending");
    expect(backupState(backup({ phase: "PartiallyFailed" })).state).toBe(
      "failed",
    );
    expect(
      backupState(
        backup({
          phase: "Completed",
          errors: 1,
          volumeSnapshotsAttempted: 1,
          volumeSnapshotsCompleted: 1,
        }),
      ).state,
    ).toBe("failed");
    expect(
      backupState(
        backup({
          phase: "Completed",
          volumeSnapshotsAttempted: 2,
          volumeSnapshotsCompleted: 1,
        }),
      ).state,
    ).toBe("failed");
    expect(
      backupState(
        backup({
          phase: "Completed",
          volumeSnapshotsAttempted: 1,
          volumeSnapshotsCompleted: 1,
          completionTimestamp: "2026-10-04T00:00:00Z",
        }),
      ),
    ).toEqual({
      state: "completed",
      completedAt: new Date("2026-10-04T00:00:00Z"),
    });
    expect(
      latestUsableBackup({
        items: [
          {
            metadata: { name: "other" },
            spec: { includedNamespaces: ["scout"], snapshotVolumes: true },
            status: {
              phase: "Completed",
              volumeSnapshotsAttempted: 1,
              volumeSnapshotsCompleted: 1,
              completionTimestamp: "2026-10-04T00:00:00Z",
            },
          },
        ],
      }),
    ).toBeNull();
  });
});

function entry(overrides: Partial<LiveJournalEntry>): LiveJournalEntry {
  return {
    version: 1,
    id: "lj-a-000001",
    ts: "2026-10-04T20:00:00.000Z",
    kind: "write",
    reason: "test",
    op: { kind: "we", summary: "//set stone" },
    tier: 1,
    world: "world",
    box: box([0, 60, 0], [4, 64, 4]),
    humansOnline: [],
    backup: null,
    snapshotId: "snap-1",
    result: "ok",
    error: null,
    undoes: null,
    ...overrides,
  };
}

describe("live journal", () => {
  it("appends, lists by time and filters by since", async () => {
    const journal = new LiveJournal(
      await mkdtemp(path.join(os.tmpdir(), "live-journal-")),
    );
    await journal.append(
      entry({ id: "lj-b-000002", ts: "2026-10-05T01:00:00.000Z" }),
    );
    await journal.append(entry({}));
    const all = await journal.list();
    expect(all.map((item) => item.id)).toEqual(["lj-a-000001", "lj-b-000002"]);
    const recent = await journal.list(new Date("2026-10-05T00:00:00Z"));
    expect(recent.map((item) => item.id)).toEqual(["lj-b-000002"]);
    await expect(journal.find("lj-z-000009")).rejects.toThrow(
      /No live journal entry/u,
    );
    await expect(journal.append({ ...entry({}), id: "bad" })).rejects.toThrow();
  });

  it("undoes last-in-first-out and only restorable writes", () => {
    const first = entry({});
    const second = entry({
      id: "lj-b-000002",
      ts: "2026-10-04T21:00:00.000Z",
      snapshotId: "snap-2",
    });
    const elsewhere = entry({
      id: "lj-c-000003",
      ts: "2026-10-04T22:00:00.000Z",
      box: box([100, 60, 100], [101, 61, 101]),
    });
    expect(undoBlocker([first, second, elsewhere], first)).toMatch(
      /undo lj-b-000002 first/u,
    );
    expect(undoBlocker([first, second, elsewhere], second)).toBeNull();
    const undone = entry({
      id: "lj-d-000004",
      ts: "2026-10-04T23:00:00.000Z",
      kind: "undo",
      undoes: "lj-b-000002",
      snapshotId: null,
    });
    expect(undoBlocker([first, second, elsewhere, undone], first)).toBeNull();
    expect(undoBlocker([first, second, undone], second)).toMatch(
      /already undone/u,
    );
    expect(
      undoBlocker(
        [entry({ snapshotId: null, box: null })],
        entry({ snapshotId: null, box: null }),
      ),
    ).toMatch(/no snapshot/u);
    expect(
      undoBlocker([entry({ result: "failed" })], entry({ result: "failed" })),
    ).toMatch(/not a successful write/u);
  });
});

describe("pasteBoxFor", () => {
  const size = { x: 3, y: 2, z: 5 };
  const zero = { x: 0, y: 0, z: 0 };
  const at = { x: 10, y: 64, z: 20 };

  it.each([
    [0, box([10, 64, 20], [12, 65, 24])],
    [90, box([6, 64, 20], [10, 65, 22])],
    [180, box([8, 64, 16], [10, 65, 20])],
    [270, box([10, 64, 18], [14, 65, 20])],
  ] as const)("rotate %i", (rotate, expected) => {
    expect(pasteBoxFor({ world: "world", at, rotate }, size, zero)).toEqual(
      expected,
    );
  });

  it("applies the schematic offset before rotating", () => {
    expect(
      pasteBoxFor({ world: "world", at, rotate: 0 }, size, {
        x: -1,
        y: 0,
        z: -2,
      }),
    ).toEqual(box([9, 64, 18], [11, 65, 22]));
  });
});
