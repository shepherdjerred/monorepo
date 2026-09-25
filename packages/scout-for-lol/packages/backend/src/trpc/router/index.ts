/**
 * Main tRPC Router
 *
 * Combines all sub-routers into a single app router.
 */

import { router } from "#src/trpc/trpc.ts";
import type { AnyRouter, inferRouterOutputs } from "@trpc/server";
import { authRouter } from "#src/trpc/router/auth.router.ts";
import { telemetryRouter } from "#src/trpc/router/telemetry.router.ts";
import { installAttributionRouter } from "#src/trpc/router/install-attribution.router.ts";
import { feedbackRouter } from "#src/trpc/router/feedback.router.ts";
import { guildRouter } from "#src/trpc/router/guild.router.ts";
import { subscriptionRouter } from "#src/trpc/router/subscription.router.ts";
import { playerRouter } from "#src/trpc/router/player.router.ts";
import { competitionRouter } from "#src/trpc/router/competitions/competition.router.ts";
import { reportRouter } from "#src/trpc/router/report.router.ts";
import { exploreRouter } from "#src/trpc/router/explore/explore.router.ts";
import { discordRouter } from "#src/trpc/router/discord.router.ts";
import { riotRouter } from "#src/trpc/router/riot.router.ts";
import { rolesRouter } from "#src/trpc/router/roles.router.ts";
import { consumerPlayerRouter } from "#src/trpc/router/consumer/consumer-player.router.ts";
import { consumerChampionRouter } from "#src/trpc/router/consumer/consumer-champion.router.ts";
import { consumerMatchRouter } from "#src/trpc/router/consumer/consumer-match.router.ts";
import { bucksRouter } from "#src/trpc/router/bucks/bucks.router.ts";
import { exploreMatchRouter } from "#src/trpc/router/explore/explore-match.router.ts";
import { customsRouter } from "#src/trpc/router/customs.router.ts";
import { customsHistoryRouter } from "#src/trpc/router/customs-history.router.ts";
import { hallRouter } from "#src/trpc/router/hall.router.ts";
import { challengeRouter } from "#src/trpc/router/challenge.router.ts";
import { clashRouter } from "#src/trpc/router/clash/clash.router.ts";
import { duelRouter } from "#src/trpc/router/competitions/duel.router.ts";
import { operationsRouter } from "#src/trpc/router/operations/operations.router.ts";
import { mvpVotesRouter } from "#src/trpc/router/mvp-votes.router.ts";
import { scoutClientRouter } from "#src/trpc/router/scout-client.router.ts";

export const appRouter = router({
  auth: authRouter,
  telemetry: telemetryRouter,
  installAttribution: installAttributionRouter,
  feedback: feedbackRouter,
  guild: guildRouter,
  subscription: subscriptionRouter,
  player: playerRouter,
  competition: competitionRouter,
  report: reportRouter,
  explore: exploreRouter,
  discord: discordRouter,
  riot: riotRouter,
  roles: rolesRouter,
  consumerPlayer: consumerPlayerRouter,
  consumerChampion: consumerChampionRouter,
  consumerMatch: consumerMatchRouter,
  exploreMatch: exploreMatchRouter,
  bucks: bucksRouter,
  customs: customsRouter,
  customsHistory: customsHistoryRouter,
  hall: hallRouter,
  challenge: challengeRouter,
  clash: clashRouter,
  duel: duelRouter,
  operations: operationsRouter,
  mvpVotes: mvpVotesRouter,
  scoutClient: scoutClientRouter,
});

export type AppRouter = typeof appRouter;
type OutputsFor<TRouter extends AnyRouter> = inferRouterOutputs<TRouter>;
export type AppRouterOutputs = OutputsFor<AppRouter>;
