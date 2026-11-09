import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";
export default [
  {
    schema: 1,
    name: "stormnight-door",
    alt: "An authored Stormnight door at the preserved main spawn.",
    caption:
      "Visit one of Stormnight's authored doors while the annual event is active.",
    annotations: [],
  },
  {
    schema: 1,
    name: "stormnight-reward",
    alt: "The genuine Stormnight interaction gives its configured trick-or-treat reward.",
    caption:
      "An authored Stormnight door gives its actual trick-or-treat reward once per day.",
    annotations: [],
  },
] satisfies Presentation[];
