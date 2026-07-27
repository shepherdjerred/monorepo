import { z } from "zod";

const PokemonUpstreamSchema = z.object({
  repository: z.url(),
  branch: z.string().min(1),
  commit: z.string().regex(/^[a-f\d]{40}$/),
});

export type PokemonUpstream = z.infer<typeof PokemonUpstreamSchema>;

export function parsePokemonUpstream(value: unknown): PokemonUpstream {
  return PokemonUpstreamSchema.parse(value);
}
