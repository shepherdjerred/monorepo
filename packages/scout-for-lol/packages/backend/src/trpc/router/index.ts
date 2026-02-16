/**
 * Main tRPC Router
 *
 * Combines all sub-routers into a single app router.
 */

import { router } from "@scout-for-lol/backend/trpc/trpc.ts";
import { authRouter } from "@scout-for-lol/backend/trpc/router/auth.router.ts";
import { soundPackRouter } from "@scout-for-lol/backend/trpc/router/sound-pack.router.ts";
import { eventRouter } from "@scout-for-lol/backend/trpc/router/event.router.ts";
import { userRouter } from "@scout-for-lol/backend/trpc/router/user.router.ts";

export const appRouter = router({
  auth: authRouter,
  soundPack: soundPackRouter,
  event: eventRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
