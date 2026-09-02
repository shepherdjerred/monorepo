import path from "node:path";
import { format } from "prettier";
import { z } from "zod";
import { DareParaphraseCorpusSchema } from "#src/model/dare-paraphrase-corpus.ts";

const outputPath = path.join(
  import.meta.dir,
  "../src/model/dare-v2-paraphrase-corpus.schema.json",
);
const generated = await format(
  JSON.stringify(z.toJSONSchema(DareParaphraseCorpusSchema)),
  { parser: "json" },
);

if (Bun.argv.includes("--write")) {
  await Bun.write(outputPath, generated);
  console.info(`Wrote ${outputPath}`);
} else {
  const current = await Bun.file(outputPath).text();
  if (current !== generated) {
    throw new Error(
      "Dare v2 paraphrase JSON Schema has drifted; run generate-dare-paraphrase-schema.ts --write.",
    );
  }
  console.info("Verified Dare v2 paraphrase JSON Schema.");
}
