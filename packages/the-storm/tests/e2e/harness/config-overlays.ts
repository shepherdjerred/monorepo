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
