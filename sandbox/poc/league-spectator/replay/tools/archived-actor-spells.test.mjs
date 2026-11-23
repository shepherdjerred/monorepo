import { expect, test } from "bun:test";
import {
  buildActorSpellCatalog,
  actorSpellHash,
} from "./archived-actor-spells.mjs";

test("retains original character fields and leaves absent spell animations unresolved", () => {
  const path = "Characters/Original/CharacterRecords/SR_Outer";
  const record = {
    __type: "CharacterRecord",
    mCharacterName: "Original",
    minionFlags: 8,
    healthBarHeight: 137.5,
    basicAttack: { mAttackName: "OriginalExplicitAttack" },
  };
  const objects = [
    [path, record],
    [
      "Characters/Original/Spells/Explicit",
      {
        __type: "SpellObject",
        ObjectName: "OriginalExplicitAttack",
        mSpell: { originalUnresolvedField: 3 },
      },
    ],
  ];
  const snapshot = structuredClone(objects);
  const naming = {
    entryRva: 123,
    sliceSha256: "a".repeat(64),
    defaults: Object.fromEntries(
      Array.from({ length: 18 }, (_, index) => [
        index + 64,
        { format: "%sBasicAttack", number: null },
      ]),
    ),
  };
  const catalog = buildActorSpellCatalog({
    actor: { character: "Original", characterRecords: [path] },
    objects,
    attackNaming: naming,
    attackNamingSha256: "b".repeat(64),
  });
  expect(catalog.records[path].data).toEqual(record);
  expect(catalog.records[path].attackSlots[64]).toMatchObject({
    name: "OriginalExplicitAttack",
    animation: null,
    implicitName: false,
  });
  expect(catalog.spells[actorSpellHash("OriginalExplicitAttack")].data).toEqual(
    { originalUnresolvedField: 3 },
  );
  expect(catalog.records[path].unresolvedAttackSlots[65]).toContain(
    "Unresolved original attack",
  );
  expect(objects).toEqual(snapshot);
});

test("never aliases a missing requested character record to Root", () => {
  expect(() =>
    buildActorSpellCatalog({
      actor: {
        character: "Original",
        characterRecords: ["Characters/Original/CharacterRecords/SR_Outer"],
      },
      objects: [
        [
          "Characters/Original/CharacterRecords/Root",
          { __type: "CharacterRecord" },
        ],
      ],
      attackNaming: { defaults: {} },
      attackNamingSha256: "b".repeat(64),
    }),
  ).toThrow("Unresolved original character record");
});
