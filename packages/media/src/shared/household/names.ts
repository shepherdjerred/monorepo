import type { z } from "zod";
import type { RequestInterestCommandSchema } from "./interests.ts";

/**
 * Names a household member meets in two places: on a control in the web
 * client, and in a message Media sends that tells them to use it. Both read
 * them from here, so an email can never name a button or a page that is not
 * on screen.
 */

/** The views of the Library, as its view switch names them. */
export const LIBRARY_VIEW_NAMES = {
  all: "All",
  mine: "Mine",
  leaving: "Leaving soon",
  removed: "Removed",
} as const;

type InterestAction = z.infer<typeof RequestInterestCommandSchema>["action"];

/** What each request-interest command's button says. */
export const INTEREST_ACTION_NAMES = {
  continue: "Keep watching",
  finished: "I have finished it",
  drop: "Stop following",
  keep: "Keep for good",
  temporary: "Keep just for now",
  notice_viewed: "I have seen this reminder",
} as const satisfies Record<InterestAction, string>;

/**
 * The owner's switch for how long the library keeps a title, by the keeping
 * it switches to. It is in the Library's compact list.
 */
export const LIBRARY_KEEPING_NAMES = {
  keep: "Keep for good",
  temporary: "Keep just for now",
} as const;
