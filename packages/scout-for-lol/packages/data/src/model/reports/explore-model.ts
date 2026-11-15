import { z } from "zod";

/**
 * The models the Explore picker may offer, with the label every surface shows.
 * The web select and Scout Desktop's `explore/models` route both read this
 * list, so the two pickers cannot drift.
 */
export const EXPLORE_MODEL_OPTIONS = [
  { id: "gpt-6-luna", label: "GPT-6 Luna · High" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol · High" },
] as const;
export const ExploreModelSchema = z.enum(["gpt-6-luna", "gpt-6.1-sol"]);
export type ExploreModel = z.infer<typeof ExploreModelSchema>;
