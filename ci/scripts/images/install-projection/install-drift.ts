/**
 * Compare two isolated-linker installs of the same image: today's full-lockfile
 * install and the install from its closure projection (install-projection.ts).
 *
 * The full lockfile also links optional peers that only other workspaces
 * install, so the projection may drop or rebind them. Each such change must
 * be listed, with the audit's reason, in optional-peer-baseline.json: a new
 * one could be an optional package some shipped code path loads at runtime.
 * Anything else is drift and fails: a package version the projection installs
 * that today does not, a removed package that today reaches through a
 * required edge, or a dependency or required peer bound to a different
 * package. A version introduced by an optional peer is allowed only when
 * ALLOWED_DRIFT names it with a reason.
 */

export type StoreEntry = {
  /** Resolved `name@version`. */
  readonly id: string;
  /** Dependency name -> linked store entry (or `workspace:<path>`). */
  readonly links: ReadonlyMap<string, string>;
};

export type InstallSnapshot = {
  /** Store entry directory name (`name@version[+peer-hash]`) -> entry. */
  readonly entries: ReadonlyMap<string, StoreEntry>;
  /** Installed workspace dir -> its dependency links. */
  readonly roots: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

export type AllowedDrift = {
  readonly package: string;
  readonly version: string;
  /** The package whose optional peer binds the drifted version. */
  readonly dependent: string;
  readonly reason: string;
};

export const ALLOWED_DRIFT: readonly AllowedDrift[] = [
  {
    package: "supports-color",
    version: "7.2.0",
    dependent: "debug",
    reason: "color support only",
  },
];

export type OptionalPeerChange = {
  /** Package name (or `workspace:<dir>`) whose optional peer changed. */
  readonly dependent: string;
  readonly peer: string;
  /** `drop`: today links it, the projection does not; `rebind`: both link, differently. */
  readonly change: "drop" | "rebind";
};

export type OptionalPeerBaselineEntry = OptionalPeerChange & {
  /** Why the change is safe, from the runtime load-path audit. */
  readonly reason: string;
  /** Image installs (`<Dockerfile dir> <bun install args>`) that expect it. */
  readonly installs: readonly string[];
};

export type DriftReport = {
  /** Package ids today installs and the projection does not. */
  readonly removed: readonly string[];
  /** Package ids the projection installs and today does not. */
  readonly added: readonly string[];
  /** Optional-peer links of packages both installs keep that differ. */
  readonly optionalPeerChanges: readonly OptionalPeerChange[];
  /** Every finding that is not an allowed optional-peer difference. */
  readonly violations: readonly string[];
};

/**
 * Whether `dependency` is an optional peer of the package `id`; a workspace is
 * passed as `workspace:<dir>`.
 */
export type OptionalPeerLookup = (id: string, dependency: string) => boolean;

/** `@scope+name@1.2.3+<peer hash>` -> `@scope/name@1.2.3`. */
export function storeEntryId(entry: string): string {
  const bare = entry.replace(/\+[0-9a-f]{16}$/, "");
  const at = bare.lastIndexOf("@");
  if (at <= 0) throw new Error(`not an isolated store entry: ${entry}`);
  return `${bare.slice(0, at).replace("+", "/")}@${bare.slice(at + 1)}`;
}

export function packageNameOf(id: string): string {
  return id.slice(0, id.lastIndexOf("@"));
}

function targetId(
  snapshot: InstallSnapshot,
  target: string,
): string | undefined {
  return target.startsWith("workspace:")
    ? target
    : snapshot.entries.get(target)?.id;
}

/** Ids reachable from the workspaces without crossing an optional-peer edge. */
function requiredReach(
  snapshot: InstallSnapshot,
  optionalPeer: OptionalPeerLookup,
): Set<string> {
  const seen = new Set<string>();
  const pending = [...snapshot.roots].flatMap(([dir, links]) =>
    [...links]
      .filter(([name]) => !optionalPeer(`workspace:${dir}`, name))
      .map(([, target]) => target),
  );
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined || seen.has(entry)) continue;
    const node = snapshot.entries.get(entry);
    if (node === undefined) continue;
    seen.add(entry);
    for (const [dependency, target] of node.links) {
      if (!optionalPeer(node.id, dependency)) pending.push(target);
    }
  }
  return new Set([...seen].map((entry) => storeEntryId(entry)));
}

