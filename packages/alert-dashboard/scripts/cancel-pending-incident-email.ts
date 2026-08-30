#!/usr/bin/env bun
import { z } from "zod";

import { createPrismaRepository } from "#infrastructure/prisma-repository";
import {
  InstantTextSchema,
  instantTextToEpochNanoseconds,
  systemClock,
} from "#shared/time";

const ArgsSchema = z.object({
  database: z.string().startsWith("file:"),
  from: InstantTextSchema,
  to: InstantTextSchema,
  operator: z.string().min(1),
  reason: z.string().min(10),
  confirm: z.boolean(),
});

function parseArgs(argv: readonly string[]): z.infer<typeof ArgsSchema> {
  const raw: Record<string, unknown> = { confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--confirm") {
      raw["confirm"] = true;
      continue;
    }
    if (arg?.startsWith("--") !== true) {
      throw new Error(`Unknown argument: ${String(arg)}`);
    }
    const key = arg.slice(2);
    if (!["database", "from", "to", "operator", "reason"].includes(key)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    raw[key] = value;
    index += 1;
  }
  return ArgsSchema.parse(raw);
}

const args = parseArgs(Bun.argv.slice(2));
const repository = await createPrismaRepository(args.database);
try {
  const result = await repository.cancelPendingEmails({
    alertname: "TemporalWorkflowFailed",
    fromNs: instantTextToEpochNanoseconds(args.from),
    toNs: instantTextToEpochNanoseconds(args.to),
    canceledAtNs: systemClock.now().epochNanoseconds,
    canceledBy: args.operator,
    reason: args.reason,
    confirm: args.confirm,
  });
  await Bun.write(
    Bun.stdout,
    JSON.stringify({
      mode: args.confirm ? "confirmed" : "dry-run",
      alertname: "TemporalWorkflowFailed",
      matched: result.matched,
      canceled: result.canceled,
      ids: result.ids,
    }) + "\n",
  );
} finally {
  await repository.disconnect();
}
