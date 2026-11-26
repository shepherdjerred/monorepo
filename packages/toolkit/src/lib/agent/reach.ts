import type { HerdrLocation, HerdrTerminal } from "./herdr.ts";

export type ReachActorMetadata = {
  harness?: string | undefined;
  sessionId?: string | undefined;
  model?: string | undefined;
  hostname?: string | undefined;
  cwd?: string | undefined;
  worktree?: string | undefined;
  branch?: string | undefined;
  hcTerminal?: string | undefined;
  hcAddress?: string | undefined;
  herdrSpace?: string | undefined;
  herdrTab?: string | undefined;
};
export type ReachActor = {
  key: string;
  kind: string;
  name: string;
  lastSeenAt?: string | undefined;
  metadata: ReachActorMetadata;
};
export type IssueLike = {
  identifier: string;
  title: string;
  creator: ReachActor;
  assignee: ReachActor | null;
};
export type ForumLike = {
  identifier: string;
  title: string;
  creator: ReachActor;
  owner: ReachActor | null;
};

export type ReachTarget =
  | { kind: "issue"; identifier: string }
  | { kind: "forum"; identifier: string }
  | { kind: "actor"; key: string }
  | { kind: "terminal"; address: string };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Classify a CLI target: FM-N/UUID is a forum post, TEAM-N an issue, `harness:session` an actor, anything else an hc address or name. */
export function parseTarget(raw: string): ReachTarget {
  const value = raw.trim();
  if (value === "") throw new Error("Target is required");
  if (/^FM-\d+$/iu.test(value) || uuidPattern.test(value))
    return { kind: "forum", identifier: value.toUpperCase() };
  if (/^[A-Z][A-Z0-9]*-\d+$/iu.test(value))
    return { kind: "issue", identifier: value.toUpperCase() };
  return /^\w[\w.-]*:\S+$/iu.test(value)
    ? { kind: "actor", key: value }
    : { kind: "terminal", address: value };
}

function candidatesOf(
  source: IssueLike | ForumLike,
): { actor: ReachActor | null; role: string }[] {
  return "assignee" in source
    ? [
        { actor: source.assignee, role: "assignee" },
        { actor: source.creator, role: "creator" },
      ]
    : [
        { actor: source.owner, role: "owner" },
        { actor: source.creator, role: "creator" },
      ];
}

/** Owner precedence: explicit assignee/owner wins over the creator who may no longer be working it. */
export function chooseActor(
  source: IssueLike | ForumLike,
  overrideKey?: string,
): { actor: ReachActor; role: string } {
  const candidates = candidatesOf(source);
  if (overrideKey !== undefined) {
    const match = candidates.find((c) => c.actor?.key === overrideKey);
    if (match?.actor) return { actor: match.actor, role: match.role };
    return {
      actor: {
        key: overrideKey,
        kind: "agent",
        name: overrideKey,
        metadata: {},
      },
      role: "override",
    };
  }
  for (const c of candidates)
    if (c.actor) return { actor: c.actor, role: c.role };
  throw new Error(`No actor recorded for ${source.identifier}`);
}

export type ReachResult = {
  target: string;
  title: string | null;
  actor: ReachActor | null;
  role: string | null;
  address: string | null;
  machine: string | null;
  live: boolean;
  status: string | null;
  app: string | null;
  cwd: string | null;
  where: string | null;
  space: { id: string; name: string | null } | null;
  tab: { id: string; name: string | null } | null;
  pane: string | null;
  sendCommand: string | null;
  focusCommand: string | null;
  reachable: boolean;
  reason: string;
};

type ReachInput = {
  target: string;
  title?: string | null | undefined;
  actor?: ReachActor | null | undefined;
  role?: string | null | undefined;
  directAddress?: string | undefined;
  terminals: HerdrTerminal[];
  machines: string[];
  locations: Map<string, HerdrLocation>;
  detail?: { space: string | null; tab: string | null } | null | undefined;
};

function emptyResult(input: ReachInput): ReachResult {
  return {
    target: input.target,
    title: input.title ?? null,
    actor: input.actor ?? null,
    role: input.role ?? null,
    address: null,
    machine: null,
    live: false,
    status: null,
    app: null,
    cwd: null,
    where: null,
    space: null,
    tab: null,
    pane: null,
    sendCommand: null,
    focusCommand: null,
    reachable: false,
    reason: "",
  };
}