type LinkSets = {
  required: Map<string, Set<string>>;
  optional: Map<string, Set<string>>;
};

function addLink(links: Map<string, Set<string>>, name: string, id: string) {
  const ids = links.get(name) ?? new Set<string>();
  ids.add(id);
  links.set(name, ids);
}

/** Per id: dependency name -> the set of ids it links, split by edge kind. */
function linksById(
  snapshot: InstallSnapshot,
  optionalPeer: OptionalPeerLookup,
): Map<string, LinkSets> {
  const result = new Map<string, LinkSets>();
  for (const node of snapshot.entries.values()) {
    const slot = result.get(node.id) ?? {
      required: new Map<string, Set<string>>(),
      optional: new Map<string, Set<string>>(),
    };
    for (const [dependency, target] of node.links) {
      const id = targetId(snapshot, target) ?? `missing:${target}`;
      addLink(
        optionalPeer(node.id, dependency) ? slot.optional : slot.required,
        dependency,
        id,
      );
    }
    result.set(node.id, slot);
  }
  return result;
}

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((item) => right.has(item));

const listed = (ids: ReadonlySet<string>) => [...ids].join(",") || "nothing";

/** Names whose linked id sets differ between two link maps. */
function differingLinks(
  before: ReadonlyMap<string, ReadonlySet<string>>,
  after: ReadonlyMap<string, ReadonlySet<string>>,
): { name: string; was: Set<string>; now: Set<string> }[] {
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((name) => {
    const was = new Set(before.get(name));
    const now = new Set(after.get(name));
    return sameSet(was, now) ? [] : [{ name, was, now }];
  });
}

/** Shared ids whose required links differ, and their optional-peer changes. */
function packageLinkChanges(
  today: InstallSnapshot,
  projected: InstallSnapshot,
  optionalPeer: OptionalPeerLookup,
): { violations: string[]; optionalPeerChanges: OptionalPeerChange[] } {
  const violations: string[] = [];
  const changes = new Map<string, OptionalPeerChange>();
  const todayLinks = linksById(today, optionalPeer);
  for (const [id, links] of linksById(projected, optionalPeer)) {
    const before = todayLinks.get(id);
    if (before === undefined) continue;
    for (const { name, was, now } of differingLinks(
      before.required,
      links.required,
    )) {
      violations.push(
        `${id} links ${name} to ${listed(now)} (today ${listed(was)})`,
      );
    }
    for (const { name, was, now } of differingLinks(
      before.optional,
      links.optional,
    )) {
      const change: OptionalPeerChange = {
        dependent: packageNameOf(id),
        peer: name,
        change: was.size > 0 && now.size === 0 ? "drop" : "rebind",
      };
      changes.set(optionalPeerKey(change), change);
    }
  }
  return {
    violations,
    optionalPeerChanges: [...changes.values()].sort((left, right) =>
      optionalPeerKey(left).localeCompare(optionalPeerKey(right)),
    ),
  };
}

export function optionalPeerKey(change: OptionalPeerChange): string {
  return `${change.dependent} ${change.peer} ${change.change}`;
}

/**
 * Optional-peer changes of one image install that the audited baseline does
 * not list, as failure messages.
 */
export function unbaselinedOptionalPeers(
  install: string,
  changes: readonly OptionalPeerChange[],
  baseline: readonly OptionalPeerBaselineEntry[],
): string[] {
  const expected = new Set(
    baseline
      .filter((entry) => entry.installs.includes(install))
      .map((entry) => optionalPeerKey(entry)),
  );
  return changes
    .filter((change) => !expected.has(optionalPeerKey(change)))
    .map(
      (change) =>
        `${change.dependent}'s optional peer ${change.peer} ${change.change === "drop" ? "is dropped" : "binds differently"}, and optional-peer-baseline.json does not list it for this install. Audit the runtime load path: if shipped code loads ${change.peer}, declare it as a dependency of the workspace that loads it; otherwise add the entry with a one-line reason.`,
    );
}

