import { type Augment } from "@scout-for-lol/data";

const DUO_TEAM_CARD_WIDTH = 480;
const TRIO_TEAM_CARD_WIDTH = 640;

export function getArenaTeamCardWidth(teamSize: number) {
  return teamSize === 2 ? DUO_TEAM_CARD_WIDTH : TRIO_TEAM_CARD_WIDTH;
}

export function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes.toString()}min ${secs.toString()}s`;
}

export function filterDisplayAugments(augs: Augment[]) {
  return augs.filter((a) => (a.type === "full" ? true : a.id > 0));
}
