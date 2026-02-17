import { assertSnapshot } from "https://deno.land/std@0.218.2/testing/snapshot.ts";
import { PlayerConfigSchema } from "./index.ts";

Deno.test("beta", async (t) => {
  const testdataPath = new URL("testdata/players.beta.json", import.meta.url);

  const json = JSON.parse(Deno.readTextFileSync(testdataPath));
  const config = PlayerConfigSchema.parse(json);

  await assertSnapshot(t, config);
});

Deno.test("prod", async (t) => {
  const testdataPath = new URL("testdata/players.prod.json", import.meta.url);

  const json = JSON.parse(Deno.readTextFileSync(testdataPath));
  const config = PlayerConfigSchema.parse(json);

  await assertSnapshot(t, config);
});
