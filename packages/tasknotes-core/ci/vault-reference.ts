import { DEFAULT_MODEL_CONFIG } from "@tasknotes/model-reference";

// A pinned, development-only upstream oracle. Apps embed the resulting JSON;
// they never load this package or execute JavaScript to operate a vault.
const output = new URL(
  "../crates/tasknotes-vault/src/defaults.json",
  import.meta.url,
);
const expected = `${JSON.stringify(DEFAULT_MODEL_CONFIG, null, 2)}\n`;
if (Bun.argv.includes("--write")) {
  await Bun.write(output, expected);
} else if ((await Bun.file(output).text()) !== expected) {
  throw new Error("Rust vault defaults differ from the pinned upstream model.");
}
