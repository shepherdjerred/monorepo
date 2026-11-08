import { describe } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { waitUntil } from "#e2e/harness/bot.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_MECHANICS"] !== "1")(
  "historical clocks",
  () => {
    test("toggles its original output in both directions", async ({ rcon }) => {
      await rcon.command("forceload add 71 -39");
      for (const powered of ["true", "false"]) {
        await waitUntil(
          `clock output ${powered}`,
          async () => {
            const result = await rcon.command(
              `execute if block 71 57 -37 minecraft:lever[powered=${powered}]`,
            );
            return result.includes("Test passed");
          },
          15_000,
        );
      }
    });

    test("toggles both original Lysergia outputs", async ({ rcon }) => {
      await rcon.command("forceload add 1237 -788 1244 -788");
      for (const [x, y, z] of [
        [1239, 66, -788],
        [1244, 65, -790],
      ] as const) {
        for (const powered of ["true", "false"]) {
          await waitUntil(
            `Lysergia clock ${x.toString()} ${y.toString()} ${z.toString()} output ${powered}`,
            async () => {
              const result = await rcon.command(
                `execute if block ${x.toString()} ${y.toString()} ${z.toString()} minecraft:lever[powered=${powered}]`,
              );
              return result.includes("Test passed");
            },
            15_000,
          );
        }
      }
    });
  },
);