function bareOf(address: string): string {
  return address.slice(address.lastIndexOf("/") + 1);
}

/**
 * Pick the qualified address for an actor: a stamped hcAddress wins,
 * otherwise the bare hcTerminal is matched across cores, with the actor
 * hostname breaking ties between duplicate bare ids.
 */
function pickAddress(
  actor: ReachActor,
  terminals: HerdrTerminal[],
): { address: string } | { error: string } {
  const meta = actor.metadata;
  const stamped = meta.hcAddress ?? null;
  const bare = stamped === null ? (meta.hcTerminal ?? null) : bareOf(stamped);
  if (bare === null || bare === "")
    return {
      error: `Actor ${actor.key} has no hc terminal recorded (last seen ${actor.lastSeenAt ?? "unknown"}). It may not be running under Herdr.`,
    };
  const matches = terminals.filter((t) => t.bare === bare);
  const exact =
    stamped === null ? undefined : matches.find((t) => t.address === stamped);
  const only = matches.at(0);
  if (exact !== undefined) return { address: exact.address };
  if (only !== undefined && matches.length === 1)
    return { address: only.address };
  if (matches.length === 0)
    return {
      error: `Terminal ${stamped ?? bare} for ${actor.key} is not live on any connected core (actor last seen ${actor.lastSeenAt ?? "unknown"}). The session ended or its core is unreachable.`,
    };
  const host = (meta.hostname ?? "").replace(/\.local$/u, "").toLowerCase();
  const byHost =
    host === ""
      ? []
      : matches.filter((t) => (t.machine ?? "").toLowerCase() === host);
  const hostMatch = byHost.at(0);
  if (hostMatch !== undefined && byHost.length === 1)
    return { address: hostMatch.address };
  return {
    error: `Bare terminal id matches ${matches.map((t) => t.address).join(", ")}; pass --to with a machine-qualified address to disambiguate.`,
  };
}

function locationOf(input: ReachInput, address: string) {
  const loc =
    input.locations.get(bareOf(address)) ?? input.locations.get(address);
  const spaceId = loc?.spaceId ?? input.detail?.space ?? null;
  const tabId = loc?.tabId ?? input.detail?.tab ?? null;
  return {
    space:
      spaceId === null ? null : { id: spaceId, name: loc?.spaceName ?? null },
    tab: tabId === null ? null : { id: tabId, name: loc?.tabName ?? null },
    pane: loc?.pane ?? null,
  };
}

function liveReason(
  address: string,
  live: boolean,
  status: string | null,
): string {
  if (!live) return `Terminal ${address} is not live.`;
  if (status === "blocked")
    return `Terminal ${address} is blocked waiting for a person; hc send will refuse without --force.`;
  return `Live as ${address}${status === null ? "" : ` (${status})`}; deliver with hc send.`;
}

function describeLive(
  base: ReachResult,
  input: ReachInput,
  address: string,
): ReachResult {
  const terminal = input.terminals.find((t) => t.address === address);
  const status = terminal?.state ?? null;
  const live = terminal !== undefined;
  return {
    ...base,
    ...locationOf(input, address),
    address,
    machine: terminal?.machine ?? null,
    live,
    status,
    app: terminal?.app ?? null,
    cwd: terminal?.cwd ?? null,
    where: terminal?.where ?? null,
    sendCommand: `hc send ${address} "<message>"`,
    focusCommand: `herdr-app do agent.focus --terminal ${address}`,
    reachable: live && status !== "blocked",
    reason: liveReason(address, live, status),
  };
}

/** Resolve a target's actor (or a direct address) to a live terminal from one hc ls snapshot. */
export function resolveReach(input: ReachInput): ReachResult {
  const base = emptyResult(input);
  if (input.directAddress !== undefined)
    return describeLive(base, input, input.directAddress);
  const actor = input.actor ?? null;
  if (actor === null)
    return { ...base, reason: "No actor resolved for target." };
  const picked = pickAddress(actor, input.terminals);
  if ("error" in picked) {
    return {
      ...base,
      address: actor.metadata.hcAddress ?? actor.metadata.hcTerminal ?? null,
      reason: picked.error,
    };
  }
  return describeLive(base, input, picked.address);
}
