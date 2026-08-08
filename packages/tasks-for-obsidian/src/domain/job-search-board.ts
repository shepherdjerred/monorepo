import { deriveSavedViewTasks } from "./saved-view-collection";
import type { SavedView } from "./saved-views";
import type { Task } from "./types";

export const JOB_SEARCH_SAVED_VIEW_ID = "job-search";
export const JOB_SEARCH_COLUMN_KEYS = [
  "identified",
  "applied",
  "screener",
] as const;

export type JobSearchColumnKey = (typeof JOB_SEARCH_COLUMN_KEYS)[number];

const JOB_SEARCH_COLUMN_KEY_SET = new Set<string>(JOB_SEARCH_COLUMN_KEYS);

export type JobSearchBoardSource = {
  readonly view: SavedView;
  readonly tasks: readonly Task[];
};

export type JobSearchMovePatch = {
  readonly tags: string[];
  readonly extraFields: Record<string, unknown>;
};

export function jobSearchColumnKey(
  task: Pick<Task, "extraFields" | "tags">,
): JobSearchColumnKey {
  const raw = task.extraFields["company_status"];
  const status = typeof raw === "string" ? raw.toLowerCase() : "";
  if (JOB_SEARCH_COLUMN_KEY_SET.has(status)) {
    if (status === "applied" || status === "screener") return status;
    return "identified";
  }

  for (const tag of task.tags) {
    const normalized = String(tag).toLowerCase();
    if (normalized === "applied" || normalized === "screener") {
      return normalized;
    }
    if (normalized === "identified") return "identified";
  }
  return "identified";
}

export function jobSearchMovePatch(
  task: Pick<Task, "extraFields" | "tags">,
  columnKey: string,
): JobSearchMovePatch {
  if (!JOB_SEARCH_COLUMN_KEY_SET.has(columnKey)) {
    throw new TypeError(`Unknown Job Search column: ${columnKey}`);
  }
  const tags = task.tags
    .map(String)
    .filter((tag) => !JOB_SEARCH_COLUMN_KEY_SET.has(tag.toLowerCase()));
  tags.push(columnKey);
  return {
    tags,
    extraFields: {
      ...task.extraFields,
      company_status: columnKey,
    },
  };
}

/**
 * Resolves the Job Search board from the same editable saved-view definition
 * used by its list. Keeping this projection ID-based lets a user rename or
 * refine that view without silently leaving the board on its seed query.
 */
export function deriveJobSearchBoardSource(
  tasks: readonly Task[],
  views: readonly SavedView[],
  referenceDay: string,
): JobSearchBoardSource | null {
  const view = views.find(
    (candidate) => candidate.id === JOB_SEARCH_SAVED_VIEW_ID,
  );
  if (view === undefined) return null;

  return {
    view,
    tasks: deriveSavedViewTasks(tasks, view, referenceDay),
  };
}
