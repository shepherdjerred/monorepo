export type RecurrenceOption = {
  readonly id: string;
  readonly label: string;
  readonly rule: string;
};

export const RECURRENCE_OPTIONS: readonly RecurrenceOption[] = [
  { id: "none", label: "Does not repeat", rule: "" },
  { id: "daily", label: "Daily", rule: "FREQ=DAILY" },
  {
    id: "weekdays",
    label: "Every weekday",
    rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  },
  { id: "weekly", label: "Weekly", rule: "FREQ=WEEKLY" },
  { id: "monthly", label: "Monthly", rule: "FREQ=MONTHLY" },
  { id: "yearly", label: "Yearly", rule: "FREQ=YEARLY" },
];

export function recurrenceOptionForId(
  id: string,
): RecurrenceOption | undefined {
  return RECURRENCE_OPTIONS.find((option) => option.id === id);
}

export function recurrenceOptionForRule(
  rule: string,
): RecurrenceOption | undefined {
  return RECURRENCE_OPTIONS.find((option) => option.rule === rule);
}

export function isCuratedRecurrenceRule(rule: string): boolean {
  return recurrenceOptionForRule(rule) !== undefined;
}

export function recurrenceRuleLabel(rule: string): string {
  if (rule.length === 0) return "Does not repeat";
  return recurrenceOptionForRule(rule)?.label ?? "Custom rule";
}
