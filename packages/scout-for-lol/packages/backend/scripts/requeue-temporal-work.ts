#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { z } from "zod";

import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { requeueFailedScoutTemporalWork } from "#src/temporal/work-store.ts";

const logger = createLogger("requeue-temporal-work");

const ArgsSchema = z.object({
  workId: z.string().min(1),
  reason: z.string().trim().min(10),
  confirm: z.boolean(),
});

function parseCliArgs(): z.infer<typeof ArgsSchema> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "work-id": { type: "string" },
      reason: { type: "string" },
      confirm: { type: "boolean", default: false },
    },
    strict: true,
  });
  return ArgsSchema.parse({
    workId: values["work-id"],
    reason: values.reason,
    confirm: values.confirm,
  });
}

const args = parseCliArgs();
try {
  const work = await prisma.scoutTemporalWork.findUniqueOrThrow({
    where: { id: args.workId },
    select: { id: true, kind: true, state: true, requeueCount: true },
  });
  if (work.state !== "failed") {
    throw new Error(`Scout Temporal work ${work.id} is not failed`);
  }
  if (args.confirm) {
    await requeueFailedScoutTemporalWork(work.id, args.reason);
  }
  logger.info("Scout Temporal work requeue evaluated", {
    mode: args.confirm ? "confirmed" : "dry-run",
    workId: work.id,
    kind: work.kind,
    previousState: work.state,
    previousRequeueCount: work.requeueCount,
  });
} finally {
  await prisma.$disconnect();
}
