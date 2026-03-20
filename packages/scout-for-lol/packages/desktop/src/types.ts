export type LcuStatus = {
  connected: boolean;
  summonerName: string | null;
  inGame: boolean;
};

export type BackendStatus = {
  connected: boolean;
  backendUrl: string | null;
  lastError: string | null;
};

export type Config = {
  clientId: string;
  apiToken: string | null;
  backendUrl: string | null;
};

export type LogEntry = {
  timestamp: string;
  level: "info" | "error" | "warning";
  message: string;
};

export type LogPaths = {
  logs_dir: string;
  debug_log: string;
  startup_log: string;
};

export type Section = "league" | "backend" | "monitor";

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unknown error occurred";
}
