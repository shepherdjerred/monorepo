import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";
export default [
  {
    schema: 1,
    name: "creative-plot-claim",
    alt: "The player claims an unclaimed plot in the recovered Creative map.",
    caption: "Stand inside an available plot and use /creative claim.",
    annotations: [],
  },
  {
    schema: 1,
    name: "creative-plot-access",
    alt: "The plot owner trusts TsmcDemoHelper on the claimed Creative plot.",
    caption: "Use /creative trust to give a friend access to your plot.",
    annotations: [],
  },
  {
    schema: 1,
    name: "creative-plot",
    alt: "A small demonstration pavilion stands inside a claimed plot on the recovered Creative map.",
    caption: "Creative plots provide a separate place to build.",
    annotations: [],
  },
  {
    schema: 1,
    name: "creative-saved-library",
    alt: "The actual schematic library lists docs-pavilion after saving the plot.",
    caption:
      "Save your plot with /creative save, then use /creative load to list saved names.",
    annotations: [],
  },
  {
    schema: 1,
    name: "creative-restored-build",
    alt: "The saved pavilion is restored after clearing the plot, with its blocks verified against the saved build.",
    caption: "Paste a saved schematic onto a plot that matches the template.",
    annotations: [],
  },
  {
    schema: 1,
    name: "creative-merged-plots",
    alt: "The player's two neighboring Creative plots are joined through the ordinary merge command.",
    caption:
      "Claim both neighboring plots, then use /creative merge with the adjacent plot ID.",
    annotations: [],
  },
] satisfies Presentation[];
