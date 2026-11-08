import { describe, expect, onTestFinished } from "vitest";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { publishedPort } from "@shepherdjerred/mc-harness/providers/docker/paper-container.ts";
import { test } from "#e2e/fixtures.ts";
import { waitUntil } from "#e2e/harness/bot.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";
import { serverLogs } from "#e2e/harness/external/files.ts";

async function restart(server: ServerInfo): Promise<RconClient> {
  if (server.kind !== "container")
    throw new Error("Restart test requires its own container");
  await docker(["restart", server.containerId]);
  const rconPort = await publishedPort(server.containerId, 25_575);
  let connection: RconClient | undefined;
  await waitUntil(
    "Paper RCON after restart",
    async () => {
      try {
        connection = await RconClient.connect({
          host: rconPort.host,
          port: rconPort.port,
          password: server.rconPassword,
          timeoutMs: 1000,
        });
        return true;
      } catch {
        return false;
      }
    },
    120_000,
  );
  if (connection === undefined) throw new Error("Paper RCON did not connect");
  return connection;
}

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "double")(
  "historical double chest stock",
  () => {
    test("counts existing goods in both halves before adding stock", async ({
      rcon,
    }) => {
      await rcon.command("forceload add 138 -97");
      await waitUntil(
        "historical shop registered",
        async () => {
          const data = await rcon.command(
            "data get block 138 69 -97 PublicBukkitValues",
          );
          return data.includes("shop_id");
        },
        30_000,
      );
      const first = await rcon.command("data get block 138 68 -97 Items");
      const second = await rcon.command("data get block 139 68 -97 Items");
      expect(first).not.toContain("minecraft:iron_ingot");
      expect(second).toMatch(/minecraft:iron_ingot/);
      expect(second).toMatch(/count: 40/);
    });
  },
);

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "double-split")(
  "historical double chest split stock",
  () => {
    test("stocks across both halves and safely recovers on restart", async ({
      rcon,
      server,
    }) => {
      await rcon.command("forceload add 158 -128");
      await waitUntil(
        "historical shop registered",
        async () => {
          const data = await rcon.command(
            "data get block 158 68 -126 PublicBukkitValues",
          );
          return data.includes("shop_id");
        },
        30_000,
      );
      for (const x of ["158", "159"]) {
        const marker = await rcon.command(
          `data get block ${x} 67 -128 PublicBukkitValues`,
        );
        for (const slot of ["23", "24", "25", "26"]) {
          const item = await rcon.command(
            `data get block ${x} 67 -128 Items[{Slot:${slot}b}].id`,
          );
          expect(item).toContain("minecraft:arrow");
          const count = await rcon.command(
            `data get block ${x} 67 -128 Items[{Slot:${slot}b}].count`,
          );
          expect(count).toMatch(/64/);
        }
        expect(marker).toContain("heritage_stock_");
      }
      await waitUntil(
        "initial shop registry ready",
        async () => {
          const logs = await serverLogs(server);
          return /Loaded \d+ shops/.test(logs);
        },
        30_000,
      );
      await rcon.command("save-all flush");
      const restarted = await restart(server);
      onTestFinished(() => restarted.close());
      await waitUntil(
        "shop registry ready after restart",
        async () => {
          const logs = await serverLogs(server);
          return (logs.match(/Loaded \d+ shops/g) ?? []).length >= 2;
        },
        30_000,
      );
      expect(await serverLogs(server)).not.toContain(
        "Historical shop 2015-pikachupals-arrows has incomplete saved world data",
      );
      await restarted.command("forceload add 158 -128");
      await waitUntil(
        "restored stock marker",
        async () => {
          const marker = await restarted.command(
            "data get block 159 67 -128 PublicBukkitValues",
          );
          return marker.includes("heritage_stock_");
        },
        30_000,
      );
      const preserved = await restarted.command(
        "data get block 159 67 -128 Items[{Slot:23b}].count",
      );
      expect(preserved).toMatch(/64/);
      await restarted.command(
        "data remove block 159 67 -128 PublicBukkitValues",
      );
      await restarted.command("save-all flush");
      const damaged = await restart(server);
      onTestFinished(() => damaged.close());
      await waitUntil(
        "incomplete shop closed",
        async () => {
          const logs = await serverLogs(server);
          return logs.includes(
            "Historical shop 2015-pikachupals-arrows has incomplete saved world data",
          );
        },
        30_000,
      );
      await damaged.command("forceload add 158 -128");
      const after = await damaged.command(
        "data get block 159 67 -128 Items[{Slot:23b}].count",
      );
      expect(after).toMatch(/64/);
    }, 180_000);
  },
);

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_SHOPS"] !== "double-space")(
  "historical double chest space",
  () => {
    test("stocks the other half when the sign's half is full", async ({
      rcon,
    }) => {
      await rcon.command("forceload add 138 -97");
      await waitUntil(
        "historical shop registered",
        async () => {
          const data = await rcon.command(
            "data get block 138 69 -97 PublicBukkitValues",
          );
          return data.includes("shop_id");
        },
        30_000,
      );
      const first = await rcon.command("data get block 138 68 -97 Items");
      const second = await rcon.command("data get block 139 68 -97 Items");
      const marker = await rcon.command(
        "data get block 139 68 -97 PublicBukkitValues",
      );
      expect(first).not.toContain("minecraft:iron_ingot");
      expect(second).toContain("minecraft:iron_ingot");
      expect(second).toMatch(/count: 32/);
      expect(marker).toContain("heritage_stock_");
    });
  },
);
