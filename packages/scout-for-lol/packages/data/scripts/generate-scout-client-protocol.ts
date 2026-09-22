import path from "node:path";
import { format } from "prettier";
import { z } from "zod";

const PositiveIntegerSchema = z.number().int().positive();
const ProtocolContractSchema = z.strictObject({
  protocolVersion: PositiveIntegerSchema,
  observationSchemaVersion: PositiveIntegerSchema,
  maxBatchBytes: PositiveIntegerSchema,
  maxBatchObservations: PositiveIntegerSchema,
  payload: z.strictObject({
    maxDepth: PositiveIntegerSchema,
    maxArrayItems: PositiveIntegerSchema,
    maxObjectKeys: PositiveIntegerSchema,
    maxStringBytes: PositiveIntegerSchema,
    maxKeyBytes: PositiveIntegerSchema,
    unsafeKeys: z.array(z.string().min(1)).min(1),
  }),
  envelopeStringMaxBytes: z.strictObject({
    appVersion: PositiveIntegerSchema,
    leaguePatch: PositiveIntegerSchema,
    platformId: PositiveIntegerSchema,
    localPuuid: PositiveIntegerSchema,
    lobbyId: PositiveIntegerSchema,
    gameId: PositiveIntegerSchema,
  }),
  observationKinds: z.array(z.string().min(1)).min(1),
  quarantineReasons: z.array(z.string().min(1)).min(1),
});

const contractPath = path.join(
  import.meta.dir,
  "../src/scout-client/protocol.contract.json",
);
const outputPath = path.join(
  import.meta.dir,
  "../src/scout-client/protocol.generated.ts",
);
const contract = ProtocolContractSchema.parse(
  await Bun.file(contractPath).json(),
);
function addNumericSeparators(match: string, digits: string): string {
  const grouped = [...digits]
    .reverse()
    .map((digit, index) => (index > 0 && index % 3 === 0 ? `${digit}_` : digit))
    .reverse()
    .join("");
  return match.replace(digits, grouped);
}

const contractLiteral = JSON.stringify(contract).replace(
  /:(\d{5,})(?=[,}])/g,
  addNumericSeparators,
);
const generated = await format(
  `// Generated from protocol.contract.json. Do not edit.\nexport const SCOUT_CLIENT_PROTOCOL_CONTRACT = ${contractLiteral} as const;\n`,
  { parser: "typescript" },
);

if (Bun.argv.includes("--write")) {
  await Bun.write(outputPath, generated);
  console.info(`Wrote ${outputPath}`);
} else {
  const current = await Bun.file(outputPath).text();
  if (current !== generated) {
    throw new Error(
      "Scout Client protocol bindings have drifted; run generate-scout-client-protocol.ts --write.",
    );
  }
  console.info("Verified Scout Client protocol bindings.");
}
