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

export const appRouter = router({
  auth: authRouter,
  soundPack: soundPackRouter,
  event: eventRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
