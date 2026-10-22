/**
 * The per-server pages of the Scout web app, under `/app/g/<guildId>/`.
 *
 * One list, read by the app's router and by everything that tells a person
 * where to go — Explore's product facts above all. Explore once sent a user
 * to an "Explore → Notifications → Edit message" page that never existed; a
 * page a model may name has to be a page the router actually serves.
 */
export const SCOUT_GUILD_PAGES = {
  players: "players",
  subscriptions: "subscriptions",
  reports: "reports",
  competitions: "competitions",
  hallOfFame: "hall-of-fame",
  customs: "customs",
  audit: "audit",
  access: "access",
} as const;

export type ScoutGuildPage = keyof typeof SCOUT_GUILD_PAGES;
