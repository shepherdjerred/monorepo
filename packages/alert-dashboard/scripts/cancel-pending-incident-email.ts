#!/usr/bin/env bun
import { parseArgs } from "node:util";
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

function parseCliArgs(): z.infer<typeof ArgsSchema> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      database: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      operator: { type: "string" },
      reason: { type: "string" },
      confirm: { type: "boolean", default: false },
    },
    strict: true,
  });
  return ArgsSchema.parse(values);
}

const args = parseCliArgs();
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
