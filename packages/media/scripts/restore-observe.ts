import { parseArgs } from "node:util";
import { z } from "zod";
import { createDatabase } from "#infrastructure/database.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";

const { values } = parseArgs({
  options: {
    "recovery-id": { type: "string" },
    "expected-epoch": { type: "string" },
    reason: { type: "string" },
  },
  strict: true,
});
const database = createDatabase(z.url().parse(Bun.env["DATABASE_URL"]));
try {
  const receipt = await prepareMediaRestore(database, {
    recoveryId: values["recovery-id"],
    expectedEpoch: z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(values["expected-epoch"]),
    reason: values.reason,
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} catch {
  console.error(
    "Restore preparation failed. Workers must remain stopped; inspect the recovery input and database state.",
  );
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
