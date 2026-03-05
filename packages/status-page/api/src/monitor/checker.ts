import { prisma } from "../db/client.ts";

async function checkComponent(
  componentId: string,
  monitorUrl: string,
): Promise<void> {
  let isUp = false;
  let responseTimeMs: number | null = null;

  try {
    const start = performance.now();
    const response = await fetch(monitorUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    responseTimeMs = Math.round(performance.now() - start);
    isUp = response.ok;
  } catch {
    isUp = false;
  }

  await prisma.uptimeCheck.create({
    data: {
      componentId,
      isUp,
      responseTimeMs,
    },
  });

  const newStatus = isUp ? "operational" : "major_outage";
  await prisma.component.update({
    where: { id: componentId },
    data: { status: newStatus },
  });
}

async function runChecks(): Promise<void> {
  const components = await prisma.component.findMany({
    where: {
      monitorUrl: { not: null },
    },
  });

  const checks = [];
  for (const c of components) {
    if (c.monitorUrl !== null) {
      checks.push(checkComponent(c.id, c.monitorUrl));
    }
  }
  await Promise.allSettled(checks);
}

export function startMonitor(): void {
  console.log("Starting health check monitor (60s interval)");
  void runChecks();
  setInterval(() => {
    void runChecks();
  }, 60_000);
}
