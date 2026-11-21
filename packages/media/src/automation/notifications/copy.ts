import {
  INTEREST_ACTION_NAMES,
  LIBRARY_KEEPING_NAMES,
  LIBRARY_VIEW_NAMES,
} from "#shared/household/names.ts";

/**
 * The words of the two messages that send a person to the web client to act.
 * Every control and page they name comes from `shared/household/names.ts`,
 * which the client's own labels come from too.
 *
 * Each message ends with its link on a line of its own.
 */

/** The "still watching?" check on one request a person still follows. */
export function interestCheckText(input: {
  title: string;
  link: string;
}): string {
  const { continue: keepWatching, finished, drop } = INTEREST_ACTION_NAMES;
  return [
    `You have unwatched content available for ${input.title}.`,
    `Choose ${keepWatching} within 7 days to continue following it, or ${finished} or ${drop} if you are done. Watching also renews your interest.`,
    `If you do not reply, your temporary interest will expire. The title stays while anyone else still wants it. Otherwise it spends 7 days under ${LIBRARY_VIEW_NAMES.leaving} in the Library, and its files can be restored for 7 days after that.`,
    `Opening this link does not change your request. It shows the request under ${LIBRARY_VIEW_NAMES.mine} in the Library.`,
    input.link,
  ].join("\n\n");
}

/**
 * The warning that a title nobody follows is about to leave. The owner is
 * also told where the library's own keeping is changed.
 */
export function retentionWarningText(input: {
  title: string;
  owner: boolean;
  link: string;
}): string {
  const forOwner = input.owner
    ? `, or ${LIBRARY_KEEPING_NAMES.keep} in the Library's compact list to keep it whoever follows it`
    : "";
  return `${input.title} is not kept for good and nobody follows it any more. It can leave the library after at least seven days, and its files can be restored for another seven days after that. Choose ${INTEREST_ACTION_NAMES.continue} under ${LIBRARY_VIEW_NAMES.mine} in the Library to follow it again${forOwner}. Opening this link changes nothing.\n${input.link}`;
}
