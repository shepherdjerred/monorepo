import { SPECIES_TO_NATIONAL } from "./generated/species.ts";

export function nationalDexNumber(internalSpeciesId: number): number {
  const value = SPECIES_TO_NATIONAL[internalSpeciesId];
  if (value === undefined || value <= 0) {
    throw new Error(
      `species ${String(internalSpeciesId)} has no National Dex mapping`,
    );
  }
  return value;
}
