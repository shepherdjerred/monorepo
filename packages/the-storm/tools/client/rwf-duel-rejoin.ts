export type RwfDuelStatus = {
  phase: string;
  humans: number;
};

export type RejoinState = {
  humanJoined: boolean;
  matchStarted: boolean;
};

export const EMPTY_REJOIN_STATE: RejoinState = {
  humanJoined: false,
  matchStarted: false,
};

const MATCH_PHASES = new Set(["Countdown", "Live", "Ended", "Resetting"]);

/** Rejoin only after this preview's human has played a complete match. */
export function observeDuelStatus(
  state: RejoinState,
  status: RwfDuelStatus,
): { state: RejoinState; shouldRejoin: boolean } {
  const humanJoined = state.humanJoined || status.humans > 0;
  const matchStarted =
    state.matchStarted || (humanJoined && MATCH_PHASES.has(status.phase));
  return matchStarted && status.phase === "Lobby" && status.humans === 0
    ? { state: EMPTY_REJOIN_STATE, shouldRejoin: true }
    : { state: { humanJoined, matchStarted }, shouldRejoin: false };
}

/** Rejoin the local preview and wait until the roster accepts the human before selecting Trooper. */
export async function rejoinTrooperDuel(options: {
  readStatus: () => Promise<RwfDuelStatus>;
  sendCommand: (command: string) => Promise<unknown>;
  shouldStop: () => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<boolean> {
  const intervalMs = options.intervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const sleep = options.sleep ?? Bun.sleep;
  if (options.shouldStop()) return false;
  await options.sendCommand("rwf join");
  const deadline = performance.now() + timeoutMs;
  while (!options.shouldStop() && performance.now() < deadline) {
    const status = await options.readStatus();
    if (
      (status.phase === "Lobby" || status.phase === "Countdown") &&
      status.humans > 0
    ) {
      await options.sendCommand("rwf kit trooper");
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
}

/** Polls one-human RWF preview matches and queues the player for the next duel. */
export async function watchRwfDuels(options: {
  readStatus: () => Promise<RwfDuelStatus>;
  sendCommand: (command: string) => Promise<unknown>;
  shouldStop: () => boolean;
  onRejoined: () => void;
  onError: (error: unknown) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  intervalMs?: number;
}): Promise<void> {
  const intervalMs = options.intervalMs ?? 500;
  const sleep = options.sleep ?? Bun.sleep;
  let state = EMPTY_REJOIN_STATE;
  for (;;) {
    if (options.shouldStop()) return;
    let status: RwfDuelStatus;
    try {
      status = await options.readStatus();
    } catch (error) {
      if (options.shouldStop()) return;
      options.onError(error);
      await sleep(intervalMs);
      continue;
    }
    const observation = observeDuelStatus(state, status);
    state = observation.state;
    if (observation.shouldRejoin)
      state = await tryRejoin(options, sleep, intervalMs);
    await sleep(intervalMs);
  }
}

async function tryRejoin(
  options: {
    readStatus: () => Promise<RwfDuelStatus>;
    sendCommand: (command: string) => Promise<unknown>;
    shouldStop: () => boolean;
    onRejoined: () => void;
    onError: (error: unknown) => void;
  },
  sleep: (milliseconds: number) => Promise<void>,
  intervalMs: number,
): Promise<RejoinState> {
  try {
    const joined = await rejoinTrooperDuel({
      readStatus: options.readStatus,
      sendCommand: options.sendCommand,
      shouldStop: options.shouldStop,
      sleep,
      intervalMs,
    });
    if (joined) {
      options.onRejoined();
      return EMPTY_REJOIN_STATE;
    }
  } catch (error) {
    if (options.shouldStop()) return EMPTY_REJOIN_STATE;
    options.onError(error);
    await sleep(Math.max(intervalMs, 1000));
  }
  return { humanJoined: true, matchStarted: true };
}
