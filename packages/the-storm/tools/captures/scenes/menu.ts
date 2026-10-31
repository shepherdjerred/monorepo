import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";

export default defineCaptureScene({
  name: "inventory-menu",
  description: "An ordinary inventory screen over a real wilderness background",
  bounds: { min: [0, -1, 0], max: [0, -1, 0] },
  staging: [-3, 0, -3],
  inspectors: ["wilderness", "shops", "banks", "stargates"],
  setup: () => Promise.resolve(),
  run: async (context) => {
    await context.action("inventory", { open: true });
    await context.waitFor(
      "inventory screen",
      (state) => state.screen === "Crafting",
    );
    await context.capture({
      schema: 1,
      name: "inventory-menu",
      alt: "The player inventory with the crafting grid and hotbar",
      caption: "Items in the bottom row are available in your hotbar.",
      annotations: [
        {
          kind: "box",
          from: [0.35, 0.68],
          to: [0.65, 0.76],
          text: "Your hotbar",
          startMs: 0,
          endMs: 12_000,
        },
      ],
    });
    await context.action("close");
  },
});
