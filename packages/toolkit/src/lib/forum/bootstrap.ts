import { z } from "zod";

const Seed = z.object({
  forums: z.record(z.string(), z.number()),
  keys: z.record(z.string(), z.string().min(1)),
});

export function parseForumSeed(output: string): z.infer<typeof Seed> {
  try {
    return Seed.parse(JSON.parse(output));
  } catch {
    // Even malformed or partial bootstrap output can contain newly issued keys.
    throw new Error(
      "Invalid response from XenForo bootstrap; output withheld because it may contain credentials",
    );
  }
}
