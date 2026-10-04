/**
 * Mutation testing for the E3 lever/lamp playtest: each mutant breaks one
 * thing the scenario claims to check. A meaningful scenario fails on every
 * mutant; one that still passes asserts nothing about that behavior.
 */
export type Mutant = {
  name: string;
  description: string;
  source: string;
  applied: boolean;
};

const MUTATIONS: readonly {
  name: string;
  description: string;
  pattern: RegExp;
  replacement: string;
}[] = [
  {
    name: "no-lamp",
    description:
      "the redstone lamp is placed as stone (expected states keep their [lit=…])",
    // Only bare block ids, never `minecraft:redstone_lamp[lit=…]` expectations.
    pattern: /minecraft:redstone_lamp(?![[\w])/gu,
    replacement: "minecraft:stone",
  },
  {
    name: "no-use",
    description: "the actor never uses the lever",
    pattern: /await\s+[\w.]+\.use\([^)]*\)\s*;?/gu,
    replacement: "/* eval mutant: use removed */",
  },
  {
    name: "no-break",
    description: "the actor looks at the lever instead of breaking it",
    pattern: /\.break\(/gu,
    replacement: ".look(",
  },
];

export function makeMutants(source: string): Mutant[] {
  return MUTATIONS.map((mutation) => {
    const mutated = source.replace(mutation.pattern, mutation.replacement);
    return {
      name: mutation.name,
      description: mutation.description,
      source: mutated,
      applied: mutated !== source,
    };
  });
}
