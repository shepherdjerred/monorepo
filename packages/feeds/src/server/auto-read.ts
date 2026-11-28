import {
  normalizeAutoReadRules,
  type AutoReadRule,
  type SingleAutoReadRule,
} from "@shepherdjerred/feeds/shared/contract.ts";

export type AutoReadCandidate = {
  readonly title: string;
  readonly url?: string | undefined;
  readonly categories?: readonly string[] | undefined;
};

function matchesSingleAutoReadRule(
  rule: SingleAutoReadRule,
  entry: AutoReadCandidate,
): boolean {
  const regex = new RegExp(rule.pattern, rule.flags);
  if (rule.field === "category") {
    const categories = entry.categories ?? [];
    if (rule.negate === true && categories.length === 0) {
      return false;
    }
    const matched = categories.some((category) => regex.test(category));
    return rule.negate === true ? !matched : matched;
  }
  const target = rule.field === "url" ? (entry.url ?? "") : entry.title;
  const matched = regex.test(target);
  return rule.negate === true ? !matched : matched;
}

export function matchesAutoReadRule(
  rule: AutoReadRule | null | undefined,
  entry: AutoReadCandidate,
): boolean {
  return (
    rule !== null &&
    rule !== undefined &&
    normalizeAutoReadRules(rule).some((single) =>
      matchesSingleAutoReadRule(single, entry),
    )
  );
}
