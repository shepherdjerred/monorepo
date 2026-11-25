import type { AutoReadRule } from "@shepherdjerred/feeds/shared/contract.ts";

export function matchesAutoReadRule(
  rule: AutoReadRule | null | undefined,
  entry: { readonly title: string },
): boolean {
  if (rule === null || rule === undefined) {
    return false;
  }
  const regex = new RegExp(rule.pattern, rule.flags);
  const matched = regex.test(entry.title);
  return rule.negate === true ? !matched : matched;
}
