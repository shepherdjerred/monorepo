/**
 * The live write guard: pure decisions, no I/O. `assessLiveWrite` turns an
 * operation into a tier and the box it changes (refusing shapes it cannot
 * bound or undo); `authorizeLiveWrite` checks the reason, players near the
 * box, backup freshness and confirmations against that assessment.
 *
 * Tiers: 0 = journal only (commands, actor moves); 1 = block writes, which
 * get a bridge snapshot first so `live undo` can restore them; 2 = large
 * regions and dangerous commands, which also need a recent Velero backup
 * (and `--confirm-dangerous` for dangerous ones).
 */
import type { BlockPos, Box, Player } from "#protocol/bridge.ts";
import type { LiveTier, LiveWriteFlags } from "#protocol/live.ts";
import { boxOf, boxVolume, describeBox, distanceToBox } from "#src/box.ts";

export type LiveGuardConfig = {
  /** Kill switch: false refuses every live write. */
  writes: boolean;
  /** Worlds block writes may touch (never the quarterly-reset `mining`). */
  worlds: readonly string[];
  /** Block writes larger than this need a recent backup (tier 2). */
  maxRegionVolume: number;
  /** A tier-2 write needs a completed backup at most this old. */
  backupMaxAgeHours: number;
  /** Humans within this many blocks of the box need `--allow-players`. */
  nearPlayerRadius: number;
  /** Snapshot limit; larger block writes could not be undone and are refused. */
  maxSnapshotVolume: number;
};

export class LiveGuardRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveGuardRefusal";
  }
}

export type CommandClass = "read" | "write" | "dangerous" | "block";

/** Commands that only read state. Anything not listed is a write. */
const READ_COMMANDS = new Set([
  "list",
  "help",
  "?",
  "plugins",
  "pl",
  "version",
  "ver",
  "about",
  "tps",
  "mspt",
  "seed",
  "locate",
  "whitelist list",
  "banlist",
  "datapack list",
  "scoreboard players list",
  "scoreboard players get",
  "scoreboard objectives list",
  "worldborder get",
  "time query",
  "tick query",
  "data get",
  "co lookup",
  "co l",
  "co inspect",
  "co i",
  "co status",
  "co help",
  "lp info",
  "lp user",
  "mv list",
  "mv info",
]);

/** Commands that can take the server down, wipe entities or revert history. */
const DANGEROUS_COMMANDS = new Set([
  "stop",
  "restart",
  "reload",
  "kill",
  "op",
  "deop",
  "ban",
  "ban-ip",
  "whitelist off",
  "whitelist remove",
  "save-off",
  "co rollback",
  "co rb",
  "co restore",
  "co rs",
  "co purge",
  "mv delete",
  "mv remove",
  "mv regen",
  "lp user",
  "lp group",
  "worldborder set",
  "gamerule",
]);

/** Console commands that change blocks; live block edits go through we/paste. */
const BLOCK_COMMANDS = new Set([
  "fill",
  "setblock",
  "clone",
  "place",
  "fillbiome",
]);

function words(command: string): string[] {
  return command
    .trim()
    .replace(/^\/+/u, "")
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase().replace(/^minecraft:/u, ""));
}

function matches(set: ReadonlySet<string>, parts: readonly string[]): boolean {
  for (let length = Math.min(parts.length, 3); length > 0; length -= 1) {
    if (set.has(parts.slice(0, length).join(" "))) {
      return true;
    }
  }
  return false;
}

/** Classifies a console (or actor) command. `execute … run X` classifies X. */
export function classifyCommand(command: string): CommandClass {
  const trimmed = command.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("/ /")) {
    return "block";
  }
  const parts = words(trimmed);
  if (parts[0] === "execute") {
    const run = parts.indexOf("run");
    // `execute if/unless …` with no run is a test: read.
    return run === -1
      ? "read"
      : classifyCommand(parts.slice(run + 1).join(" "));
  }
  // LuckPerms reads (`lp user <name> info`) sit under the dangerous `lp user`.
  if (parts[0] === "lp" && parts.at(-1) === "info") {
    return "read";
  }
  if (matches(DANGEROUS_COMMANDS, parts)) {
    return "dangerous";
  }
  if (matches(BLOCK_COMMANDS, parts)) {
    return "block";
  }
  return matches(READ_COMMANDS, parts) ? "read" : "write";
}

/** WorldEdit commands that wipe or regenerate rather than edit. */
const DANGEROUS_WE = new Set(["regen", "butcher", "snapshot", "restore"]);
/** WorldEdit commands whose changes stay inside the selection. */
const SELECTION_BOUNDED_WE = new Set([
  "set",
  "replace",
  "re",
  "rep",
  "walls",
  "faces",
  "outline",
  "naturalize",
  "smooth",
  "hollow",
  "center",
  "line",
  "curve",
  "forest",
  "flora",
  "deform",
  "regen",
]);

