import { COMPETITIVE_PROGRESSION_CATALOG } from "@scout-for-lol/data";

/**
 * Facts about how Scout's own features work, true without any query.
 *
 * Explore is told these in its prompt, and repeats them in answers: "multi-kills
 * are not a Hall of Fame record", "records are split by queue family, never by
 * role". The replay judge, which never sees Explore's prompt, graded those as
 * figures no query produced. Both now read them from here, generated from the
 * catalog, so the prompt and the rubric cannot disagree about the product.
 */

/** What the Hall of Fame is: its closed record list and how it is split. */
export function hallOfFameFacts(): readonly string[] {
  const { records, queueFamilies } = COMPETITIVE_PROGRESSION_CATALOG.hall;
  const recordLabels = records.map((record) => record.label).join("; ");
  const familyLabels = queueFamilies
    .map(
      (family) =>
        `${family.label}${family.defaultEnabled ? " (on by default)" : ""}`,
    )
    .join("; ");
  return [
    `Scout's Hall of Fame is a per-server board of single-game records. It holds these records and no others: ${recordLabels}.`,
    `Each record is kept separately for every queue family the server has switched on: ${familyLabels}. Records are split by queue family, never by role, position or champion — there are no 'support records', only records that support players may hold.`,
    "A game counts only if it finished normally, lasted at least five minutes, did not end in an early surrender, was not a custom game, and ended after the server started tracking.",
    "KDA, kill participation, longest or fastest game, multi-kill counts and a role's board are not Hall records.",
  ];
}

/** What Scout challenges are not: they have no end date and no reward. */
export function challengeFacts(): readonly string[] {
  return [
    "Scout challenges have no end date: a challenge run stays active until it is completed or archived.",
    "Scout challenges carry no reward, prize or Bryan Bucks payout.",
  ];
}
