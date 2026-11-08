import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";
export default [
  {
    schema: 1,
    name: "quest-board",
    alt: "Tamsin's actual quest-board conversation offers daily and weekly work on the copied main map.",
    caption: "Visit the quest board for the current daily and weekly jobs.",
    annotations: [],
  },
  {
    schema: 1,
    name: "npc-quest-offer",
    alt: "Thomas offers A Blacksmith's Task in an actual NPC conversation.",
    caption:
      "Talk to Thomas at the forge and choose Accept to start his quest.",
    annotations: [],
  },
  {
    schema: 1,
    name: "quest-objectives",
    alt: "The Quest Journal lists Thomas's required materials and current delivery counts.",
    caption: "The journal records each objective and its progress.",
    annotations: [],
  },
  {
    schema: 1,
    name: "quest-partial-delivery",
    alt: "The journal records sixteen of the thirty-two iron ingots delivered to Thomas.",
    caption:
      "Hand over materials as you find them; partial deliveries remain recorded.",
    annotations: [],
  },
  {
    schema: 1,
    name: "quest-journal",
    alt: "The Quest Journal shows an active Blacksmith's Task with its saved progress.",
    caption: "Use /quests to return to your active quests and discoveries.",
    annotations: [],
  },
  {
    schema: 1,
    name: "quest-completion-reward",
    alt: "Completing Thomas's actual material deliveries pays 750 crystals and updates the wallet.",
    caption: "Finish every delivery to receive the quest's reward.",
    annotations: [],
  },
  {
    schema: 1,
    name: "quest-field-note",
    alt: "Picking up wheat reveals the Town Harvest field note in the Quest Journal.",
    caption: "First pickups can reveal authored field notes in your journal.",
    annotations: [],
  },
] satisfies Presentation[];
