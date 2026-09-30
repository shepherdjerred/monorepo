import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { resetConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { setAgentJobRuntimeDependencies } from "@shepherdjerred/birmel/scheduler/jobs/agent-jobs.ts";

export function registerAgentJobTestEnvironment(actorUserId: string): void {
  const previousTrustedUserIds = Bun.env["TRUSTED_USER_IDS"];

  beforeAll(() => {
    Bun.env["TRUSTED_USER_IDS"] = JSON.stringify([actorUserId]);
    resetConfig();
  });

  beforeEach(async () => {
    setAgentJobRuntimeDependencies(null);
    await prisma.agentJobRun.deleteMany();
    await prisma.agentJob.deleteMany();
  });

  afterEach(() => {
    setAgentJobRuntimeDependencies(null);
  });

  afterAll(() => {
    if (previousTrustedUserIds == null) {
      delete Bun.env["TRUSTED_USER_IDS"];
    } else {
      Bun.env["TRUSTED_USER_IDS"] = previousTrustedUserIds;
    }
    resetConfig();
  });
}
