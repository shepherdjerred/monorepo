import { environmentService } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import type { Result } from "./result.ts";

/** A renamed environment keeps its history and accepted selection (section 7). */
export async function renameEnvironments(
  tx: Transaction,
  renames: Readonly<Record<string, string>>,
  result: Result,
) {
  for (const [from, to] of Object.entries(renames)) {
    const [source, target] = await Promise.all([
      tx.environment.findUnique({ where: { id: from } }),
      tx.environment.findUnique({ where: { id: to } }),
    ]);
    if (source === null) continue;
    if (target !== null)
      throw new DeliveryError(
        "CONFLICT",
        `Cannot rename ${from} onto existing environment ${to}`,
      );
    if (source.activeDeploymentId !== null)
      throw new DeliveryError(
        "CONFLICT",
        `Environment ${from} is owned by a deployment and cannot be renamed`,
      );
    await tx.environment.update({
      where: { id: from },
      data: {
        id: to,
        serviceId: environmentService(to),
        name: to.slice(to.indexOf("/") + 1),
      },
    });
    result.environments.renamed.push({ from, to });
  }
}
