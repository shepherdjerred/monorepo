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

/** The Microsoft token cache must be usable by its owner and inaccessible to others. */
export function privateAuthCacheMode(mode: number): boolean {
  return (mode & 0o777) === 0o700;
}

/** One session deadline; this is a safety timeout, not a recurring start schedule. */
export function windowEndDelayMs(config: PilotConfig, instant: Date): number {
  if (!inPilotWindow(config, instant)) {
    throw new Error("pilot session is outside its configured window");
  }
  const start = instant.getTime();
  const hour = 60 * 60 * 1000;
  let upper = start + hour;
  for (let checked = 0; checked < 25; checked++) {
    if (!inPilotWindow(config, new Date(upper))) break;
    upper += hour;
  }
  if (inPilotWindow(config, new Date(upper))) {
    throw new Error("cannot find pilot window end");
  }
  let lower = upper - hour;
  while (lower + 1 < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (inPilotWindow(config, new Date(middle))) lower = middle;
    else upper = middle;
  }
  return upper - start;
}

const LIST =
  /^There are (?<online>\d+) of a max of (?<max>\d+) players online: ?(?<names>.*)$/u;

/** Fail closed if Paper changes `/list` format or its count disagrees. */
export function onlinePlayers(listOutput: string): string[] {
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
  return players;
}

export function humanPlayers(listOutput: string, botName?: string): string[] {
  return onlinePlayers(listOutput).filter((player) => player !== botName);
}
