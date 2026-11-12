type Actor = {
  key: string;
  kind: string;
  name: string;
  lastSeenAt: string;
};

/** People, then each kind of automation with its sessions folded together. */
export type ActorGroup<T extends Actor> = {
  key: string;
  label: string;
  actors: T[];
  /** Sessions left out while the group is folded. */
  hidden: number;
};

/** Sessions are keyed `<harness>:<session>`; the harness names the group. */
export function actorNamespace(actor: Actor) {
  const colon = actor.key.indexOf(":");
  return colon === -1 ? actor.kind : actor.key.slice(0, colon);
}

const newestFirst = (a: Actor, b: Actor) =>
  b.lastSeenAt.localeCompare(a.lastSeenAt) || a.name.localeCompare(b.name);

export function matchesQuery(
  actor: Pick<Actor, "key" | "name">,
  query: string,
) {
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    actor.name.toLowerCase().includes(needle) ||
    actor.key.toLowerCase().includes(needle)
  );
}

/**
 * Order actors for an assignee picker: people first, most recently seen
 * first; then one group per automation harness, newest session first. With
 * no query a harness shows only its newest session until it is expanded, so
 * hundreds of agent sessions do not bury the people.
 */
export function groupActors<T extends Actor>(
  actors: readonly T[],
  options: { query: string; expanded: ReadonlySet<string> },
): ActorGroup<T>[] {
  const matching = actors.filter((actor) => matchesQuery(actor, options.query));
  const people = matching
    .filter(({ kind }) => kind === "human")
    .sort(newestFirst);
  const harnesses = new Map<string, T[]>();
  for (const actor of matching.filter(({ kind }) => kind !== "human")) {
    const key = actorNamespace(actor);
    harnesses.set(key, [...(harnesses.get(key) ?? []), actor]);
  }
  const groups = [...harnesses].map(([key, members]) => {
    const sorted = members.sort(newestFirst);
    const folded = options.query.trim() === "" && !options.expanded.has(key);
    const shown = folded ? sorted.slice(0, 1) : sorted;
    return {
      key,
      label: key,
      actors: shown,
      hidden: sorted.length - shown.length,
    };
  });
  groups.sort((a, b) =>
    newestFirst(
      a.actors[0] ?? { key: "", kind: "", name: a.key, lastSeenAt: "" },
      b.actors[0] ?? { key: "", kind: "", name: b.key, lastSeenAt: "" },
    ),
  );
  return [
    ...(people.length === 0
      ? []
      : [{ key: "people", label: "People", actors: people, hidden: 0 }]),
    ...groups,
  ];
}
