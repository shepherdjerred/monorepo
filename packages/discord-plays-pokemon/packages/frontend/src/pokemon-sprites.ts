export function pokemonSpriteUrl(
  nationalDexNumber: number,
  shiny = false,
): string {
  if (
    !Number.isSafeInteger(nationalDexNumber) ||
    nationalDexNumber < 1 ||
    nationalDexNumber > 386
  ) {
    throw new Error(
      `Invalid Emerald National Dex sprite number: ${String(nationalDexNumber)}`,
    );
  }
  const shinyPath = shiny ? "shiny/" : "";
  return `/pokemon-sprites/emerald/${shinyPath}${String(nationalDexNumber)}.png`;
}
