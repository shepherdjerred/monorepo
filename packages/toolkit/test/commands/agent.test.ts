import { expect, it } from "vitest";
import { codingRoutes } from "#commands/agent.ts";

it("uses the connected alias for a coding peer and keeps offline hosts visible", () => {
  expect(
    codingRoutes("karpathy", {
      machines: [
        { name: "macbook", target: "macbook", state: "unreachable" },
        { name: "mac-current", target: "macbook", state: "connected" },
        { name: "jobs", target: "jobs", state: "connected" },
      ],
    }),
  ).toEqual([
    { host: "macbook", addressPrefix: "mac-current", connected: true },
    { host: "karpathy", addressPrefix: null, connected: true },
    { host: "desktop", addressPrefix: null, connected: false },
  ]);
});
