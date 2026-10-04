import { expect, test } from "vitest";
import { hydrateInlineEntities } from "./inline-entities.ts";

test("hydrates every supported entity from the bundled catalog", async () => {
  const entities = await hydrateInlineEntities(
    "[Doran](scout://item/1056) -> [Mejai](scout://item/3041) [Ahri](scout://champion/Ahri) [Q](scout://ability/Ahri-Q) [Flash](scout://spell/SummonerFlash) [Electrocute](scout://rune/8112)",
  );
  expect(entities.map((entity) => entity.kind)).toEqual([
    "item",
    "item",
    "champion",
    "ability",
    "spell",
    "rune",
  ]);
  expect(
    entities.every(
      (entity) =>
        entity.name.length > 0 &&
        entity.description.length > 0 &&
        entity.version.length > 0,
    ),
  ).toBe(true);
});
test("unknown model identities remain text", async () => {
  expect(
    await hydrateInlineEntities(
      "[unknown](scout://item/999999) [unknown](scout://champion/Unknown) ![photo](https://example.com/x.png)",
    ),
  ).toEqual([]);
});
