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
import { soundPackRouter } from "#src/trpc/router/sound-pack.router.ts";
import { eventRouter } from "#src/trpc/router/event.router.ts";
import { userRouter } from "#src/trpc/router/user.router.ts";
import { guildRouter } from "#src/trpc/router/guild.router.ts";
import { subscriptionRouter } from "#src/trpc/router/subscription.router.ts";
import { playerRouter } from "#src/trpc/router/player.router.ts";
import { competitionRouter } from "#src/trpc/router/competition.router.ts";
import { reportRouter } from "#src/trpc/router/report.router.ts";
import { exploreRouter } from "#src/trpc/router/explore.router.ts";
import { discordRouter } from "#src/trpc/router/discord.router.ts";
import { riotRouter } from "#src/trpc/router/riot.router.ts";
import { rolesRouter } from "#src/trpc/router/roles.router.ts";
import { consumerPlayerRouter } from "#src/trpc/router/consumer-player.router.ts";
import { consumerChampionRouter } from "#src/trpc/router/consumer-champion.router.ts";
import { consumerMatchRouter } from "#src/trpc/router/consumer-match.router.ts";
import { bucksRouter } from "#src/trpc/router/bucks.router.ts";
import { customsRouter } from "#src/trpc/router/customs.router.ts";
import { customsHistoryRouter } from "#src/trpc/router/customs-history.router.ts";

export const appRouter = router({
  auth: authRouter,
  telemetry: telemetryRouter,
  installAttribution: installAttributionRouter,
  feedback: feedbackRouter,
  soundPack: soundPackRouter,
  event: eventRouter,
  user: userRouter,
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
  bucks: bucksRouter,
  customs: customsRouter,
  customsHistory: customsHistoryRouter,
});

export type AppRouter = typeof appRouter;
type OutputsFor<TRouter extends AnyRouter> = inferRouterOutputs<TRouter>;
export type AppRouterOutputs = OutputsFor<AppRouter>;
