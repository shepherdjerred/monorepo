import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";
export default [
  {
    schema: 1,
    name: "search-lobby",
    alt: "The copied live RWF lobby contains the authored waiting room and kit displays.",
    caption: "Join Search and Destroy to enter its lobby and choose your kit.",
    annotations: [],
  },
  {
    schema: 1,
    name: "rwf-kit-menu",
    alt: "The real RWF kit picker lists the available and locked kits.",
    caption: "Use /rwf kits to browse kits and select one you can use.",
    annotations: [],
  },
  {
    schema: 1,
    name: "rwf-live-hud",
    alt: "The live Valley of Death round displays the actual Blue Team inventory and match HUD.",
    caption: "Your team and the match state appear in the live round HUD.",
    annotations: [],
  },
  {
    schema: 1,
    name: "rwf-bomb-fuse",
    alt: "The genuine Bomb Fuse item appears in the player's actual match inventory.",
    caption:
      "Hold your Bomb Fuse to arm an enemy bomb or defuse your own armed bomb.",
    annotations: [],
  },
  {
    schema: 1,
    name: "rwf-bomb-safe",
    alt: "Blue Team's real TNT bomb is safe before an enemy starts arming it.",
    caption: "A safe team bomb appears as TNT at its authored site.",
    annotations: [],
  },
  {
    schema: 1,
    name: "rwf-bomb-armed",
    alt: "A Red Team player has armed Blue Team's bomb through ordinary fuse interaction.",
    caption: "An armed bomb becomes primed TNT with a visible countdown.",
    annotations: [],
  },
  {
    schema: 1,
    name: "rwf-defuse-demo",
    alt: "The Blue Team player repeatedly right-clicks with a genuine fuse until the actual armed bomb is defused.",
    caption:
      "Keep using your fuse on your team's armed bomb until the defuse finishes.",
    annotations: [
      {
        kind: "arrow",
        from: [0.08, 0.22],
        to: [0.5, 0.065],
        text: "Keep right-clicking: blue fills the defuse bar",
        atStep: "defuse",
        startMs: 0,
        endMs: 8500,
      },
      {
        kind: "label",
        from: [0.08, 0.22],
        to: [0.08, 0.22],
        text: "Defused: the bomb is safe again",
        atStep: "safe-again",
        startMs: 0,
        endMs: 2000,
      },
    ],
  },
  {
    schema: 1,
    name: "rwf-bomb-defused",
    alt: "The defuse announcement and restored TNT block confirm the real bomb is safe again.",
    caption:
      "A successful defuse restores the bomb and announces the result to the match.",
    annotations: [],
  },
  {
    schema: 1,
    name: "rwf-round-result",
    alt: "Blue Team wins the actual round after both remaining Red Team players give up their lives.",
    caption:
      "The round announces its winning team when the opposing team is eliminated.",
    annotations: [],
  },
  {
    schema: 1,
    name: "rwf-spectator-view",
    alt: "A genuine spectator watches Valley of Death from its authored overview point.",
    caption:
      "Leave the match and use /rwf spectate to watch from the spectator view.",
    annotations: [],
  },
] satisfies Presentation[];
