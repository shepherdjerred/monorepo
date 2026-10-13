import { expect } from "vitest";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { eventually, waitForLobby } from "#e2e/harness/rwf-match.ts";
import {
  docker,
  serverLogs,
} from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { publishedPort } from "@shepherdjerred/mc-harness/providers/docker/paper-container.ts";

const lobby = "minecraft:rwf_lobby";
const sentinel = "256 64 256";
const LobbyIdsSchema = z.array(z.uuid()).nonempty();

function lobbyIds(logs: string): string[] {
  return LobbyIdsSchema.parse(
    [...logs.matchAll(/rwf: owned lobby rwf_lobby uuid=([a-f0-9-]{36})/gu)].map(
      (match) => match[1],
    ),
  );
}

/** Dedicated local acceptance: restart only this suite's owned disposable container. */
test("RWF creates its absent void lobby and preserves its UUID and terrain across restart", async ({
  server,
  rcon,
}) => {
  if (server.kind !== "container") {
    throw new Error(
      "RWF restart acceptance requires an owned disposable Docker server",
    );
  }
  await waitForLobby(rcon);
  const before = await serverLogs(server);
  expect(before).toContain("RWF fixture lobby loaded before module: false");
  const ids = lobbyIds(before);
  const boots = [...before.matchAll(/Done \(/gu)].length;
  await rcon.command(`execute in ${lobby} run forceload add 256 256`);
  expect(
    await rcon.command(
      `execute in ${lobby} if block ${sentinel} minecraft:air`,
    ),
  ).toBe("Test passed");
  await rcon.command(
    `execute in ${lobby} run setblock ${sentinel} minecraft:diamond_block`,
  );
  await rcon.command("save-all flush");
  rcon.close();

  await docker(["stop", "--time", "30", server.containerId]);
  await docker(["start", server.containerId]);
  await eventually(
    "a new Paper startup with the same owned lobby",
    async () => {
      const logs = await serverLogs(server);
      return (
        lobbyIds(logs).length > ids.length &&
        [...logs.matchAll(/Done \(/gu)].length > boots
      );
    },
    120_000,
  );
  // Docker may assign another ephemeral host port when this container starts again.
  const rconPort = await publishedPort(server.containerId, 25_575);
  const restored = await RconClient.connect({
    host: rconPort.host,
    port: rconPort.port,
    password: server.rconPassword,
  });
  try {
    await waitForLobby(restored);
    expect(lobbyIds(await serverLogs(server)).at(-1)).toBe(ids.at(-1));
    expect(
      await restored.command(
        `execute in ${lobby} if block ${sentinel} minecraft:diamond_block`,
      ),
    ).toBe("Test passed");
  } finally {
    await restored.command(
      `execute in ${lobby} run setblock ${sentinel} minecraft:air`,
    );
    await restored.command(`execute in ${lobby} run forceload remove 256 256`);
    restored.close();
  }
}, 180_000);
