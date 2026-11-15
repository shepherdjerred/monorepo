import { z } from "zod";

/**
 * Which players' matches a lake read covers.
 *
 * `tracked` is every match Scout ingested for its own players and clients:
 * the population every report, Dare, progression page, community view and
 * guild-scope read was built on, and the default everywhere.
 *
 * `all` adds the participant crawl's tables (`report-lake/crawl/`): matches
 * sampled from the histories of players near tracked games, stored
 * identified. Only a short list of global-scope readers may ask for it, and
 * the value can only be obtained from `all-population.ts`, whose importers an
 * architecture test pins (`all-population.test.ts`). A bare `"all"` string does
 * not type-check as a population.
 */
export const AllPopulationSchema = z.literal("all").brand<"AllPopulation">();

export type AllPopulation = z.infer<typeof AllPopulationSchema>;

export type LakePopulation = "tracked" | AllPopulation;

/** Whether a population reads the participant crawl's tables. */
export function includesCrawl(population: LakePopulation | undefined): boolean {
  return population !== undefined && population !== "tracked";
}
