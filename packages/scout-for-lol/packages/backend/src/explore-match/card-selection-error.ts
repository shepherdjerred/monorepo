/** A model selected an artifact outside the latest query's supported results. */
export class ExploreCardSelectionError extends Error {
  readonly cardType: "match" | "loadout";

  constructor(cardType: "match" | "loadout", message: string) {
    super(message);
    this.name = "ExploreCardSelectionError";
    this.cardType = cardType;
  }
}
