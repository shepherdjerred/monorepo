import type { FilterConfig } from "./filters";

export type SavedView = {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly filter: FilterConfig;
  readonly color: string;
};

export const DEFAULT_SAVED_VIEWS: readonly SavedView[] = [
  {
    id: "job-search",
    name: "Job Search",
    icon: "briefcase",
    filter: { projects: ["[[2026 Job Search]]"] },
    color: "#6366f1",
  },
  {
    id: "school",
    name: "School",
    icon: "book-open",
    filter: { contexts: ["school"] },
    color: "#22c55e",
  },
];
