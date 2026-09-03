import { describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { relationalDareActionEnabled } from "#src/betting/dare-v2-common.ts";
import { prisma } from "#src/database/index.ts";

describe("Dare SQL v3 rollout policy", () => {
  test("blocks v3 actions after disablement", async () => {
    const serverId = DiscordGuildIdSchema.parse("1337623164146155593");
    const dependencies = {
      prismaClient: prisma,
      isPolicyEnabled: (flag: string) =>
        Promise.resolve(flag === "betting_enabled"),
    };
    await expect(
      relationalDareActionEnabled(serverId, "dare-sql-3", dependencies),
    ).resolves.toBe(false);
    await expect(
      relationalDareActionEnabled(serverId, "dare-sql-3", dependencies),
    ).resolves.toBe(false);
  });
});
