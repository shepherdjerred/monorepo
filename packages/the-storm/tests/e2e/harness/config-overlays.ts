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
  world: string;
  minHumans: number;
  countdown: string;
  endLinger: string;
  noHumansAbort: string;
  /** How many combatants rwfbots fills a countdown to; the owned value when absent. */
  targetCombatants?: number;
  /** The most combatants in a match; the owned value when absent. */
  maxCombatants?: number;
  /** Whether `/rwf admin loadtest <n>` is allowed; the owned value (off) when absent. */
  loadtest?: boolean;
  /** The most match credits one player earns a day; the owned value when absent. */
  dailyCap?: number;
};

export async function overlayRwf(
  stagedRwfYml: string,
  rwf: RwfOverlay,
): Promise<void> {
  await overlayFields(stagedRwfYml, { world: rwf.world }, "", "top-level");
  await overlaySection(stagedRwfYml, "match", {
    minHumans: rwf.minHumans,
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
  if (rwf.dailyCap !== undefined) {
    await overlaySection(stagedRwfYml, "rewards", {
      dailyCap: rwf.dailyCap,
    });
  }
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
  const start = lines.indexOf(`${section}:`);
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
