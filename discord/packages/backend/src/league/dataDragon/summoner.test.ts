import { summoner } from "./summoner.ts";
import { assertSnapshot } from "https://deno.land/std@0.218.2/testing/snapshot.ts";

Deno.test("should be able to get champion data", async (t) => {
  await assertSnapshot(t, summoner);
});
