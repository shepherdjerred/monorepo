import { describe, expect, test } from "vitest";
import type { LiveJournalEntry } from "@shepherdjerred/mc-harness/protocol/live.ts";
import {
  liveWriteFlags,
  parseSince,
  renderLiveJournal,
  renderLiveStatus,
} from "#lib/mc/live.ts";

describe("live helpers", () => {
  const now = new Date("2026-10-04T20:00:00Z");

  test.each([
    ["1d", "2026-10-03T20:00:00.000Z"],
    ["6h", "2026-10-04T14:00:00.000Z"],
    ["30m", "2026-10-04T19:30:00.000Z"],
    ["2026-10-01T00:00:00Z", "2026-10-01T00:00:00.000Z"],
  ])("--since %s", (raw, expected) => {
    expect(parseSince(raw, now).toISOString()).toBe(expected);
  });

  test("rejects an unreadable --since", () => {
    expect(() => parseSince("yesterday", now)).toThrow(/--since/u);
  });

  test("maps CLI flags to live write flags", () => {
    expect(
      liveWriteFlags({ reason: "fix roof", "allow-players": true }),
    ).toEqual({
      reason: "fix roof",
      allowPlayers: true,
      allowProtected: false,
      confirmDangerous: false,
    });
    expect(
      liveWriteFlags({ reason: "arena fix", "allow-protected": true }),
    ).toMatchObject({ allowPlayers: false, allowProtected: true });
  });

  test("renders an unusable status with its refusal", () => {
    const text = renderLiveStatus({
      replicas: 0,
      readyReplicas: 0,
      podPhase: null,
      podReady: false,
      image: null,
      miningResetLock: null,
      worldRestoreLease: null,
      tokenConfigured: true,
      bridge: { connected: false, localPort: null },
      refusal: "minecraft-tsmc is asleep",
    });
    expect(text).toContain("NOT USABLE");
    expect(text).toContain("refused: minecraft-tsmc is asleep");
  });

  test("renders journal entries with box, tier and snapshot", () => {
    const write: LiveJournalEntry = {
      version: 1,
      id: "lj-abc-123456",
      ts: "2026-10-04T20:00:00.000Z",
      kind: "write",
      reason: "test pad",
      op: { kind: "we", summary: "//set stone" },
      tier: 1,
      world: "world",
      box: {
        world: "world",
        min: { x: 0, y: 60, z: 0 },
        max: { x: 4, y: 64, z: 4 },
      },
      humansOnline: ["Steve"],
      backup: null,
      snapshotId: "snap-1",
      result: "ok",
      error: null,
      undoes: null,
    };
    const text = renderLiveJournal([write]);
    expect(text).toContain("lj-abc-123456");
    expect(text).toContain("tier 1, snapshot snap-1");
    expect(text).toContain("[world 0,60,0 → 4,64,4]");
    expect(text).toContain("reason: test pad; online: Steve");
    expect(renderLiveJournal([])).toBe("No live journal entries.");
  });
});
