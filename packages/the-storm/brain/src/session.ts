import type { Bot } from "mineflayer";
import type { PilotConfig } from "./config.ts";
import { inPilotWindow, onlinePlayers, windowEndDelayMs } from "./policy.ts";

type Stop =
  | { reason: "human-left" | "window-end" | "disconnected" }
  | { reason: "failure"; error: Error };

export type SessionOutcome = "no-human" | Exclude<Stop["reason"], "failure">;

export type SessionRcon = {
  command: (command: string) => Promise<string>;
  onFailure: (listener: (error: Error) => void) => () => void;
};

/** The small event and roster surface the session needs from Mineflayer. */
export type SessionClient = {
  username: () => string;
  playerNames: () => string[];
  onSpawn: (listener: () => void) => () => void;
  onError: (listener: () => void) => () => void;
  onEnd: (listener: () => void) => () => void;
  onKicked: (listener: () => void) => () => void;
  onPlayerJoined: (listener: (name: string) => void) => () => void;
  onPlayerLeft: (listener: (name: string) => void) => () => void;
};

export function mineflayerClient(bot: Bot): SessionClient {
  return {
    username: () => bot.username,
    playerNames: () => Object.keys(bot.players),
    onSpawn: (listener) => {
      bot.on("spawn", listener);
      return () => {
        bot.off("spawn", listener);
      };
    },
    onError: (listener) => {
      bot.on("error", listener);
      return () => {
        bot.off("error", listener);
      };
    },
    onEnd: (listener) => {
      bot.on("end", listener);
      return () => {
        bot.off("end", listener);
      };
    },
    onKicked: (listener) => {
      bot.on("kicked", listener);
      return () => {
        bot.off("kicked", listener);
      };
    },
    onPlayerJoined: (listener) => {
      const handler = (player: { username: string }) => {
        listener(player.username);
      };
      bot.on("playerJoined", handler);
      return () => {
        bot.off("playerJoined", handler);
      };
    },
    onPlayerLeft: (listener) => {
      const handler = (player: { username: string }) => {
        listener(player.username);
      };
      bot.on("playerLeft", handler);
      return () => {
        bot.off("playerLeft", handler);
      };
    },
  };
}

function waitForSpawn(client: SessionClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new Error("bot spawn timed out"));
    }, 30_000);
    const offSpawn = client.onSpawn(() => {
      finish();
    });
    const offError = client.onError(() => {
      finish(new Error("bot connection failed"));
    });
    const offEnd = client.onEnd(() => {
      finish(new Error("bot disconnected before spawn"));
    });
    const offKicked = client.onKicked(() => {
      finish(new Error("bot was kicked before spawn"));
    });
    function finish(error?: Error) {
      clearTimeout(timer);
      offSpawn();
      offError();
      offEnd();
      offKicked();
      if (error === undefined) resolve();
      else reject(error);
    }
  });
}

function outcome(stop: Stop): SessionOutcome {
  if (stop.reason === "failure") throw stop.error;
  return stop.reason;
}

function matchingHumans(client: SessionClient, list: string): string[] {
  const online = onlinePlayers(list);
  if (!online.includes(client.username())) {
    throw new Error("bot left before the post-spawn presence check completed");
  }
  const listed = new Set(online.filter((name) => name !== client.username()));
  return client
    .playerNames()
    .filter((name) => name !== client.username() && listed.has(name));
}

async function confirmPresence(options: {
  client: SessionClient;
  rcon: SessionRcon;
  firstList: string;
  stopped: Promise<Stop>;
  config: PilotConfig;
  now: () => Date;
}): Promise<
  | { kind: "humans"; names: string[] }
  | { kind: "stop"; value: Stop }
  | { kind: "window-end" }
> {
  const { client, rcon, firstList, stopped, config, now } = options;
  const first = matchingHumans(client, firstList);
  if (first.length > 0) return { kind: "humans", names: first };
  // The roster can change while the first RCON reply is in flight.
  const refreshed = await Promise.race([
    rcon.command("list").then((list) => ({ kind: "list" as const, list })),
    stopped.then((value) => ({ kind: "stop" as const, value })),
  ]);
  if (refreshed.kind === "stop") return refreshed;
  return inPilotWindow(config, now())
    ? { kind: "humans", names: matchingHumans(client, refreshed.list) }
    : { kind: "window-end" };
}

/** Holds one authorized bot only while the window and human presence remain verified. */
export async function runSession(
  client: SessionClient,
  rcon: SessionRcon,
  config: PilotConfig,
  now: () => Date = () => new Date(),
): Promise<SessionOutcome> {
  let ready = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const humans = new Set<string>();
  let stop!: (value: Stop) => void;
  const stopped = new Promise<Stop>((resolve) => {
    stop = resolve;
  });
  const offError = client.onError(() => {
    stop({ reason: "failure", error: new Error("bot connection failed") });
  });
  const offEnd = client.onEnd(() => {
    stop({ reason: "disconnected" });
  });
  const offKicked = client.onKicked(() => {
    stop({ reason: "disconnected" });
  });
  const offJoined = client.onPlayerJoined((name) => {
    if (ready && name !== client.username()) humans.add(name);
  });
  const offLeft = client.onPlayerLeft((name) => {
    if (!ready || name === client.username()) return;
    humans.delete(name);
    // Mineflayer removes the player from its roster before this event.
    if (
      humans.size === 0 &&
      !client.playerNames().some((player) => player !== client.username())
    ) {
      stop({ reason: "human-left" });
    }
  });
  const offRcon = rcon.onFailure(() => {
    stop({ reason: "failure", error: new Error("RCON connection lost") });
  });
  try {
    const spawned = await Promise.race([
      waitForSpawn(client).then(() => true),
      stopped.then(() => false),
    ]);
    if (!spawned) return outcome(await stopped);
    if (client.username() !== config.botPlayerName) {
      throw new Error(
        "connected Minecraft profile does not match configured pilot name",
      );
    }
    const checked = await Promise.race([
      rcon.command("list").then((list) => ({ kind: "list" as const, list })),
      stopped.then((value) => ({ kind: "stop" as const, value })),
    ]);
    if (checked.kind === "stop") return outcome(checked.value);
    if (!inPilotWindow(config, now())) return "window-end";
    const presence = await confirmPresence({
      client,
      rcon,
      firstList: checked.list,
      stopped,
      config,
      now,
    });
    if (presence.kind === "stop") return outcome(presence.value);
    if (presence.kind === "window-end") return "window-end";
    for (const name of presence.names) humans.add(name);
    if (humans.size === 0) return "no-human";
    ready = true;
    deadline = setTimeout(
      () => {
        stop({ reason: "window-end" });
      },
      windowEndDelayMs(config, now()),
    );
    return outcome(await stopped);
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    offRcon();
    offError();
    offEnd();
    offKicked();
    offJoined();
    offLeft();
  }
}
