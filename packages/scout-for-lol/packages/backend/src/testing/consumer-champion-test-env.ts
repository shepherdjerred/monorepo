import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  seedGroup as seedChampionGroup,
  writeLobbies as writeChampionLobbies,
} from "#src/testing/consumer-champion-group.ts";
import { seedConsumerPlayer } from "#src/testing/consumer-player-seed.ts";
import {
  configureConsumerProfileFeatureTest,
  registerConsumerProfileFeatureTestLifecycle,
} from "#src/testing/consumer-profile-feature-test.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

/**
 * The shared setup of the champion-page router suites: two rollout servers,
 * the offline tRPC harness acting as the viewer, an empty database and lake
 * before every test, and the group's seeding helpers bound to them. Call it
 * once at the top of a test file, after any `vi.mock`.
 */
export async function createChampionPageTestEnv(
  testName: string,
  options: { onPrepare?: () => void } = {},
) {
  const guildId = DiscordGuildIdSchema.parse("100000000000000051");
  const otherGuildId = DiscordGuildIdSchema.parse("100000000000000052");
  const viewerDiscordId = DiscordAccountIdSchema.parse("300000000000000051");
  const profileFeature = configureConsumerProfileFeatureTest([
    guildId,
    otherGuildId,
  ]);
  const trpc = await createOfflineTrpcHarness(testName);
  const { prisma } = trpc;
  const { lakeDir } = profileFeature;

  registerConsumerProfileFeatureTestLifecycle({
    feature: profileFeature,
    prepare: async () => {
      options.onPrepare?.();
      trpc.setMembership([{ guildId, asAdmin: false }]);
      await prisma.account.deleteMany();
      await prisma.player.deleteMany();
      await profileFeature.resetLake();
    },
    cleanup: async () => {
      await prisma.$disconnect();
    },
  });

  return {
    guildId,
    otherGuildId,
    lakeDir,
    profileFeature,
    trpc,
    caller: () => trpc.authedCaller(viewerDiscordId),
    seedGroup: () =>
      seedChampionGroup(prisma, { guildId, otherGuildId, viewerDiscordId }),
    seedPlayer: (player: Parameters<typeof seedConsumerPlayer>[2]) =>
      seedConsumerPlayer(prisma, viewerDiscordId, player),
    writeLobbies: (
      lobbies: Parameters<typeof writeChampionLobbies>[2],
      extra?: Parameters<typeof writeChampionLobbies>[3],
    ) =>
      writeChampionLobbies(lakeDir, { guildId, otherGuildId }, lobbies, extra),
  };
}
