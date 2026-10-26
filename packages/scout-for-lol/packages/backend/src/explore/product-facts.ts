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
    "Scout challenges carry no reward or prize.",
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
const PAGE_LABELS: Readonly<Record<keyof typeof SCOUT_GUILD_PAGES, string>> = {
  players: "Players",
  subscriptions: "Subscriptions",
  reports: "Reports",
  competitions: "Competitions",
  hallOfFame: "Hall of Fame settings",
  customs: "Custom games",
  audit: "Audit log",
  access: "Access",
};

function page(name: keyof typeof SCOUT_GUILD_PAGES): string {
  return `the server's ${PAGE_LABELS[name]} page (/app/g/<server>/${SCOUT_GUILD_PAGES[name]})`;
}

export function setupFacts(): readonly string[] {
  return [
    `A tracked player is a Riot account Scout follows for a server, under a display name (its alias). Tracked players are listed and added on ${page("players")}.`,
    `A player feed (a subscription) posts a match report with the player's stats to a chosen Discord channel after each game a tracked player finishes that the feed covers. It is Scout's automatic post-game report. A feed can be limited to certain queues by its filters, and can be muted; a muted or filtered-out game is not posted. Some reports also carry a written AI review, but only when the server has AI reviews switched on and the game stands out, so never promise a review after every game. Feeds are managed on ${page("subscriptions")}, and Explore can prepare one.`,
    `A scheduled report runs a saved question on a schedule and posts the result to a channel. Reports are listed, edited, disabled and deleted on ${page("reports")}. Each person and each server may have only a few active reports; get_server_setup says how many.`,
    `A competition ranks a server's tracked players over a period by one scoring rule. Competitions are on ${page("competitions")}.`,
    `The server's other pages are ${page("hallOfFame")}, ${page("access")} (who may manage what in Scout), ${page("audit")} and ${page("customs")}.`,
    "Every server setting lives in the Scout web app under that server, on the pages named here. Never name any other page, menu, tab, button or setting.",
    "The wording of Scout's match reports and posts cannot be customized: there is no template or message-text setting anywhere in Scout. Say so plainly; never suggest the user look for one.",
    "Dare notification preferences live on the Dares settings page. Each person can choose lifecycle and progress DMs; these choices do not change match reports or message wording.",
    "Scout cannot post a one-off message to a channel. The closest feature is a scheduled report.",
    "Scout does not send reviews by direct message. A player feed posts to a channel, and Explore reviews any recorded game on request.",
  ];
}
