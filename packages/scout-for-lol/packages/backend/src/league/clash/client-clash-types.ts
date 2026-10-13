export type ClientClashLabels = {
  readonly name: string;
  readonly abbreviation: string;
};

/** A named team, an unnamed roster in the bracket, or an explicit bye. */
export type ClientClashOpponent =
  | ({ readonly kind: "team" } & ClientClashLabels)
  | { readonly kind: "unknown" }
  | { readonly kind: "bye" };

export type ClientClashMatch = {
  readonly round: number | null;
  readonly opponent: ClientClashOpponent;
  readonly result: "won" | "lost" | "pending";
  readonly status: string | null;
  readonly gameIds: readonly string[];
};

export type ClientClashTeam = {
  readonly platformId: string | null;
  readonly rosterId: string;
  readonly tournamentId: string | null;
  readonly name: string;
  readonly abbreviation: string;
  readonly tier: number | null;
  readonly memberPuuids: readonly string[];
  readonly matches: readonly ClientClashMatch[];
  readonly capturedAt: Date;
};

export type ClientClashBracket = {
  readonly platformId: string | null;
  readonly tournamentId: string | null;
  readonly rosterId: string;
  readonly name: string;
  readonly abbreviation: string;
  readonly tier: number | null;
  /** Only the guild's tracked members are exposed by alias. */
  readonly memberAliases: readonly string[];
  readonly matches: readonly ClientClashMatch[];
  readonly capturedAt: string;
};
