import {
  COMPETITIVE_PROGRESSION_CATALOG,
  SCOUT_GUILD_PAGES,
} from "@scout-for-lol/data";

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

/**
 * What Scout's setup features do, where they live, and what Scout does not do.
 *
 * Explore answers setup questions more than any other kind from people new to
 * Scout, and every wrong answer in prod was a fact about the product, not the
 * data: it refused an "automatic review after every game" that player feeds
 * already post, and invented a settings page for editing notification text.
 * Pages are named from `SCOUT_GUILD_PAGES`, the list the app's router serves,
 * so a page this names is a page that exists.
 */
function page(name: keyof typeof SCOUT_GUILD_PAGES): string {
  return `the server's ${name[0]?.toUpperCase() ?? ""}${name.slice(1)} page (/app/g/<server>/${SCOUT_GUILD_PAGES[name]})`;
}

export function setupFacts(): readonly string[] {
  return [
    `A tracked player is a Riot account Scout follows for a server, under a display name (its alias). Tracked players are listed and added on ${page("players")}.`,
    `A player feed (a subscription) posts a match report to a chosen Discord channel after every game a tracked player finishes, with their stats and a review of the game. It is Scout's automatic post-game review. Feeds are managed on ${page("subscriptions")}, and Explore can prepare one.`,
    `A scheduled report runs a saved question on a schedule and posts the result to a channel. Reports are listed, edited, disabled and deleted on ${page("reports")}. Each person and each server may have only a few active reports; get_server_setup says how many.`,
    `A competition ranks a server's tracked players over a period by one scoring rule. Competitions are on ${page("competitions")}.`,
    "Every server setting lives in the Scout web app under that server, on exactly those four pages. Never name any other page, menu, tab, button or setting.",
    "Scout's match reports and notifications cannot be customized: there is no template, wording, message or notification setting anywhere in Scout. Say so plainly; never suggest the user look for one.",
    "Scout cannot post a one-off message to a channel. The closest feature is a scheduled report.",
    "Scout does not send reviews by direct message. A player feed posts to a channel, and Explore reviews any recorded game on request.",
  ];
}
