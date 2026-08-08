import { formatRelativeDate } from "../lib/dates";
import { PRIORITY_LABELS } from "./priority";
import type {
  CaptureChipKind,
  CaptureMetadataChip,
  CaptureSeedMetadataChip,
} from "./quick-capture";
import type { CaptureSeed, CaptureSeedField } from "./quick-capture-seed";
import type { NlpParseResult } from "./types";

const CAPTURE_CHIP_ORDER: Record<CaptureChipKind, number> = {
  scheduled: 0,
  deadline: 1,
  project: 2,
  priority: 3,
  recurrence: 4,
  context: 5,
  tag: 6,
};

export function deriveSeedChips(
  seed: CaptureSeed,
  parsed: NlpParseResult,
  now: Date,
): readonly CaptureSeedMetadataChip[] {
  const chips: CaptureSeedMetadataChip[] = [];

  if (seed.scheduled !== undefined) {
    chips.push(
      seedMetadataChip(
        "scheduled",
        "scheduled",
        seed.scheduled,
        `Planned · ${formatRelativeDate(seed.scheduled, now)}`,
      ),
    );
  }
  if (seed.due !== undefined && parsed.due === undefined) {
    chips.push(
      seedMetadataChip(
        "due",
        "deadline",
        seed.due,
        `Deadline · ${formatRelativeDate(seed.due, now)}`,
      ),
    );
  }
  if (seed.project !== undefined) {
    chips.push(
      seedMetadataChip(
        "project",
        "project",
        seed.project,
        `Project · ${seed.project}`,
      ),
    );
  }
  if (seed.priority !== undefined && parsed.priority === undefined) {
    chips.push(
      seedMetadataChip(
        "priority",
        "priority",
        seed.priority,
        `Priority · ${PRIORITY_LABELS[seed.priority]}`,
      ),
    );
  }

  return chips;
}

export function compareCaptureChips(
  a: CaptureMetadataChip,
  b: CaptureMetadataChip,
): number {
  const kindOrder = CAPTURE_CHIP_ORDER[a.kind] - CAPTURE_CHIP_ORDER[b.kind];
  if (kindOrder !== 0) return kindOrder;
  if (a.origin === b.origin) return 0;
  return a.origin === "seed" ? -1 : 1;
}

export function mergeProjects(
  seededProject: string | undefined,
  parsedProjects: readonly string[] | undefined,
): readonly string[] {
  const projects = new Set<string>();
  if (seededProject !== undefined) projects.add(seededProject);
  for (const project of parsedProjects ?? []) projects.add(project);
  return [...projects];
}

function seedMetadataChip(
  seedField: CaptureSeedField,
  kind: CaptureChipKind,
  value: string,
  label: string,
): CaptureSeedMetadataChip {
  return {
    id: `seed-${seedField}`,
    origin: "seed",
    seedField,
    kind,
    label,
    value,
  };
}
