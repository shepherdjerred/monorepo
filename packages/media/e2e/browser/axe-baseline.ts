/**
 * Known WCAG 2.2 AA violations in the client as it ships today.
 *
 * This list must only shrink. The redesign pull requests fix these and
 * delete the matching routes; nothing may be added here to make a new
 * violation pass. The smoke test compares it exactly at both viewports, so
 * it fails when a page gains a violation that is not listed and also when a
 * listed violation has been fixed but its route was left behind.
 */
export type KnownViolation = {
  /** axe rule id. */
  rule: string;
  /** What is wrong in the client, so the fix is obvious. */
  cause: string;
  /** Route labels from `routes.ts` where the rule fails today. */
  routes: readonly string[];
};

export const KNOWN_VIOLATIONS: readonly KnownViolation[] = [
  {
    rule: "document-title",
    cause:
      "PageTitle renders `<title>{title} · Media</title>`, which gives the " +
      "element two text children. React only writes a title whose child is " +
      "a single string, so it inserts an empty `<title>` ahead of the one in " +
      "index.html and `document.title` is empty on every page built on " +
      "PageTitle. `/admin/migration` does not use PageTitle and keeps the " +
      "title from index.html.",
    routes: [
      "member /",
      "member /requests",
      "member /calendar",
      "member /activity",
      "member /removals",
      "member /removed",
      "member /catalog/movie/:id",
      "member /catalog/series/:id",
      "member /media/:protection-only",
      "member /library",
      "member /history",
      "member /notifications",
      "member /recovery",
      "member /media/:movie",
      "member /media/:series",
      "owner /admin",
      "owner /library",
      "owner /history",
      "owner /notifications",
      "owner /recovery",
      "owner /media/:movie",
      "owner /media/:series",
    ],
  },
];
