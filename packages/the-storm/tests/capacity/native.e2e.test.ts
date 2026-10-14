import path from "node:path";
import { expect } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { capacityMap, capacityNativeTotal } from "#e2e/gameplay-fixtures.ts";
import { eventually, settledMatch, status } from "#e2e/harness/rwf-match.ts";
import { gzipLines, readRecording } from "#e2e/harness/rwfbots.ts";
import { readTrails } from "#e2e/harness/rwf-trails.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { startCapacityClient } from "./native-client.ts";
import { request, StatusSchema, type Session } from "#client/protocol.ts";
import { evidence } from "./probes.ts";
import { CapacityCombatCapture, verifyNativeCombat } from "./native-combat.ts";

async function state(session: Session) {
  const value = StatusSchema.parse(await request(session, "status"));
  if (!value.connected) throw new Error("Native participant disconnected");
  return value;
}

async function isLive(rcon: RconClient) {
  const now = await status(rcon);
  return now.phase === "Live";
}

test(
  "a native participant moves, takes bot damage and completes the selected capacity tier",
  { timeout: 50 * 60_000 },
  async ({ rcon, server }) => {
    const total = capacityNativeTotal();
    const inputs = await evidence(server);
    const beganAt = Date.now();
    expect(inputs.personalityCount).toBe(512);
    await eventually(
      "the imported map to finish preparing",
      async () => {
        const reply = await rcon.command("rwf admin status");
        return reply.includes("Ready: true, phase: Lobby");
      },
      15 * 60_000,
    );
    const { session, artifacts, client } = await startCapacityClient(
      server,
      "capacity-native",
    );
    try {
      const teams = capacityMap() === "apex-expanse" ? 2 : 4;
      expect(
        await rcon.command(`rwf admin size team ${(total / teams).toString()}`),
      ).toContain(`${total.toString()} total`);
      await request(session, "command", { text: "rwf join" });
      await eventually(
        "the ordinary draft to go live",
        async () => isLive(rcon),
        120_000,
      );
      const live = await status(rcon);
      expect([live.humans, live.bots]).toEqual([1, total - 1]);
      CapacityCombatCapture.parse(
        JSON.parse(await rcon.command(`rwfcapacitycombat arm ${live.matchId}`)),
      );
      await request(session, "capture", {
        name: `${total.toString()}-combatants-live`,
      });
      const before = await state(session);
      await request(session, "input", { buttons: ["forward"], ticks: 20 });
      const after = await state(session);
      const distance = Math.hypot(
        ...after.position.map(
          (value, i) => value - (before.position[i] ?? Number.NaN),
        ),
      );
      expect(
        distance,
        "ordinary movement moves the native participant",
      ).toBeGreaterThan(1);
      await request(session, "capture", { name: "native-moved" });
      const observations = [before, after];
      const began = Date.now();
      let capturedHurt = false;
      // Walk into play, then let combat and the match rules end the round.
      // No teleport, damage or finish commands.
      while ((await isLive(rcon)) && Date.now() - began < 16 * 60_000) {
        const current = await state(session);
        observations.push(current);
        if (!capturedHurt && current.health < before.health) {
          await request(session, "capture", { name: "native-hurt" });
          capturedHurt = true;
        }
        if (
          !capturedHurt &&
          current.health > 0 &&
          Date.now() - began < 30_000
        ) {
          await request(session, "input", {
            buttons: ["forward", "sprint"],
            ticks: 20,
          });
        } else {
          await Bun.sleep(1000);
        }
      }
      expect(await isLive(rcon)).toBe(false);
      const settled = await settledMatch(server, live.matchId);
      expect([settled.match.humans, settled.match.bots]).toEqual([
        1,
        total - 1,
      ]);
      expect(settled.match.dropped_frames).toBe(0);
      const lines = await gzipLines(
        server,
        settled.match.recording_file ?? "",
        artifacts,
      );
      const recording = readRecording(lines);
      const trails = readTrails(lines);
      const combat = CapacityCombatCapture.parse(
        JSON.parse(await rcon.command("rwfcapacitycombat sample")),
      );
      await Bun.write(
        path.join(artifacts, "combat-observer.json"),
        JSON.stringify(combat, null, 2),
      );
      const combatAcceptance = verifyNativeCombat(lines, combat, {
        match: live.matchId,
        total,
      });
      expect(recording.roster.size).toBe(total);
      const human = [...recording.roster].find(
        ([, member]) => !member.bot,
      )?.[0];
      expect(human).toBeDefined();
      const bots = new Set(
        [...recording.roster]
          .filter(([, member]) => member.bot)
          .map(([id]) => id),
      );
      expect(
        combatAcceptance.attacked,
        "the same bot recorded its attack on the human",
      ).toBe(true);
      expect(
        combatAcceptance.killed,
        "original cause is direct bot combat with actual applied damage",
      ).toBe(true);
      expect(
        observations.some((entry) => entry.health < before.health),
        "native client observed health loss",
      ).toBe(true);
      const moved = [...trails.paths].filter(
        ([id, points]) =>
          bots.has(id) &&
          points.some(
            (point) =>
              Math.hypot(
                point.x - (points[0]?.x ?? Number.NaN),
                point.z - (points[0]?.z ?? Number.NaN),
              ) > 3,
          ),
      );
      expect(
        moved.length,
        "bots move beyond their reused spawn points",
      ).toBeGreaterThan(Math.ceil((200 * (total - 1)) / 255));
      expect(lines.find((line) => line.startsWith("X\t"))).toMatch(
        /\t(?:LAST_TEAM_STANDING|DRAW)$/u,
      );
      await request(session, "capture", { name: "match-ended" });
      await Bun.write(
        path.join(artifacts, "acceptance.json"),
        JSON.stringify(
          {
            inputs,
            beganAt,
            completedAt: Date.now(),
            total,
            match: settled.match,
            movement: distance,
            botMovements: moved.length,
            ...combatAcceptance,
            combatObserver: "combat-observer.json",
            observations,
          },
          null,
          2,
        ),
      );
      await request(session, "command", { text: "rwf leave" });
      await eventually(
        "reset and empty roster",
        async () => {
          const now = await status(rcon);
          const debug = await rcon.command("rwfbots debug");
          return (
            now.ready &&
            now.phase === "Lobby" &&
            now.humans === 0 &&
            debug.includes("no bots in the match")
          );
        },
        15 * 60_000,
      );
      console.warn(`Native capacity evidence: ${artifacts}`);
    } finally {
      await client.stop();
    }
  },
);
