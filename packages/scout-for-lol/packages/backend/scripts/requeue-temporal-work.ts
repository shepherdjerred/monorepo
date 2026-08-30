#!/usr/bin/env bun
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
    const key = arg === "--work-id" ? "workId" : arg.slice(2);
    if (key !== "workId" && key !== "reason") {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    raw[key] = value;
    index += 1;
  }
  return ArgsSchema.parse(raw);
}

const args = parseArgs(Bun.argv.slice(2));
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
