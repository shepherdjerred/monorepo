import { paper } from "#src/pins.ts";

/**
 * The environment every disposable Paper server shares: pinned version,
 * offline mode (no Microsoft auth for local clients), a cheap peaceful world,
 * and no third-party default downloads so boot stays hermetic. Provider
 * independent: Docker and Kubernetes sandboxes pass it unchanged.
 */
export function basePaperEnv(): Record<string, string> {
  return {
    EULA: "TRUE",
    TYPE: "PAPER",
    VERSION: paper.version,
    PAPER_BUILD: paper.build.toString(),
    ONLINE_MODE: "FALSE",
    SKIP_DOWNLOAD_DEFAULTS: "true",
    MEMORY: "1G",
    LEVEL_TYPE: "minecraft:flat",
    GENERATE_STRUCTURES: "false",
    SPAWN_PROTECTION: "0",
    DIFFICULTY: "peaceful",
    MODE: "survival",
    VIEW_DISTANCE: "4",
    SIMULATION_DISTANCE: "4",
    ENABLE_AUTOPAUSE: "false",
  };
}
