import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "sorting-settings",
    alt: "The Sorting menu shows the available automatic sorting and hotkey preferences.",
    caption:
      "Use /sort to choose which sorting shortcuts and automatic actions are enabled.",
    annotations: [],
  },
  {
    schema: 1,
    name: "sorting-before",
    alt: "Seven scattered stacks in a barrel, including split cobblestone and oak planks",
    caption: "Before sorting: matching stacks are split across the barrel.",
    annotations: [],
  },
  {
    schema: 1,
    name: "sorting-after",
    alt: "Five organized stacks in the same barrel, with cobblestone and oak planks combined",
    caption:
      "After sorting: duplicate stacks combine and items fill the first slots.",
    annotations: [],
  },
] satisfies Presentation[];
