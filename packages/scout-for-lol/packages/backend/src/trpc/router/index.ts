/**
 * Main tRPC Router
 *
 * Combines all sub-routers into a single app router.
 */

import { router } from "#src/trpc/trpc.ts";
import { authRouter } from "#src/trpc/router/auth.router.ts";
import { soundPackRouter } from "#src/trpc/router/sound-pack.router.ts";
import { eventRouter } from "#src/trpc/router/event.router.ts";
import { userRouter } from "#src/trpc/router/user.router.ts";
import { guildRouter } from "#src/trpc/router/guild.router.ts";
import { subscriptionRouter } from "#src/trpc/router/subscription.router.ts";
import { playerRouter } from "#src/trpc/router/player.router.ts";
import { competitionRouter } from "#src/trpc/router/competition.router.ts";
import { reportRouter } from "#src/trpc/router/report.router.ts";

export const appRouter = router({
  auth: authRouter,
  soundPack: soundPackRouter,
  event: eventRouter,
  user: userRouter,
  guild: guildRouter,
  subscription: subscriptionRouter,
  player: playerRouter,
  competition: competitionRouter,
  report: reportRouter,
});

export type AppRouter = typeof appRouter;
