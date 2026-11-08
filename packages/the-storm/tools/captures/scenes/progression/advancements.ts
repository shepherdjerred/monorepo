import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import shots from "#captures/presentations/progression/advancements.ts";
import { presentation } from "#captures/presentations/lookup.ts";
export default defineCaptureScene({
  name: "storm-milestones",
  description: "Open the genuine Storm advancement root on the imported map",
  bounds: { min: [-4, -2, -4], max: [6, 6, 6] },
  staging: [-2.5, 0, -2.5],
  inspectors: [],
  setup: async (context) => {
    await context.action("clear-overlays");
    await context.lookAt([50, 74, 60]);
  },
  run: async (context) => {
    await context.action("advancements", { tab: "thestorm:a_survival" });
    await context.waitFor(
      "Storm advancement tab",
      (s) => s.connected && s.screen === "Advancements",
    );
    await context.capture(presentation(shots, "storm-advancement-tabs"));
    await context.action("close");
  },
});