/** Workspace optional peers that the two installs link differently. */
function rootOptionalPeerChanges(
  today: InstallSnapshot,
  projected: InstallSnapshot,
  optionalPeer: OptionalPeerLookup,
): OptionalPeerChange[] {
  const changes: OptionalPeerChange[] = [];
  for (const [dir, links] of projected.roots) {
    const before = today.roots.get(dir) ?? new Map<string, string>();
    for (const name of new Set([...before.keys(), ...links.keys()])) {
      if (!optionalPeer(`workspace:${dir}`, name)) continue;
      const was = targetId(today, before.get(name) ?? "");
      const now = targetId(projected, links.get(name) ?? "");
      if (was === now) continue;
      changes.push({
        dependent: `workspace:${dir}`,
        peer: name,
        change: was !== undefined && now === undefined ? "drop" : "rebind",
      });
    }
  }
  return changes;
}

/** Workspace links (other than optional peers) that bind differently. */
function rootLinkViolations(
  today: InstallSnapshot,
  projected: InstallSnapshot,
  optionalPeer: OptionalPeerLookup,
): string[] {
  const violations: string[] = [];
  for (const [dir, links] of projected.roots) {
    const before = today.roots.get(dir) ?? new Map<string, string>();
    for (const name of new Set([...before.keys(), ...links.keys()])) {
      if (optionalPeer(`workspace:${dir}`, name)) continue;
      const was = targetId(today, before.get(name) ?? "") ?? "nothing";
      const now = targetId(projected, links.get(name) ?? "") ?? "nothing";
      if (was !== now) {
        violations.push(`${dir} links ${name} to ${now} (today ${was})`);
      }
    }
  }
  return violations;
}

/** Whether every projected link to `id` is an allowed optional peer binding. */
function addedIsAllowed(
  id: string,
  projected: InstallSnapshot,
  optionalPeer: OptionalPeerLookup,
  allowed: readonly AllowedDrift[],
): boolean {
  const rule = allowed.find(
    (candidate) => `${candidate.package}@${candidate.version}` === id,
  );
  if (rule === undefined) return false;
  const dependents = [...projected.entries.values()].flatMap((node) =>
    [...node.links]
      .filter(([, target]) => projected.entries.get(target)?.id === id)
      .map(([dependency]) => ({ node, dependency })),
  );
  return (
    dependents.length > 0 &&
    dependents.every(
      ({ node, dependency }) =>
        packageNameOf(node.id) === rule.dependent &&
        optionalPeer(node.id, dependency),
    )
  );
}

export function compareInstalls(
  today: InstallSnapshot,
  projected: InstallSnapshot,
  optionalPeer: OptionalPeerLookup,
  allowed: readonly AllowedDrift[] = ALLOWED_DRIFT,
): DriftReport {
  const ids = (snapshot: InstallSnapshot) =>
    new Set([...snapshot.entries.values()].map((node) => node.id));
  const todayIds = ids(today);
  const projectedIds = ids(projected);
  const removed = [...todayIds].filter((id) => !projectedIds.has(id)).sort();
  const added = [...projectedIds].filter((id) => !todayIds.has(id)).sort();
  const required = requiredReach(today, optionalPeer);
  const links = packageLinkChanges(today, projected, optionalPeer);
  const violations = [
    ...removed
      .filter((id) => required.has(id))
      .map(
        (id) =>
          `${id} is removed but today reaches it as a required dependency`,
      ),
    ...added
      .filter((id) => !addedIsAllowed(id, projected, optionalPeer, allowed))
      .map((id) => `${id} is installed only by the projection`),
    ...links.violations,
    ...rootLinkViolations(today, projected, optionalPeer),
  ];
  return {
    removed,
    added,
    optionalPeerChanges: [
      ...links.optionalPeerChanges,
      ...rootOptionalPeerChanges(today, projected, optionalPeer),
    ],
    violations,
  };
}
