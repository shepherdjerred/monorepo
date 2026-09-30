#!/usr/bin/env bun
import { parseArgs } from "node:util";
import type { z } from "zod";

import { createPrismaRepository } from "#infrastructure/prisma-repository";
import { CancelIncidentArgsSchema } from "#shared/cancel-incident-args";
import { instantTextToEpochNanoseconds, systemClock } from "#shared/time";

function parseCliArgs(): z.infer<typeof CancelIncidentArgsSchema> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      database: { type: "string" },
      alertname: { type: "string" },
      "all-alertnames": { type: "boolean", default: false },
      from: { type: "string" },
      to: { type: "string" },
      operator: { type: "string" },
      reason: { type: "string" },
      confirm: { type: "boolean", default: false },
    },
    strict: true,
  });
  const { "all-alertnames": allAlertnames, ...rest } = values;
  return CancelIncidentArgsSchema.parse({ ...rest, allAlertnames });
}

const args = parseCliArgs();
const repository = await createPrismaRepository(args.database);
try {
  const result = await repository.cancelPendingEmails({
    alertname: args.allAlertnames ? undefined : args.alertname,
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
      alertname: args.allAlertnames
        ? "(all pending in window)"
        : args.alertname,
      matched: result.matched,
      canceled: result.canceled,
      ids: result.ids,
    }) + "\n",
  );
} finally {
  await repository.disconnect();
}
