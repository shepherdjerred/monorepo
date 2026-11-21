/**
 * Known WCAG 2.2 AA violations in the client as it ships today.
 *
 * The list is empty and must stay that way: nothing may be added here to
 * make a new violation pass. The smoke test compares it exactly at both
 * viewports and in both color schemes, so a page that gains a violation
 * fails, and so would a listed violation whose fix left its route behind.
 */
export type KnownViolation = {
  /** axe rule id. */
  rule: string;
  /** What is wrong in the client, so the fix is obvious. */
  cause: string;
  /** Route labels from `routes.ts` where the rule fails today. */
  routes: readonly string[];
};

export const KNOWN_VIOLATIONS: readonly KnownViolation[] = [];
