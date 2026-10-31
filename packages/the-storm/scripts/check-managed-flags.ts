#!/usr/bin/env bun
/**
 * Checks each Java Flipt client's namespace and flag key constants against the
 * managed flag whose `source` names it in the shared inventory.
 *
 * This runs as its own Turbo task rather than inside Gradle's compileJava, so
 * the inventory, which changes with every flag anywhere in the repository, is
 * not an input of the plugin build or its test suite.
 *
 *   bun scripts/check-managed-flags.ts
 */
import path from "node:path";
import { z } from "zod";

const REMOTE = "plugin/modules";

type ManagedFlagGate = {
  /** The inventory flag's `source`. */
  readonly flagSource: string;
  /** Java file declaring the flag key constant. */
  readonly keyFile: string;
  /** Flag key constant name; `FLAG_KEY` unless a client evaluates several. */
  readonly keyConstant?: string;
  /** Java file declaring `NAMESPACE_KEY`; the key file unless shared. */
  readonly namespaceFile?: string;
};

const rwf = `${REMOTE}/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/adapter/remote`;
const rwfbots = `${REMOTE}/rwfbots/src/main/java/com/shepherdjerred/thestorm/rwfbots/adapter/remote`;
const world = `${REMOTE}/world/src/main/java/com/shepherdjerred/thestorm/world/adapter/remote`;

export const MANAGED_FLAG_GATES: readonly ManagedFlagGate[] = [
  {
    flagSource: "the-storm-stargates",
    keyFile: `${REMOTE}/mechanics/src/main/java/com/shepherdjerred/thestorm/mechanics/adapter/remote/FliptStargatesGate.java`,
  },
  {
    flagSource: "the-storm-rwfbots-chat",
    keyFile: `${rwfbots}/FliptChatGate.java`,
  },
  {
    flagSource: "the-storm-rwfbots-learning",
    keyFile: `${rwfbots}/FliptLearningGate.java`,
  },
  { flagSource: "the-storm-world", keyFile: `${world}/FliptCrierGate.java` },
  {
    flagSource: "the-storm-merchant",
    keyFile: `${world}/FliptMerchantGate.java`,
    namespaceFile: `${world}/FliptCrierGate.java`,
  },
  { flagSource: "the-storm-rwf", keyFile: `${rwf}/FliptRwfGate.java` },
  { flagSource: "the-storm-rwf-kits", keyFile: `${rwf}/FliptRwfKitsGate.java` },
  {
    flagSource: "the-storm-rwf-killstreaks",
    keyFile: `${rwf}/FliptRwfKillstreaksGate.java`,
  },
  ...(
    [
      ["the-storm-rwf-match-flow", "MATCH_FLOW_FLAG_KEY"],
      ["the-storm-rwf-carry-over", "CARRY_OVER_FLAG_KEY"],
      ["the-storm-rwf-death-feed", "DEATH_FEED_FLAG_KEY"],
      ["the-storm-rwf-team-chat", "TEAM_CHAT_FLAG_KEY"],
      ["the-storm-rwf-spectator-tools", "SPECTATOR_TOOLS_FLAG_KEY"],
      ["the-storm-rwf-bomb-effects", "BOMB_EFFECTS_FLAG_KEY"],
      ["the-storm-rwf-stats", "STATS_FLAG_KEY"],
      ["the-storm-rwf-host-settings", "HOST_SETTINGS_FLAG_KEY"],
      ["the-storm-rwf-candidate-visits", "CANDIDATE_VISITS_FLAG_KEY"],
    ] as const
  ).map(([flagSource, keyConstant]) => ({
    flagSource,
    keyFile: `${rwf}/FliptRwfFeatures.java`,
    keyConstant,
  })),
];

const InventorySchema = z.object({
  flags: z.array(
    z
      .object({
        source: z.string(),
        key: z.string(),
        namespace: z.string(),
        type: z.string(),
        default: z.unknown(),
      })
      .loose(),
  ),
});
type Inventory = z.infer<typeof InventorySchema>;

function javaConstant(file: string, text: string, name: string): string {
  const match = new RegExp(
    `private static final String ${name} = "([^"]+)";`,
    "u",
  ).exec(text);
  const value = match?.[1];
  if (value === undefined) {
    throw new Error(`missing Flipt client constant ${name} in ${file}`);
  }
  return value;
}

/** Every mismatch between the Java Flipt clients and the inventory. */
export function managedFlagViolations(
  inventory: Inventory,
  readJava: (file: string) => string,
  gates: readonly ManagedFlagGate[] = MANAGED_FLAG_GATES,
): string[] {
  const violations: string[] = [];
  for (const gate of gates) {
    const matches = inventory.flags.filter(
      (flag) => flag.source === gate.flagSource,
    );
    const flag = matches[0];
    if (flag === undefined || matches.length !== 1) {
      violations.push(
        `expected exactly one managed flag for ${gate.flagSource}`,
      );
      continue;
    }
    const namespaceFile = gate.namespaceFile ?? gate.keyFile;
    const key = javaConstant(
      gate.keyFile,
      readJava(gate.keyFile),
      gate.keyConstant ?? "FLAG_KEY",
    );
    const namespace = javaConstant(
      namespaceFile,
      readJava(namespaceFile),
      "NAMESPACE_KEY",
    );
    if (
      flag.type !== "boolean" ||
      flag.default !== false ||
      flag.key !== key ||
      flag.namespace !== namespace
    ) {
      violations.push(
        `Flipt ${gate.flagSource} identifiers differ from managed inventory`,
      );
    }
  }
  return violations;
}

if (import.meta.main) {
  const packageRoot = path.resolve(import.meta.dir, "..");
  const inventory = InventorySchema.parse(
    await Bun.file(
      path.join(
        packageRoot,
        "../feature-flags/src/managed-flag-inventory.json",
      ),
    ).json(),
  );
  const sources = new Map<string, string>();
  for (const gate of MANAGED_FLAG_GATES) {
    for (const file of [gate.keyFile, gate.namespaceFile ?? gate.keyFile]) {
      if (!sources.has(file)) {
        sources.set(file, await Bun.file(path.join(packageRoot, file)).text());
      }
    }
  }
  const violations = managedFlagViolations(inventory, (file) => {
    const text = sources.get(file);
    if (text === undefined) throw new Error(`unread Java source ${file}`);
    return text;
  });
  for (const violation of violations) console.error(violation);
  process.exitCode = violations.length === 0 ? 0 : 1;
}
