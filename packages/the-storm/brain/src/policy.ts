import type { PilotConfig } from "./config.ts";

/** Evaluate one instant in the configured local time zone, including DST days. */
export function inPilotWindow(config: PilotConfig, instant: Date): boolean {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  const localHour = Number.parseInt(hour, 10);
  return localHour >= config.startHour && localHour < config.endHour;
}

const LIST =
  /^There are (?<online>\d+) of a max of (?<max>\d+) players online: ?(?<names>.*)$/u;

/** Fail closed if Paper changes `/list` format or its count disagrees. */
export function humanPlayers(listOutput: string, botName: string): string[] {
  const match = LIST.exec(listOutput.trim());
  const online = Number(match?.groups?.["online"]);
  const names = match?.groups?.["names"];
  if (match === null || names === undefined || !Number.isSafeInteger(online)) {
    throw new Error("cannot verify human presence from RCON list output");
  }
  const players = names === "" ? [] : names.split(", ");
  if (players.length !== online || new Set(players).size !== players.length) {
    throw new Error("RCON player count does not match names");
  }
  return players.filter((player) => player !== botName);
}
