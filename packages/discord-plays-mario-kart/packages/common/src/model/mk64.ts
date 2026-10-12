// MK64's internal course and character ids, as the game state reports them
// (the decomp's COURSE_* and character enums). Shared so the page can label
// stats without the backend sending names.

export const COURSE_NAMES: readonly string[] = [
  "Mario Raceway",
  "Choco Mountain",
  "Bowser's Castle",
  "Banshee Boardwalk",
  "Yoshi Valley",
  "Frappe Snowland",
  "Koopa Troopa Beach",
  "Royal Raceway",
  "Luigi Raceway",
  "Moo Moo Farm",
  "Toad's Turnpike",
  "Kalimari Desert",
  "Sherbet Land",
  "Rainbow Road",
  "Wario Stadium",
  "Block Fort",
  "Skyscraper",
  "Double Deck",
  "D.K.'s Jungle Parkway",
  "Big Donut",
];

export const CHARACTER_NAMES: readonly string[] = [
  "Mario",
  "Luigi",
  "Yoshi",
  "Toad",
  "Donkey Kong",
  "Wario",
  "Peach",
  "Bowser",
];

export function courseName(courseId: number): string {
  return COURSE_NAMES[courseId] ?? `Course ${String(courseId)}`;
}

export function characterName(characterId: number): string {
  return CHARACTER_NAMES[characterId] ?? `Character ${String(characterId)}`;
}
