import { expect, test } from "vitest";
import { peerUserbotIds, USERBOT_IDS } from "./userbot-ids.ts";

test("Arcade account rebranding preserves all stable identities and peer exclusions", () => {
  expect(USERBOT_IDS).toEqual({
    arcade1: "1513020384797266004",
    arcade2: "1094072953580310669",
    streambot: "1512972411639955466",
  });
  expect(peerUserbotIds("arcade1")).toBe(
    "1094072953580310669,1512972411639955466",
  );
  expect(peerUserbotIds("arcade2")).toBe(
    "1513020384797266004,1512972411639955466",
  );
  expect(peerUserbotIds("streambot")).toBe(
    "1094072953580310669,1513020384797266004",
  );
});
