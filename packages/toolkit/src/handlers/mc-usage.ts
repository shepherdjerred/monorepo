// Usage text for `toolkit mc`; `--help` on a subcommand prints its lines.
import { LIVE_USAGE } from "./mc-live.ts";

export const MC_USAGE = `
toolkit mc — drive Minecraft sandboxes through the mc-harness daemon

Daemon (runs from the monorepo checkout; needs Docker; other commands start it):
  toolkit mc daemon start [--ttl 4h]
  toolkit mc daemon status [--json]
  toolkit mc daemon stop                 Also removes sandboxes not started with --keep

Sandboxes (Paper 26.2 + WorldEdit + MCBridge; build MCBridge first). Profiles:
paper, storm-dev (Docker by default); storm-prod, storm-candidate (the published
image; cluster by default, ttl ≤ 8h):
  toolkit mc sandbox up [--profile paper] [--provider docker|kubernetes] [--world flat|void] [--ttl 2h] [--keep] [--json]
  toolkit mc sandbox ls [--json]
  toolkit mc sandbox down <id…> | --all

Target commands (--target <sandbox-id> | live; defaults to the only running sandbox,
never to live):
  toolkit mc info                        Versions, worlds, plugins, capabilities
  toolkit mc cmd <command…>              Console command with captured output
  toolkit mc we --world <w> [--pos1 x,y,z] [--pos2 x,y,z] [--at x,y,z] [--affects x1,y1,z1:x2,y2,z2] "<//command>"
  toolkit mc we-undo [--steps 1]
  toolkit mc paste --world <w> --file f.schem --at x,y,z [--rotate 0|90|180|270] [--ignore-air]
  toolkit mc region read --world <w> <x1,y1,z1> <x2,y2,z2> [--out f.json]
  toolkit mc snapshot create --world <w> <x1,y1,z1> <x2,y2,z2> [--label s]
  toolkit mc snapshot ls | get <id> --out f.schem | restore <id>
  toolkit mc players
  toolkit mc registry --out f.json       Block registry (feeds mc-harness gen-registry)
  toolkit mc events [--since 0] [--limit 200]
  toolkit mc logs [-n 200]

Actors (Citizens player NPCs; profiles paper and storm-dev):
  toolkit mc actor spawn <name> --world <w> --at x,y,z [--game-mode SURVIVAL] [--op]
  toolkit mc actor ls | observe <name> | quit <name…> | --all
  toolkit mc actor act <name> goto|look|break|use --pos x,y,z [--range 1] [--timeout 30000]
  toolkit mc actor act <name> place --pos x,y,z --block <state>
  toolkit mc actor act <name> equip --item <id> [--count 1] [--slot hand]
  toolkit mc actor act <name> command|chat <text…>
  toolkit mc actor act <name> attack --entity <uuid> | --type <entity-type>

${LIVE_USAGE}

Playtests (scenario files; sandbox-only):
  toolkit mc playtest run <file|dir…> [--target <id> | --profile paper|storm-dev] [--grep s] [--keep]
  toolkit mc playtest ls | show <run-id>
  toolkit mc playtest new <name> [--dir playtests]

Common options: --target <id|live>, --session <name> (WorldEdit session, default "agent"), --json, --reason <why>, --allow-players, --confirm-dangerous
--record <buildDir> on cmd, we and paste appends the op to that build's op log on success.
Use "cmd -- <command>" for negative coordinates, and --pos1=x,y,z when a value starts with "-".

Build workflow (capture → canvas → author → run/render/lint → replay → promote → undo):
  toolkit mc build help
`;

/** The usage lines for one subcommand, e.g. `toolkit mc we --help`. */
export function subcommandUsage(subcommand: string): string {
  const lines = MC_USAGE.split("\n").filter((line) =>
    line.trimStart().startsWith(`toolkit mc ${subcommand}`),
  );
  if (lines.length === 0) {
    return MC_USAGE;
  }
  const common = MC_USAGE.split("\n").find((line) =>
    line.startsWith("Common options:"),
  );
  return [...lines, "", common ?? ""].join("\n");
}
