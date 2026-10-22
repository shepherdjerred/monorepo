import path from "node:path";

export async function overlaySafetyBrain(
  stormDir: string,
  baseUrl: string,
): Promise<void> {
  const safetyPath = path.join(stormDir, "safety.yml");
  const safetyConfig = await Bun.file(safetyPath).text();
  if (!/^brainUrl: .+$/mu.test(safetyConfig))
    throw new Error("Safety brainUrl is missing");
  await Bun.write(
    safetyPath,
    safetyConfig.replace(/^brainUrl: .+$/mu, `brainUrl: ${baseUrl}`),
  );
}

export type ModuleConfigOverrides = {
  /** Disposable rwfbots.yml contents; production-owned configuration stays untouched. */
  rwfbotsConfig?: string;
  /** Disposable compute.yml contents for explicit startup worker-budget calibration. */
  computeConfig?: string;
  survivalConfig?: string;
};

/** Write explicit module overrides only after copying the owned configuration. */
export async function stageModuleConfigs(
  stormDir: string,
  options: ModuleConfigOverrides,
): Promise<void> {
  for (const [file, content] of [
    ["compute.yml", options.computeConfig],
    ["rwfbots.yml", options.rwfbotsConfig],
    [path.join("arena", "survival.yml"), options.survivalConfig],
  ] as const) {
    if (content !== undefined)
      await Bun.write(path.join(stormDir, file), content);
  }
}

/** Staged test configuration overrides; repository-owned content stays untouched. */
export async function overlayBrainUrl(
  stagedAgentYml: string,
  baseUrl: string,
): Promise<void> {
  const content = await Bun.file(stagedAgentYml).text();
  const overlaid = content.replace(
    /^ {2}baseUrl: .*$/m,
    `  baseUrl: ${baseUrl}`,
  );
  if (overlaid === content) {
    throw new Error(`No brain.baseUrl line to overlay in ${stagedAgentYml}`);
  }
  await Bun.write(stagedAgentYml, overlaid);
}

export async function overlayAgentTopLevel(
  stagedAgentYml: string,
  agent: { mode: string; reviewSamplePercent: number },
): Promise<void> {
  await overlayFields(stagedAgentYml, agent, "", "top-level");
}

export async function overlaySweep(
  stagedAgentYml: string,
  sweep: {
    intervalMinutes: number;
    redriveAfterMinutes: number;
    redriveBackoffMinutes: number;
    slaAfterMinutes: number;
  },
): Promise<void> {
  await overlayFields(stagedAgentYml, sweep, "  ", "sweep");
}

/** The rwf.yml settings a suite overrides; durations are ISO-8601 (PT6S). */
export type RwfOverlay = {
  /** The map world matches are fought in. */
  world: string;
  /** The lobby world players wait in. */
  lobbyWorld: string;
  /** How long before the countdown ends the map vote closes; the owned value when absent. */
  voteLead?: string;
  /** How long members fly over the chosen map; the owned value when absent. */
  previewLength?: string;
  /** How long everyone stands frozen at their spawn; the owned value when absent. */
  freezeLength?: string;
  minHumans: number;
  /** Players a lobby wants before counting down; minHumans when absent. */
  minPlayers?: number;
  /** The fewest players that requirement relaxes to; minHumans when absent. */
  absoluteMinPlayers?: number;
  countdown: string;
  endLinger: string;
  noHumansAbort: string;
  /** How many combatants rwfbots fills a countdown to; the owned value when absent. */
  targetCombatants?: number;
  /** Test and training profiles keep fixed rosters unless explicitly testing map sizing. */
  automaticSizing?: boolean;
  /** The most combatants in a match; the owned value when absent. */
  maxCombatants?: number;
  /** Whether `/rwf admin loadtest <n>` is allowed; the owned value (off) when absent. */
  loadtest?: boolean;
  /**
   * The only map folders staged under rwf/maps; every shipped map when absent.
   * The rotation opens on the first map in id order, so a suite written for
   * the training yard stages it alone.
   */
  maps?: string[];
};

export async function overlayRwf(
  stagedRwfYml: string,
  rwf: RwfOverlay,
): Promise<void> {
  await overlaySection(stagedRwfYml, "worlds", {
    lobby: rwf.lobbyWorld,
    maps: rwf.world,
    lobbyProvisioning: "owned-void",
  });
  await overlaySection(stagedRwfYml, "match", {
    ...(rwf.voteLead === undefined ? {} : { voteLead: rwf.voteLead }),
    ...(rwf.previewLength === undefined
      ? {}
      : { previewLength: rwf.previewLength }),
    ...(rwf.freezeLength === undefined
      ? {}
      : { freezeLength: rwf.freezeLength }),
    minHumans: rwf.minHumans,
    minPlayers: rwf.minPlayers ?? rwf.minHumans,
    absoluteMinPlayers: rwf.absoluteMinPlayers ?? rwf.minHumans,
    automaticSizing: (rwf.automaticSizing ?? false).toString(),
    countdown: rwf.countdown,
    endLinger: rwf.endLinger,
    noHumansAbort: rwf.noHumansAbort,
    ...(rwf.targetCombatants === undefined
      ? {}
      : { targetCombatants: rwf.targetCombatants }),
    ...(rwf.maxCombatants === undefined
      ? {}
      : { maxCombatants: rwf.maxCombatants }),
  });
  if (rwf.loadtest !== undefined) {
    await overlaySection(stagedRwfYml, "loadtest", {
      enabled: rwf.loadtest.toString(),
    });
  }
}

/**
 * Overlays keys inside one top-level section only, so a key repeated in
 * several sections (`enabled` under recording and loadtest) hits the right one.
 */
async function overlaySection(
  file: string,
  section: string,
  fields: Record<string, string | number>,
): Promise<void> {
  const content = await Bun.file(file).text();
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === `${section}:`);
  if (start === -1) {
    throw new Error(`No ${section} section to overlay in ${file}`);
  }
  const after = lines.findIndex(
    (line, index) =>
      index > start && /^\S/u.test(line) && !line.startsWith("#"),
  );
  const end = after === -1 ? lines.length : after;
  for (const [key, value] of Object.entries(fields)) {
    const index = lines.findIndex(
      (line, at) => at > start && at < end && line.startsWith(`  ${key}: `),
    );
    if (index === -1) {
      throw new Error(`No ${section}.${key} line to overlay in ${file}`);
    }
    lines[index] = `  ${key}: ${value.toString()}`;
  }
  await Bun.write(file, lines.join("\n"));
}

async function overlayFields(
  file: string,
  fields: Record<string, string | number>,
  indent: string,
  section: string,
): Promise<void> {
  const content = await Bun.file(file).text();
  const lines = content.split("\n");
  for (const [key, value] of Object.entries(fields)) {
    const index = lines.findIndex((line) =>
      line.startsWith(`${indent}${key}: `),
    );
    if (index === -1)
      throw new Error(`No ${section}.${key} line to overlay in ${file}`);
    lines[index] = `${indent}${key}: ${value.toString()}`;
  }
  await Bun.write(file, lines.join("\n"));
}
