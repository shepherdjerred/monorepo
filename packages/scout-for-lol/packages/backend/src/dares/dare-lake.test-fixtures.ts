import type { StubbedLake } from "#src/dares/dare-test-fixtures.ts";
import { vi } from "vitest";

/** Per-suite evidence control; compilation still runs against real SQL. */
const controlledLake = vi.hoisted((): StubbedLake => ({
  achieved: false,
  sourceMatchIds: [],
}));

vi.mock("#src/dares/sql/dare-sql.ts", async () => {
  const { stubbedDareSqlModule } =
    await import("#src/dares/dare-test-fixtures.ts");
  return await stubbedDareSqlModule(controlledLake);
});

export const lake = controlledLake;
