import { DEFAULT_MODEL_CONFIG } from "@tasknotes/model-reference";

// This development capture retains the complete pinned model, including the
// withdrawn features. Production deliberately drops only the four keys below.
// Never rewrite the capture from adapted production defaults.
export function supportedVaultDefaults(reference: string): string {
  const expectedReference = `${JSON.stringify(DEFAULT_MODEL_CONFIG, null, 2)}\n`;
  if (reference !== expectedReference) {
    throw new Error(
      "Development vault defaults differ from the pinned upstream model.",
    );
  }
  const supported = structuredClone(DEFAULT_MODEL_CONFIG);
  Reflect.deleteProperty(supported.fieldMapping, "timeEstimate");
  Reflect.deleteProperty(supported.fieldMapping, "timeEntries");
  Reflect.deleteProperty(supported.fieldMapping, "pomodoros");
  Reflect.deleteProperty(supported, "timeTracking");
  return `${JSON.stringify(supported, null, 2)}\n`;
}

export function checkVaultDefaults(
  reference: string,
  production: string,
): void {
  if (production !== supportedVaultDefaults(reference)) {
    throw new Error(
      "Rust vault defaults differ from the supported pinned upstream defaults.",
    );
  }
}

if (import.meta.main) {
  const reference = await Bun.file(
    new URL("./reference/vault-defaults.json", import.meta.url),
  ).text();
  const output = new URL(
    "../crates/tasknotes-vault/src/defaults.json",
    import.meta.url,
  );
  if (Bun.argv.includes("--write")) {
    await Bun.write(output, supportedVaultDefaults(reference));
  } else {
    checkVaultDefaults(reference, await Bun.file(output).text());
  }
}
