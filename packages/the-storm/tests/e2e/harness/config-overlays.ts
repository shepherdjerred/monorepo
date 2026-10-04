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
};

export async function overlayRwf(
  stagedRwfYml: string,
  rwf: RwfOverlay,
): Promise<void> {
  await overlayFields(stagedRwfYml, { world: rwf.world }, "", "top-level");
  await overlayFields(
    stagedRwfYml,
    {
      minHumans: rwf.minHumans,
      countdown: rwf.countdown,
      endLinger: rwf.endLinger,
      noHumansAbort: rwf.noHumansAbort,
    },
    "  ",
    "match",
  );
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
