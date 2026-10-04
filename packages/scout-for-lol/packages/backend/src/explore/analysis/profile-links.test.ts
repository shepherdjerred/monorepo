import { expect, test } from "vitest";
import { authorizedProfileLinks } from "./profile-links.ts";

test("retains only profiles resolved for this turn", () => {
  expect(
    authorizedProfileLinks(
      "[sjerred#sjerr](https://beta.scout-for-lol.com/app/players/1) [other](/app/players/2)",
      new Set(["/app/players/1"]),
    ),
  ).toBe("[sjerred#sjerr](/app/players/1) other");
});
