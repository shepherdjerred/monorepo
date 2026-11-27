// What the "generic sequence" validator would have kept of the combos the last
// run wrote for the cached general units. No API call: it reads
// review-set-v2.json and applies `isGenericSequence`.
//
//   pipeline/combos-survival.ts [--v2 <review-set-v2.json>]

import { parseArgs } from "node:util";
import { z } from "zod";
import {
  ComboStepSchema,
  ComboCategorySchema,
} from "#src/tips/combos/combo-schema.ts";
import {
  isGenericSequence,
  isGenericWording,
} from "#src/tips/combos/combos.ts";

const DIRECTORY = "/Users/jerred/.local/share/scout-redesign/tips-review";

const FileSchema = z.array(
  z.object({
    kind: z.string(),
    champion: z.string(),
    lane: z.string(),
    combos: z
      .array(
        z
          .object({
            name: z.string(),
            category: ComboCategorySchema,
            sequence: z.array(ComboStepSchema),
            when: z.string(),
            text: z.string(),
          })
          .loose(),
      )
      .optional(),
  }),
);

const text = (step: z.infer<typeof ComboStepSchema>): string =>
  step === "attack"
    ? "attack"
    : step.kind === "ability"
      ? step.slot
      : step.name;

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      v2: { type: "string", default: `${DIRECTORY}/review-set-v2.json` },
    },
    strict: true,
  });
  const file = FileSchema.parse(await Bun.file(values.v2).json());
  let before = 0;
  let after = 0;
  console.log(
    "| General unit | Combos written | Survive | Dropped as generic |",
  );
  console.log("| --- | --- | --- | --- |");
  for (const unit of file.filter((entry) => entry.kind === "general")) {
    const combos = unit.combos ?? [];
    const generic = combos.filter(
      (combo) => isGenericSequence(combo) || isGenericWording(combo),
    );
    before += combos.length;
    after += combos.length - generic.length;
    console.log(
      `| ${unit.champion} ${unit.lane} | ${combos.length.toString()} | ${(combos.length - generic.length).toString()} | ${generic.map((combo) => `${combo.name} (${combo.category}: ${combo.sequence.map((step) => text(step)).join(" ")})`).join("; ") || "none"} |`,
    );
  }
  console.log(
    `\n${before.toString()} combos written, ${after.toString()} survive.`,
  );
}

if (import.meta.main) {
  await main();
}
