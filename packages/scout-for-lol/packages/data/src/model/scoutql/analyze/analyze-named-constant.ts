import {
  closestChampionName,
  resolveReportChampion,
} from "#src/model/reports/report-query-champions.ts";
import {
  closestItemName,
  resolveReportItem,
} from "#src/model/reports/report-query-items.ts";
import type { ScoutQlDiagnosticCode } from "#src/model/scoutql/editor/diagnostics.ts";

// ── Named constants: champion('…') and item('…') ─────────────────────────────
// Both fold a display name to its numeric id at compile time, so a query
// compares ids and a misspelling is caught before it runs, with a suggestion.

type NamedConstantFunction = "champion" | "item";

const RESOLVERS: Record<
  NamedConstantFunction,
  {
    resolve: (name: string) => number | undefined;
    closest: (name: string) => string | undefined;
    unknownCode: ScoutQlDiagnosticCode;
  }
> = {
  champion: {
    resolve: (name) => resolveReportChampion(name)?.id,
    closest: closestChampionName,
    unknownCode: "champion-unknown",
  },
  item: {
    resolve: (name) => resolveReportItem(name)?.id,
    closest: closestItemName,
    unknownCode: "item-unknown",
  },
};

function resolverFor(fn: string) {
  return fn === "champion" || fn === "item" ? RESOLVERS[fn] : undefined;
}

export function isNamedConstantFunction(fn: string): boolean {
  return resolverFor(fn) !== undefined;
}

/** The id a named constant folds to, or undefined when the name is unknown. */
export function resolveNamedConstant(
  fn: string,
  name: string,
): number | undefined {
  return resolverFor(fn)?.resolve(name);
}

/** The diagnostic for an unknown name, with a suggestion when one is close. */
export function unknownNamedConstant(
  fn: string,
  name: string,
): { code: ScoutQlDiagnosticCode; message: string } | undefined {
  const resolver = resolverFor(fn);
  if (resolver === undefined || resolver.resolve(name) !== undefined) {
    return undefined;
  }
  const suggestion = resolver.closest(name);
  return {
    code: resolver.unknownCode,
    message: `Unknown ${fn} "${name}".${suggestion === undefined ? "" : ` Did you mean "${suggestion}"?`}`,
  };
}
