import { readFile } from "node:fs/promises";
import { z } from "zod";
import { PlexExclusionPlanSchema } from "#shared/plex-exclusion.ts";
import { ProbeJournalSchema } from "#filesystem/plex-exclusion-state.ts";
import { stageExclusionProbe } from "#filesystem/plex-exclusion-probe.ts";

const path = z.string().min(1).parse(process.argv[2]);
const fixture = z
  .object({ plan: PlexExclusionPlanSchema, journal: ProbeJournalSchema })
  .parse(JSON.parse(await readFile(path, "utf8")));
await stageExclusionProbe(fixture.plan, fixture.journal, {
  authorize: () => Promise.resolve(),
  checkpoint: () => Promise.resolve(),
  save: (journal) => {
    if (journal.positive !== null && journal.negative === null)
      process.kill(process.pid, "SIGKILL");
    return Promise.resolve();
  },
});
