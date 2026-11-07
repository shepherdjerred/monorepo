import { z } from "zod";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Disposable fixture diagnostics never serialize command/proof bodies or credentials. */
export async function traceAutomaticHandoffVerification<T>(
  budget: PublicationAuthorityReadBudget,
  roots: readonly string[],
  work: () => Promise<T>,
) {
  const consume = budget.consume.bind(budget);
  let paid = 0;
  budget.consume = (count) => {
    paid += count;
    consume(count);
  };
  try {
    return await work();
  } catch (error) {
    const detail = z.object({ code: z.string().optional() }).safeParse(error);
    let message = error instanceof Error ? error.message : "Non-Error failure";
    for (const root of roots)
      message = message.replaceAll(root, "[fixture-root]");
    message = message.replaceAll(
      /(?:postgresql|https?|magnet):\S+/gu,
      "[external-uri]",
    );
    console.error("Automatic rollback handoff actual verification failure", {
      name: error instanceof Error ? error.name : "unknown",
      code: detail.success ? detail.data.code : undefined,
      message: message.slice(0, 1024),
      paid,
    });
    throw error;
  }
}
