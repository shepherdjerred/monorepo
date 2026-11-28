import {
  flagDeployments,
  type FlagDeployment,
} from "@shepherdjerred/feature-flags/deployments.ts";
import { retiredKeysForDeployment } from "@shepherdjerred/feature-flags/flags-reconcile.ts";
import type {
  FlagsArchiveResponse,
  FlagsHistoryResponse,
  FlagsMetadataResponse,
} from "@shepherdjerred/feature-flags/flags-wire.ts";
import { managedFlagInventory } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { projectDeploymentFlags } from "@shepherdjerred/feature-flags/project-deployment.ts";
import type { FlagAuditEntry } from "./audit.ts";
import { legacyFlagDate } from "./legacy-flag-dates.ts";
import type { DeploymentDocument, FlagStore } from "./store.ts";

type ArchiveFlag = FlagsArchiveResponse["deployments"][number]["flags"][number];
type MetadataFlag = FlagsMetadataResponse["flags"][number];

const inventoryByKey = new Map(
  managedFlagInventory.flags.map((flag) => [flag.key, flag]),
);

function deploymentById(id: string): FlagDeployment | undefined {
  return flagDeployments.find((deployment) => deployment.id === id);
}

export function historyView(
  store: FlagStore,
  deploymentId: string,
  key: string,
  page: { readonly before?: number | undefined; readonly limit: number },
): FlagsHistoryResponse {
  const { entries, nextBefore } = store.audit.history(deploymentId, key, page);
  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      at: entry.at.toISOString(),
      action: entry.action,
      actor: { kind: entry.actor.kind, id: entry.actor.id },
      revisionAfter: entry.revisionAfter,
      before: entry.before,
      after: entry.after,
    })),
    nextBefore,
    auditStartedAt: store.audit.startedAt().toISOString(),
  };
}

function createdAtFor(
  store: FlagStore,
  deploymentId: string,
  key: string,
): Pick<MetadataFlag, "createdAt" | "createdAtBasis"> {
  const recorded = store.audit.createdAt(deploymentId, key);
  if (recorded !== undefined) {
    return { createdAt: recorded.toISOString(), createdAtBasis: "recorded" };
  }
  const legacy = legacyFlagDate(key);
  if (legacy === undefined)
    return { createdAt: null, createdAtBasis: "unknown" };
  return {
    createdAt: legacy.date.toISOString(),
    createdAtBasis: legacy.onOrBefore ? "on-or-before" : "first-declared",
  };
}

/** Inventory metadata, added time and last change for every live key. */
export function metadataView(
  store: FlagStore,
  document: DeploymentDocument,
): FlagsMetadataResponse {
  const deployment = deploymentById(document.id);
  const declared = new Set(
    deployment === undefined
      ? []
      : projectDeploymentFlags(deployment).map((flag) => flag.key),
  );
  return {
    deployment: document.id,
    auditStartedAt: store.audit.startedAt().toISOString(),
    flags: document.flags.map((flag) => {
      const inventory = inventoryByKey.get(flag.key);
      const last = store.audit.lastChange(document.id, flag.key);
      return {
        key: flag.key,
        ...(inventory === undefined
          ? {}
          : {
              purpose: inventory.purpose,
              owner: inventory.owner,
              namespace: inventory.namespace,
              source: inventory.source,
            }),
        declared: declared.has(flag.key),
        ...createdAtFor(store, document.id, flag.key),
        lastChangedAt: last?.at.toISOString() ?? null,
        lastChangedBy:
          last === undefined
            ? null
            : { kind: last.actor.kind, id: last.actor.id },
      };
    }),
  };
}

function recordedArchiveFlag(entry: FlagAuditEntry): ArchiveFlag {
  return {
    key: entry.key,
    retiredAt: entry.at.toISOString(),
    retiredBy: { kind: entry.actor.kind, id: entry.actor.id },
    final: entry.before,
    revision: entry.revisionAfter,
    basis: "recorded",
  };
}

/**
 * Retired keys per deployment: audit-recorded retirements, plus keys that
 * `retiredFlagDeclarations` retires from a stored deployment and that were
 * deleted before the audit trail (no retire row, final value not recorded).
 */
export function archiveView(store: FlagStore): FlagsArchiveResponse {
  const byDeployment = new Map<string, ArchiveFlag[]>();
  for (const entry of store.audit.archive()) {
    const flags = byDeployment.get(entry.deploymentId) ?? [];
    flags.push(recordedArchiveFlag(entry));
    byDeployment.set(entry.deploymentId, flags);
  }
  for (const deployment of flagDeployments) {
    const document = store.document(deployment.id);
    if (document === undefined) continue;
    const live = new Set(document.flags.map((flag) => flag.key));
    const flags = byDeployment.get(deployment.id) ?? [];
    const recorded = new Set(flags.map((flag) => flag.key));
    for (const key of retiredKeysForDeployment(deployment)) {
      if (live.has(key) || recorded.has(key)) continue;
      flags.push({
        key,
        retiredAt: null,
        retiredBy: null,
        final: null,
        revision: null,
        basis: "declared-retired",
      });
    }
    if (flags.length > 0) byDeployment.set(deployment.id, flags);
  }
  return {
    deployments: [...byDeployment]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([id, flags]) => ({
        id,
        flags: flags.toSorted((left, right) =>
          left.key.localeCompare(right.key),
        ),
      })),
  };
}