function weName(command: string): string {
  return (
    command.replace(/^\/\//u, "").trim().split(/\s+/u)[0]?.toLowerCase() ?? ""
  );
}

export type LiveWeOp = {
  command: string;
  pos1?: BlockPos | undefined;
  pos2?: BlockPos | undefined;
  at?: BlockPos | undefined;
};

export type LiveWriteOp =
  | { kind: "command"; command: string }
  | { kind: "we"; world: string; ops: readonly LiveWeOp[] }
  | { kind: "paste"; world: string; box: Box }
  | { kind: "we-undo"; steps: number }
  | { kind: "snapshot-restore"; snapshotId: string; box: Box }
  | { kind: "actor-spawn"; name: string; world: string }
  | { kind: "actor-remove"; name: string }
  | {
      kind: "actor-act";
      name: string;
      act: string;
      pos?: BlockPos | undefined;
      command?: string | undefined;
      world?: string | undefined;
    };

export type LiveAssessment = {
  /** "read" ops need no guard at all. */
  read: boolean;
  tier: LiveTier;
  dangerous: boolean;
  world: string | null;
  /** The blocks this write may change; snapshotted before tier >= 1 writes. */
  box: Box | null;
  summary: string;
};

export function unionBox(a: Box, b: Box): Box {
  if (a.world !== b.world) {
    throw new LiveGuardRefusal(
      `one request may not touch two worlds (${a.world}, ${b.world})`,
    );
  }
  return boxOf(
    a.world,
    {
      x: Math.min(a.min.x, b.min.x),
      y: Math.min(a.min.y, b.min.y),
      z: Math.min(a.min.z, b.min.z),
    },
    {
      x: Math.max(a.max.x, b.max.x),
      y: Math.max(a.max.y, b.max.y),
      z: Math.max(a.max.z, b.max.z),
    },
  );
}

function weBox(world: string, op: LiveWeOp, affects: Box | undefined): Box {
  const name = weName(op.command);
  if (affects !== undefined) {
    return affects;
  }
  if (
    op.pos1 !== undefined &&
    op.pos2 !== undefined &&
    SELECTION_BOUNDED_WE.has(name)
  ) {
    return boxOf(world, op.pos1, op.pos2);
  }
  throw new LiveGuardRefusal(
    `//${name} can change blocks outside a pos1/pos2 selection; pass --affects x1,y1,z1 x2,y2,z2 with the box it changes so it can be snapshotted and undone`,
  );
}

function blockTier(
  config: LiveGuardConfig,
  box: Box,
  dangerous: boolean,
): LiveTier {
  if (!config.worlds.includes(box.world)) {
    throw new LiveGuardRefusal(
      `world ${box.world} is not in the live write allowlist (${config.worlds.join(", ")})`,
    );
  }
  const volume = boxVolume(box);
  if (volume > config.maxSnapshotVolume) {
    throw new LiveGuardRefusal(
      `the write covers ${volume.toString()} blocks, more than one undo snapshot holds (${config.maxSnapshotVolume.toString()}); split it into smaller writes`,
    );
  }
  return dangerous || volume > config.maxRegionVolume ? 2 : 1;
}

function assessCommand(command: string): Omit<LiveAssessment, "summary"> {
  const kind = classifyCommand(command);
  if (kind === "block") {
    throw new LiveGuardRefusal(
      `"${command}" edits blocks from the console, which cannot be snapshotted; use toolkit mc we/paste (with --target live) so the change is undoable`,
    );
  }
  return {
    read: kind === "read",
    tier: kind === "dangerous" ? 2 : 0,
    dangerous: kind === "dangerous",
    world: null,
    box: null,
  };
}

/** Tier and box for one write; refuses writes it cannot bound or undo. */
export function assessLiveWrite(
  op: LiveWriteOp,
  config: LiveGuardConfig,
  affects?: Box,
): LiveAssessment {
  switch (op.kind) {
    case "command": {
      return { ...assessCommand(op.command), summary: op.command };
    }
    case "we": {
      const dangerous = op.ops.some((entry) =>
        DANGEROUS_WE.has(weName(entry.command)),
      );
      let box: Box | null = null;
      for (const entry of op.ops) {
        const next = weBox(op.world, entry, affects);
        box = box === null ? next : unionBox(box, next);
      }
      if (box === null) {
        throw new LiveGuardRefusal("a WorldEdit request needs at least one op");
      }
      return {
        read: false,
        tier: blockTier(config, box, dangerous),
        dangerous,
        world: op.world,
        box,
        summary: op.ops.map((entry) => entry.command).join("; "),
      };
    }
    case "paste":
    case "snapshot-restore": {
      return {
        read: false,
        tier: blockTier(config, op.box, false),
        dangerous: false,
        world: op.box.world,
        box: op.box,
        summary:
          op.kind === "paste"
            ? `paste into ${describeBox(op.box)}`
            : `restore snapshot ${op.snapshotId} into ${describeBox(op.box)}`,
      };
    }
    case "we-undo": {
      return {
        read: false,
        tier: 0,
        dangerous: false,
        world: null,
        box: null,
        summary: `WorldEdit undo ${op.steps.toString()} step(s)`,
      };
    }
    case "actor-spawn":
    case "actor-remove": {
      return {
        read: false,
        tier: 0,
        dangerous: false,
        world: op.kind === "actor-spawn" ? op.world : null,
        box: null,
        summary: `${op.kind === "actor-spawn" ? "spawn" : "remove"} actor ${op.name}`,
      };
    }
    case "actor-act": {
      return assessActorAct(op, config);
    }
  }
}

const BLOCK_ACTIONS = new Set(["break", "place", "use"]);

function assessActorAct(
  op: Extract<LiveWriteOp, { kind: "actor-act" }>,
  config: LiveGuardConfig,
): LiveAssessment {
  const summary = `actor ${op.name} ${op.act}${op.command === undefined ? "" : ` ${op.command}`}`;
  if (op.act === "command" && op.command !== undefined) {
    return { ...assessCommand(op.command), read: false, summary };
  }
  if (BLOCK_ACTIONS.has(op.act)) {
    if (op.pos === undefined || op.world === undefined) {
      throw new LiveGuardRefusal(
        `actor ${op.act} needs a position in a known world`,
      );
    }
    const box = boxOf(op.world, op.pos, op.pos);
    return {
      read: false,
      tier: blockTier(config, box, false),
      dangerous: false,
      world: op.world,
      box,
      summary,
    };
  }
  return {
    read: false,
    tier: 0,
    dangerous: false,
    world: null,
    box: null,
    summary,
  };
}

export type LiveAuthorizationInput = {
  assessment: LiveAssessment;
  flags: LiveWriteFlags;
  players: readonly Player[];
  /** Completion time of the newest usable Velero backup, if any. */
  latestBackupAt: Date | null;
  now: Date;
  config: LiveGuardConfig;
};

export type LiveAuthorization = {
  reason: string;
  humansOnline: string[];
};

/** Refuses humans inside the box, and near it without --allow-players. NPCs never count. */
function checkPlayers(
  box: Box,
  humans: readonly Player[],
  allowPlayers: boolean,
  radius: number,
): void {
  const nearby = humans.filter((player) => player.world === box.world);
  const inside = nearby.filter(
    (player) => distanceToBox(box, player.pos) === 0,
  );
  if (inside.length > 0) {
    throw new LiveGuardRefusal(
      `${inside.map((player) => player.name).join(", ")} ${inside.length === 1 ? "is" : "are"} inside ${describeBox(box)}; wait until they leave`,
    );
  }
  const close = nearby.filter(
    (player) => distanceToBox(box, player.pos) <= radius,
  );
  if (!allowPlayers && close.length > 0) {
    throw new LiveGuardRefusal(
      `${close.map((player) => player.name).join(", ")} within ${radius.toString()} blocks of ${describeBox(box)}; pass --allow-players to proceed anyway`,
    );
  }
}

/** Throws LiveGuardRefusal unless the write may proceed. */
export function authorizeLiveWrite(
  input: LiveAuthorizationInput,
): LiveAuthorization {
  const { assessment, flags, config } = input;
  if (!config.writes) {
    throw new LiveGuardRefusal(
      "live writes are disabled (mcLiveWrites=false in ~/.toolkit/config.toml or the environment)",
    );
  }
  const reason = flags.reason?.trim();
  if (reason === undefined || reason.length === 0) {
    throw new LiveGuardRefusal(
      `live writes need --reason "<why>" (${assessment.summary}); it is journaled`,
    );
  }
  const humans = input.players.filter((player) => !player.npc);
  if (assessment.box !== null) {
    checkPlayers(
      assessment.box,
      humans,
      flags.allowPlayers === true,
      config.nearPlayerRadius,
    );
  }
  if (assessment.dangerous && flags.confirmDangerous !== true) {
    throw new LiveGuardRefusal(
      `"${assessment.summary}" is dangerous on the live server; pass --confirm-dangerous after checking a recent backup`,
    );
  }
  if (assessment.tier === 2) {
    const maxAgeMs = config.backupMaxAgeHours * 60 * 60 * 1000;
    if (
      input.latestBackupAt === null ||
      input.now.getTime() - input.latestBackupAt.getTime() > maxAgeMs
    ) {
      throw new LiveGuardRefusal(
        `tier-2 write ("${assessment.summary}") needs a completed Velero backup from the last ${config.backupMaxAgeHours.toString()}h; run toolkit mc live backup --wait --reason "<why>"`,
      );
    }
  }
  return { reason, humansOnline: humans.map((player) => player.name) };
}
