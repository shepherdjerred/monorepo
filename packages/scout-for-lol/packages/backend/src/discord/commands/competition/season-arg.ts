import { getSeasonChoices, type SeasonId } from "@scout-for-lol/data";

const MAX_CHOICES = 25;

/**
 * Suggest current and future seasons for Discord's autocomplete boundary.
 * Discord permits typed autocomplete values, so command execution still
 * validates the submitted ID with SeasonIdSchema.
 */
export function suggestSeasonCompletions(
  focused: string,
  now: Date = new Date(),
): { name: string; value: SeasonId }[] {
  const query = focused.trim().toLowerCase();
  return getSeasonChoices(now)
    .filter(
      (choice) =>
        choice.name.toLowerCase().includes(query) ||
        choice.value.toLowerCase().includes(query),
    )
    .slice(0, MAX_CHOICES);
}
