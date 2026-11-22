import type { HubGrid } from "#shared/hub/hub-contract.ts";
import { IdentifierSchema } from "#shared/contract.ts";

/** A service as a filter offers it: its id and the title the overview shows. */
export type CatalogService = {
  id: string;
  title: string;
  environments: { id: string; name: string }[];
};

/** Every active service the overview lists, flattened out of its groups. */
export function catalogServices(grid: HubGrid | undefined): CatalogService[] {
  return (grid?.groups ?? []).flatMap((group) => group.services);
}

/**
 * What a typed filter value means: the id the server filters by, or a
 * sentence saying why it cannot be used. A value the catalog does not know
 * but the server would accept passes through, so a retired service still
 * filters its history.
 */
export type Resolved =
  | { id: string | undefined; problem: null }
  | { id: undefined; problem: string };

const NONE: Resolved = { id: undefined, problem: null };

function fold(value: string) {
  return value.trim().toLowerCase();
}

function list(names: string[]) {
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} and others` : shown;
}

/** Pick the one candidate a rule finds; several are a question for the reader. */
function decide(
  value: string,
  matches: { id: string; label: string }[],
  noun: string,
): Resolved | null {
  const ids = [...new Set(matches.map((match) => match.id))];
  const [only] = ids;
  if (only === undefined) return null;
  if (ids.length === 1) return { id: only, problem: null };
  return {
    id: undefined,
    problem: `“${value}” matches ${String(ids.length)} ${noun}s: ${list(
      matches.map((match) => match.label),
    )}. Choose one from the list.`,
  };
}

function unknown(value: string, noun: string): Resolved {
  return IdentifierSchema.safeParse(value).success
    ? { id: value, problem: null }
    : {
        id: undefined,
        problem: `No ${noun} is named “${value}”. Choose one from the list.`,
      };
}

/**
 * A service filter by id or by title, exact first, then the one service whose
 * id or title contains what was typed.
 */
export function resolveService(
  value: string | undefined,
  services: readonly CatalogService[],
): Resolved {
  if (value === undefined) return NONE;
  const wanted = fold(value);
  const entries = services.map((service) => ({
    id: service.id,
    label: service.title,
    names: [fold(service.id), fold(service.title)],
  }));
  return (
    decide(
      value,
      entries.filter((entry) => entry.names.includes(wanted)),
      "service",
    ) ??
    decide(
      value,
      entries.filter((entry) =>
        entry.names.some((name) => name.includes(wanted)),
      ),
      "service",
    ) ??
    unknown(value, "service")
  );
}

/**
 * An environment filter by id (`arcade/prod`), or by name (`prod`) within the
 * chosen service or when only one service has an environment of that name.
 */
export function resolveEnvironment(
  value: string | undefined,
  services: readonly CatalogService[],
  serviceId: string | undefined,
): Resolved {
  if (value === undefined) return NONE;
  const wanted = fold(value);
  const scoped =
    serviceId === undefined
      ? services
      : services.filter((service) => service.id === serviceId);
  const entries = services.flatMap((service) =>
    service.environments.map((environment) => ({
      id: environment.id,
      label: environment.id,
      name: fold(environment.name),
      inScope: scoped.includes(service),
    })),
  );
  return (
    decide(
      value,
      entries.filter((entry) => fold(entry.id) === wanted),
      "environment",
    ) ??
    decide(
      value,
      entries.filter((entry) => entry.inScope && entry.name === wanted),
      "environment",
    ) ??
    decide(
      value,
      entries.filter(
        (entry) => entry.inScope && fold(entry.id).includes(wanted),
      ),
      "environment",
    ) ??
    unknown(value, "environment")
  );
}

/** A free-text filter the server bounds by length. */
export function boundedText(
  value: string | undefined,
  label: string,
  max: number,
): Resolved {
  if (value === undefined) return NONE;
  return value.length > max
    ? {
        id: undefined,
        problem: `${label} can be at most ${String(max)} characters.`,
      }
    : { id: value, problem: null };
}

/** A choice filter's meaning: one accepted value, or why the typed one is not. */
export type Choice<T extends string> = {
  id: T | undefined;
  problem: string | null;
};

/**
 * A filter that takes one of a few fixed values. A value that is not one of
 * them says so and names the accepted ones, as a service filter does, instead
 * of quietly listing everything.
 */
export function resolveChoice<T extends string>(
  value: string | undefined,
  accepted: readonly T[],
  noun: string,
): Choice<T> {
  if (value === undefined) return { id: undefined, problem: null };
  const match = accepted.find((candidate) => candidate === value);
  if (match !== undefined) return { id: match, problem: null };
  return {
    id: undefined,
    problem: `“${value}” is not a ${noun}. Choose one of ${accepted.join(", ")}.`,
  };
}

/** The sentences of every filter that cannot be used. */
export function problemsOf(
  resolved: readonly { problem: string | null }[],
): string[] {
  return resolved.flatMap((entry) =>
    entry.problem === null ? [] : [entry.problem],
  );
}
