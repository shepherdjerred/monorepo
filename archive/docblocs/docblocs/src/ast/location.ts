/**
 * A location in the source text.
 */
export interface Location {
  line: number;
  char: number;
}

export function copyLoc(loc: Location) {
  return { line: loc.line, char: loc.char };
}
