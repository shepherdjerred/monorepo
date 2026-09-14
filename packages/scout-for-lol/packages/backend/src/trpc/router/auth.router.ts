/**
 * Auth Router
 *
 * The Discord OAuth web sign-in flow lives in `auth-web.ts` as plain HTTP
 * routes (`/api/auth/discord/start`, `/api/auth/discord/callback`) because
 * setting HttpOnly cookies and 302-redirecting is awkward through tRPC.
 * This router carries the `me` / `meWeb` profile lookups.
 */

import {
  router,
  protectedProcedure,
  publicProcedure,
  webProcedure,
} from "#src/trpc/trpc.ts";

export const authRouter = router({
  /**
   * Get current user info
   */
  me: protectedProcedure.query(({ ctx }) => {
    return {
      discordId: ctx.user.discordId,
      username: ctx.user.discordUsername,
      avatar: ctx.user.discordAvatar,
      createdAt: ctx.user.createdAt,
    };
  }),

  /**
   * Get the currently signed-in web user (from scout_session cookie).
   * Returns 401 if not signed in.
   */
  meWeb: webProcedure.query(({ ctx }) => {
    return {
      discordId: ctx.user.discordId,
      username: ctx.user.discordUsername,
      avatar: ctx.user.discordAvatar,
      createdAt: ctx.user.createdAt,
    };
  }),

  /**
   * "Am I signed in?" — answers with `{ user: null }` when the caller has no
   * session instead of throwing UNAUTHORIZED.
   *
   * The SPA asks this on every page load (route loaders, the guild picker, the
   * onboarding wizard). Using `meWeb` for it meant each anonymous visit raised
   * a pair of UNAUTHORIZED errors, which drowned the logs — 185 ERROR lines in
   * 30 days against 21 real sign-ins — and made genuine auth faults impossible
   * to spot. Not being signed in is a normal answer, not an error.
   */
  sessionState: publicProcedure.query(({ ctx }) => {
    if (ctx.webSession === null || ctx.user === null) {
      return { user: null };
    }
    return {
      user: {
        discordId: ctx.user.discordId,
        username: ctx.user.discordUsername,
        avatar: ctx.user.discordAvatar,
        createdAt: ctx.user.createdAt,
        // Opaque analytics identity. The SPA identifies PostHog with this
        // rather than `discordId`, which must never leave as a distinct id.
        analyticsUserId: ctx.user.analyticsUserId,
      },
    };
  }),
});
