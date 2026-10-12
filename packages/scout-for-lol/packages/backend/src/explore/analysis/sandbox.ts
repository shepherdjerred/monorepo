import { z } from "zod";
import { prisma } from "#src/database/index.ts";

export const SandboxResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: z.json() }),
  z.strictObject({ ok: z.literal(false), message: z.string().max(1000) }),
]);

let active = 0;

export async function analyzeJavaScript(
  input: { code: string; datasets: string; signal: AbortSignal },
  database = prisma,
): Promise<z.infer<typeof SandboxResultSchema>> {
  if (input.signal.aborted)
    throw new DOMException("Analysis aborted", "AbortError");
  if (active >= 2)
    return { ok: false, message: "Analysis is busy. Try again shortly." };
  if (new TextEncoder().encode(input.datasets).byteLength > 64 * 1024 * 1024)
    return { ok: false, message: "Datasets exceed 64 MiB. Narrow the query." };
  const lease = await database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-explore-sandbox'))`;
    const now = new Date();
    await tx.exploreSandboxLease.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    if ((await tx.exploreSandboxLease.count()) >= 2) return null;
    return await tx.exploreSandboxLease.create({
      data: { expiresAt: new Date(now.getTime() + 15_000) },
    });
  });
  if (lease === null)
    return { ok: false, message: "Analysis is busy. Try again shortly." };
  active++;
  let worker: Worker | undefined;
  try {
    worker = new Worker(
      new URL(
        import.meta.url.endsWith(".ts")
          ? "./sandbox-worker.ts"
          : "./sandbox-worker.js",
        import.meta.url,
      ).href,
    );
    const current = worker;
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value: z.infer<typeof SandboxResultSchema>) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException("Analysis aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        finish({
          ok: false,
          message: "JavaScript exceeded the 10 second limit.",
        });
      }, 10_000);
      const cleanup = () => {
        clearTimeout(timer);
        input.signal.removeEventListener("abort", abort);
        current.terminate();
      };
      current.addEventListener("message", (event: MessageEvent<unknown>) => {
        const parsed = SandboxResultSchema.safeParse(event.data);
        if (parsed.success) finish(parsed.data);
        else {
          if (!settled) {
            settled = true;
            cleanup();
            reject(parsed.error);
          }
        }
      });
      current.addEventListener("error", () => {
        finish({ ok: false, message: "Analysis worker failed." });
      });
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) abort();
      else
        current.postMessage({
          code: input.code,
          datasets: input.datasets,
          deadline: Math.min(
            Date.now() + 10_000,
            lease.expiresAt.getTime() - 1,
          ),
        });
    });
  } finally {
    worker?.terminate();
    active--;
    await database.exploreSandboxLease.deleteMany({ where: { id: lease.id } });
  }
}
