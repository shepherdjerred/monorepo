import { expect, test } from "vitest";
import { checkVaultDefaults, supportedVaultDefaults } from "./vault-reference";

const reference = await Bun.file(
  new URL("./reference/vault-defaults.json", import.meta.url),
).text();
const production = await Bun.file(
  new URL("../crates/tasknotes-vault/src/defaults.json", import.meta.url),
).text();

test("complete upstream capture and explicitly adapted production defaults agree", () => {
  expect(() => checkVaultDefaults(reference, production)).not.toThrow();
});

test("development reference drift is rejected even when production remains valid", () => {
  const changed = reference.replace(
    '"status": "status"',
    '"status": "drifted_status"',
  );
  expect(changed).not.toBe(reference);
  expect(() => checkVaultDefaults(changed, production)).toThrow(
    "Development vault defaults differ",
  );
});

test("every retained production field mapping remains guarded", () => {
  const changed = production.replace(
    '"status": "status"',
    '"status": "drifted_status"',
  );
  expect(changed).not.toBe(production);
  expect(() => checkVaultDefaults(reference, changed)).toThrow(
    "Rust vault defaults differ",
  );
});

test("retained default values remain guarded", () => {
  const changed = production.replace('"status": "open"', '"status": "done"');
  expect(changed).not.toBe(production);
  expect(() => checkVaultDefaults(reference, changed)).toThrow(
    "Rust vault defaults differ",
  );
});

test("withdrawn mappings and settings cannot return through the defaults producer", () => {
  expect(supportedVaultDefaults(reference)).toBe(production);
  expect(() => checkVaultDefaults(reference, reference)).toThrow(
    "Rust vault defaults differ",
  );
});
