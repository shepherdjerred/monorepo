import { describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { relationalDareActionEnabled } from "#src/betting/dare-v2-common.ts";
import { prisma } from "#src/database/index.ts";

describe("Dare SQL v3 rollout policy", () => {
  test("blocks new funding after disablement without blocking funded actions", async () => {
    const serverId = DiscordGuildIdSchema.parse("1337623164146155593");
    const dependencies = {
      prismaClient: prisma,
      isPolicyEnabled: (flag: string) =>
        Promise.resolve(flag === "betting_enabled"),
    };
    await expect(
      relationalDareActionEnabled(
        serverId,
        "dare-scoutql-3",
        true,
        dependencies,
      ),
    ).resolves.toBe(false);
    await expect(
      relationalDareActionEnabled(
        serverId,
        "dare-scoutql-3",
        false,
        dependencies,
      ),
    ).resolves.toBe(true);
  });
});
