import type { ChallengeFrozenValue } from "@scout-for-lol/data";
import { browserChampions } from "@scout-for-lol/data/browser-assets";
import { ChampionPortrait } from "@scout-for-lol/design-system/assets";
import { cn } from "#src/lib/cn.ts";

const KNOWN_CHAMPION_IDS = new Set(
  browserChampions.map((champion) => champion.id),
);
const CHAMPION_ID_PATTERN = /^[1-9]\d*$/;

export type ChampionCoverageEntry = {
  readonly id: number;
  readonly label: string;
  readonly completed: boolean;
};

function parseChampionId(value: string): number | null {
  if (!CHAMPION_ID_PATTERN.test(value)) return null;
  return Number.parseInt(value, 10);
}

/**
 * Champion-shaped distinct progress uses numeric champion IDs as frozen values.
 * Roles, queues, and other labels stay on the name list.
 *
 * Unknown numeric IDs fail here instead of rendering a name list or a
 * placeholder portrait.
 */
export function championCoverageFromDistinct(progress: {
  readonly covered: readonly ChallengeFrozenValue[];
  readonly missing: readonly ChallengeFrozenValue[];
}): ChampionCoverageEntry[] | null {
  const entries = [...progress.covered, ...progress.missing];
  if (entries.length === 0) return null;

  const ids: number[] = [];
  for (const entry of entries) {
    const id = parseChampionId(entry.value);
    if (id === null) return null;
    ids.push(id);
  }

  const covered = new Set(progress.covered.map((entry) => entry.value));
  const coverage: ChampionCoverageEntry[] = [];
  for (const [index, id] of ids.entries()) {
    const entry = entries[index];
    if (entry === undefined) {
      throw new Error("Champion coverage entries are shorter than their ids");
    }
    if (!KNOWN_CHAMPION_IDS.has(id)) {
      throw new Error(`Unknown champion id ${id.toString()}`);
    }
    coverage.push({
      id,
      label: entry.label,
      completed: covered.has(entry.value),
    });
  }
  return coverage.toSorted((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export function ChallengeChampionCoverage(props: {
  readonly entries: readonly ChampionCoverageEntry[];
}) {
  return (
    <ul
      className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1"
      aria-label="Champion coverage"
    >
      {props.entries.map((entry) => (
        <li key={entry.id}>
          <ChampionPortrait
            champion={entry.id}
            alt={`${entry.label}${entry.completed ? ", completed" : ", remaining"}`}
            title={entry.label}
            className={cn(
              "size-10 rounded-md",
              entry.completed ? undefined : "grayscale",
            )}
            style={{ width: 40, height: 40 }}
          />
        </li>
      ))}
    </ul>
  );
}
