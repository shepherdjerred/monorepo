import path from "node:path";
import { writeFile } from "node:fs/promises";
import { expect } from "vitest";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import { capacityMap, capacityNativeTotal } from "#e2e/gameplay-fixtures.ts";
import { packageRoot } from "#e2e/harness/paths.ts";
import { eventually, status } from "#e2e/harness/rwf-match.ts";
import {
  collectFramePacing,
  compareFramePacing,
} from "#client/frame-pacing.ts";
import { request, StatusSchema, waitFor } from "#client/protocol.ts";
import { evidence } from "./probes.ts";
import { startCapacityClient } from "./native-client.ts";
import { stagedDigest } from "./runtime.ts";

const Viewpoint = z.object({
  id: z.string(),
  spectator: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    yaw: z.number(),
    pitch: z.number(),
  }),
});

test(
  "MacBook render intervals compare the same admitted-map camera before and during the selected tier",
  { timeout: 50 * 60_000 },
  async ({ bot, rcon, server }) => {
    expect(
      process.platform,
      "MacBook evidence requires an actual macOS native client",
    ).toBe("darwin");
    const map = capacityMap();
    const total = capacityNativeTotal();
    const inputs = await evidence(server);
    await eventually(
      "ready empty admitted-map lobby",
      async () => {
        const current = await status(rcon);
        return (
          current.ready &&
          current.phase === "Lobby" &&
          current.humans === 0 &&
          current.map === map
        );
      },
      15 * 60_000,
    );
    const viewpointFile = path.join(
      packageRoot,
      `server/owned/plugins/TheStorm/rwf/maps/${map}/map.yml`,
    );
    const bytes = await Bun.file(viewpointFile).bytes();
    const viewpoint = Viewpoint.parse(
      Bun.YAML.parse(new TextDecoder().decode(bytes)),
    );
    expect(viewpoint.id).toBe(map);
    if (server.kind !== "container")
      throw new Error("Frame pacing evidence requires Docker");
    const viewpointSha256 = new Bun.CryptoHasher("sha256")
      .update(bytes)
      .digest("hex");
    expect(
      await stagedDigest(
        server.containerId,
        `/data/plugins/TheStorm/rwf/maps/${map}/map.yml`,
      ),
    ).toBe(viewpointSha256);
    const { session, artifacts, client } = await startCapacityClient(
      server,
      "capacity-frame-pacing",
    );
    try {
      await rcon.command("gamemode spectator StormPreview");
      const { x, y, z: depth, yaw, pitch } = viewpoint.spectator;
      const pose = `execute in minecraft:rwf run tp StormPreview ${x.toString()} ${y.toString()} ${depth.toString()} ${yaw.toString()} ${pitch.toString()}`;
      await rcon.command(pose);
      await request(session, "close");
      await waitFor(
        "native watcher at admitted-map viewpoint",
        async () => StatusSchema.parse(await request(session, "status")),
        (state) =>
          state.connected &&
          state.world === "minecraft:rwf" &&
          state.screen === "" &&
          Math.hypot(
            state.position[0] - x,
            state.position[1] - y,
            state.position[2] - depth,
          ) < 0.000001,
      );
      await Bun.sleep(20_000);
      const baseline = await collectFramePacing(session, {
        name: "baseline",
        context: {
          phase: "baseline",
          total: 0,
          map,
          match: null,
          serverInputs: inputs,
        },
      });
      expect(baseline.receipt.completion).toBe("DURATION");
      expect(baseline.receipt.measuredDurationNanos).toBe(60_000_000_000);
      const teams = map === "apex-expanse" ? 2 : 4;
      expect(
        await rcon.command(`rwf admin size team ${(total / teams).toString()}`),
      ).toContain(`${total.toString()} total`);
      bot.chat("/rwf join");
      await eventually(
        "ordinary mixed match goes live",
        async () => {
          const current = await status(rcon);
          return current.phase === "Live";
        },
        120_000,
      );
      const live = await status(rcon);
      expect([live.humans, live.bots]).toEqual([1, total - 1]);
      await request(session, "command", { text: "rwf spectate" });
      await rcon.command(pose);
      await Bun.sleep(20_000);
      const before = await status(rcon);
      expect(before.matchId).toBe(live.matchId);
      expect(before.phase).toBe("Live");
      const active = await collectFramePacing(session, {
        name: "active",
        context: {
          phase: "active",
          total,
          map,
          match: live.matchId,
          serverInputs: inputs,
        },
      });
      const after = await status(rcon);
      expect([after.phase, after.matchId, after.humans, after.bots]).toEqual([
        "Live",
        live.matchId,
        1,
        total - 1,
      ]);
      expect(active.receipt.completion).toBe("DURATION");
      expect(active.receipt.measuredDurationNanos).toBe(60_000_000_000);
      const comparison = compareFramePacing(baseline.receipt, active.receipt);
      await writeFile(
        path.join(artifacts, "comparison.json"),
        JSON.stringify(
          {
            schema: 1,
            map,
            total,
            inputs,
            viewpoint,
            viewpointSha256,
            before,
            after,
            baseline: baseline.file,
            active: active.file,
            comparison,
            performanceAccepted: false,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      console.warn(`Original MacBook frame pacing evidence: ${artifacts}`);
    } finally {
      bot.chat("/rwf leave");
      await client.stop();
      await eventually(
        "normal reset after native render measurement",
        async () => {
          const current = await status(rcon);
          const debug = await rcon.command("rwfbots debug");
          return (
            current.ready &&
            current.phase === "Lobby" &&
            current.humans === 0 &&
            debug.includes("no bots in the match")
          );
        },
        15 * 60_000,
      );
    }
  },
);
