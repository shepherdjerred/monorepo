export type ScoutTemporalHealth = {
  readonly state: "starting" | "connected" | "degraded" | "stopping";
  readonly workerCount: number;
  readonly discordWorkersEnabled: boolean;
  readonly lastError: string | null;
};

let health: ScoutTemporalHealth = {
  state: "starting",
  workerCount: 0,
  discordWorkersEnabled: false,
  lastError: null,
};

export function getScoutTemporalHealth(): ScoutTemporalHealth {
  return health;
}

export function setScoutTemporalHealth(next: ScoutTemporalHealth): void {
  health = next;
}
