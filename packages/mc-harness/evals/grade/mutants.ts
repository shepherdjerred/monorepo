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

const LAMP = /(?:minecraft:)?redstone_lamp(?:\[[^\]]*\])?/gu;

/**
 * Replaces every redstone lamp the scenario places with stone, whether written
 * bare or with an explicit state (`redstone_lamp[lit=false]`). Lines inside an
 * `expect…;` statement are left alone so the lit/unlit assertions survive.
 */
export function replaceLampPlacements(source: string): string {
  let inAssertion = false;
  return source
    .split("\n")
    .map((line) => {
      if (line.includes("expect")) {
        inAssertion = true;
      }
      const out = inAssertion ? line : line.replaceAll(LAMP, "minecraft:stone");
      if (inAssertion && line.trimEnd().endsWith(";")) {
        inAssertion = false;
      }
      return out;
    })
    .join("\n");
}

const MUTATIONS: readonly {
  name: string;
  description: string;
  apply: (source: string) => string;
}[] = [
  {
    name: "no-lamp",
    description: "every placed redstone lamp becomes stone (assertions kept)",
    apply: replaceLampPlacements,
  },
  {
    name: "no-use",
    description: "the actor never uses the lever",
    apply: (source) =>
      source.replaceAll(
        /await\s+[\w.]+\.use\([^)]*\)\s*;?/gu,
        "/* eval mutant: use removed */",
      ),
  },
  {
    name: "no-break",
    description: "the actor looks at the lever instead of breaking it",
    apply: (source) => source.replaceAll(".break(", ".look("),
  },
];

export function makeMutants(source: string): Mutant[] {
  return MUTATIONS.map((mutation) => {
    const mutated = mutation.apply(source);
    return {
      name: mutation.name,
      description: mutation.description,
      source: mutated,
      applied: mutated !== source,
    };
  });
}
