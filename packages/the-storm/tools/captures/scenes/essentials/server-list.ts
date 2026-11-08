import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
export default defineCaptureScene({
  name: "java-server-list",
  description:
    "Show the native Java multiplayer list with a successful real server ping",
  bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  staging: [-2.5, 0, -2.5],
  inspectors: [],
  setup: () => Promise.resolve(),
  run: () => {
    throw new Error(
      "Server-list capture requires the suite's dedicated client UI runner",
    );
  },
});
