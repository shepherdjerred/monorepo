import {
  SCOUT_DESKTOP_API_ROUTES,
  ScoutDesktopCoachReviewRequestSchema,
  ScoutDesktopCoachReviewResponseSchema,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { readCoachReview } from "#src/coach/review.ts";
import { prisma } from "#src/database/index.ts";
import { isOwnerFlagEnabled } from "./auth.ts";
import { desktopErrorResponse, desktopJsonResponse } from "./contract.ts";
import {
  invalidRequest,
  type DesktopRoute,
  type DesktopRouteHandler,
} from "./explore-run-routes.ts";

/**
 * `coach/reviews/get`: the post-game review the server produced for a game
 * this owner recorded. The server starts it (`scoutCoachReviewWorkflow`); the
 * desktop only reads. A game with no review, and a game another user recorded,
 * answer the same `not_found`. Under `scout_desktop_coach` like every coach
 * surface.
 */
const getCoachReview: DesktopRouteHandler = async ({ caller, body }) => {
  const input = ScoutDesktopCoachReviewRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  if (
    !(await isOwnerFlagEnabled(
      "scout_desktop_coach",
      caller.userId,
      caller.guildIds,
    ))
  ) {
    return desktopErrorResponse(
      "feature_disabled",
      "Scout Coach is turned off for you.",
    );
  }
  const review = await readCoachReview(
    prisma,
    caller.userId,
    RiotMatchIdSchema.parse(input.data.matchId),
  );
  return review === null
    ? desktopErrorResponse("not_found", "No review for this game.")
    : desktopJsonResponse(ScoutDesktopCoachReviewResponseSchema.parse(review));
};

export const DESKTOP_COACH_ROUTES: readonly (readonly [
  string,
  DesktopRoute,
])[] = [
  [
    SCOUT_DESKTOP_API_ROUTES.coach_reviews_get.path,
    { handler: getCoachReview, maxBodyBytes: 1024 },
  ],
];
