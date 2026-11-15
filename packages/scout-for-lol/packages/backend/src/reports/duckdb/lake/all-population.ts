import { AllPopulationSchema } from "#src/reports/duckdb/lake/population.ts";

/**
 * The `all` population: tracked matches plus the participant crawl.
 *
 * Importing this module is the permission. `all-population.test.ts` lists the
 * modules allowed to, so a new reader of crawled players' data is a reviewed
 * change to that list, never a stray argument.
 */
export const ALL_POPULATION = AllPopulationSchema.parse("all");
