import { paper } from "#src/pins.ts";
import { paperJarName } from "#sandbox/artifacts.ts";

/**
 * Where the itzg image gets the Paper jar.
 *
 * - `seeded`: the pinned jar is already in `/data` (staged by the provider
 *   from the host cache), so the image runs it as a custom server. With the
 *   Paperclip warm cache mounted, server bootstrap needs no downloads. Plugin
 *   libraries may still need network access. The
 *   `PAPER` type cannot do this: mc-image-helper's `install-paper` resolves
 *   `VERSION`/`PAPER_BUILD` against the PaperMC API on every boot, even when
 *   the jar is already present.
 * - `download`: no jar is seeded; the image downloads the pinned build itself.
 */
export type PaperJarSource = "seeded" | "download";

/**
 * The environment every disposable Paper server shares: pinned version,
 * offline mode (no Microsoft auth for local clients), a cheap peaceful world,
 * and no third-party default downloads. Provider independent: Docker and
 * Kubernetes sandboxes pass it unchanged.
 */
export function basePaperEnv(jar: PaperJarSource): Record<string, string> {
  return {
    EULA: "TRUE",
    ...(jar === "seeded"
      ? { TYPE: "CUSTOM", CUSTOM_SERVER: `/data/${paperJarName}` }
      : {
          TYPE: "PAPER",
          VERSION: paper.version,
          PAPER_BUILD: paper.build.toString(),
        }),
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
