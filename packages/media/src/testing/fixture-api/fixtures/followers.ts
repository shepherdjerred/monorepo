import type { z } from "zod";
import type { MediaDetailSchema } from "#shared/api.ts";
import {
  ALEX,
  KIDS,
  SAM,
  personaUser,
  type Persona,
} from "#testing/fixture-api/personas.ts";
import { libraryPolicy } from "./library.ts";
import { requestInterest, requestList } from "./requests.ts";
import { FEATURED, type Title } from "./titles.ts";

type Followers = z.input<typeof MediaDetailSchema>["followers"];

/** The household members other than the reader who follow a title. */
function others(title: Title, readerFollows: boolean): string[] {
  if (title === FEATURED.movie || title === FEATURED.series) {
    return [SAM.displayName];
  }
  // A managed profile is named as itself, not as the owner who asked for it.
  if (title === FEATURED.protectionOnly) {
    return [KIDS.displayName];
  }
  // A title the library holds only while it is followed has a follower.
  return !readerFollows && libraryPolicy(title) === "temporary"
    ? [ALEX.displayName]
    : [];
}

/**
 * Who follows a title, as both personas read it: names only, the reader first.
 * The reader is on the list exactly when the title page's `requests` holds
 * their own standing request for the title that still follows it.
 */
export function titleFollowers(title: Title, persona: Persona): Followers {
  const reader = personaUser(persona);
  const readerFollows = requestList(persona).some(
    (request) =>
      request.active &&
      request.mediaId === title.id &&
      requestInterest(request.id, persona).interestState === "following",
  );
  return [
    ...(readerFollows ? [{ displayName: reader.displayName, me: true }] : []),
    ...others(title, readerFollows).map((displayName) => ({
      displayName,
      me: false,
    })),
  ];
}
