import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Asserts each zod contract still generates its checked-in
 * `<name>.schema.json` and parses `fixtures/<name>.json`, so producer drift
 * fails here before another language's decoder sees it.
 */
export function describeSchemaContracts(
  title: string,
  contracts: Readonly<Record<string, z.ZodType>>,
): void {
  const schemaDir = path.join(import.meta.dirname, "../../schemas");
  describe(title, () => {
    test.each(Object.entries(contracts))(
      "%s matches its checked-in JSON Schema and fixture",
      async (name, schema) => {
        const checkedIn: unknown = JSON.parse(
          await readFile(path.join(schemaDir, `${name}.schema.json`), "utf8"),
        );
        expect(z.toJSONSchema(schema)).toEqual(checkedIn);
        const fixture: unknown = JSON.parse(
          await readFile(path.join(schemaDir, `fixtures/${name}.json`), "utf8"),
        );
        expect(() => schema.parse(fixture)).not.toThrow();
      },
    );
  });
}
