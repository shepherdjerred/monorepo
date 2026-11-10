#!/usr/bin/env bun
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  buildVaultAudit,
  managedItemReferences,
  manifestAuditReferences,
  sourceAuditReferences,
  pipelineGrantManifests,
  type AuditReference,
  type AuditCoverage,
} from "./audit-core.ts";
import { resolveAuditItem } from "./field-map.ts";
import {
  VAULT_ID,
  type OpItem,
} from "homelab/src/cdk8s/scripts/onepassword-lib.ts";
import {
  synthManifests,
  collectDesiredStateTargets,
} from "homelab/src/cdk8s/scripts/check-1password-items.ts";
import {
  capturedRead,
  parsePrivateJson,
  readVault,
} from "homelab/scripts/tofu/secret-read.ts";
import { previewAdoption } from "homelab/scripts/tofu/credential-handoff.ts";
import { applicationSecrets } from "homelab/scripts/tofu/application-secrets.ts";

const root = new URL("../../../../../../", import.meta.url).pathname;
const KubeListSchema = z.object({ items: z.array(z.unknown()) });

async function sourceIdentity() {
  const head = await capturedRead(
    ["git", "rev-parse", "HEAD"],
    "source revision",
  );
  const status = await capturedRead(
    ["git", "status", "--porcelain"],
    "source status",
  );
  return {
    head: head.trim(),
    status: status.trim().split("\n").filter(Boolean),
    diff: createHash("sha256")
      .update(
        await capturedRead(
          ["git", "diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"],
          "source content identity",
        ),
      )
      .digest("hex"),
  };
}

async function trackedReferences(coverage: AuditCoverage) {
  const fileOutput = await capturedRead(
    ["git", "ls-files", "-z"],
    "tracked source inventory",
  );
  const references: AuditReference[] = [];
  for (const file of fileOutput.split("\0").filter(Boolean)) {
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)) continue;
    if (
      !/\.(?:ts|tsx|js|jsonc?|ya?ml|mdx?|toml|conf|ini|tf|tmpl|tpl|env|sh|fish)$/u.test(
        file,
      ) &&
      !/\.env(?:\.|$)/u.test(file)
    )
      continue;
    const source = Bun.file(path.join(root, file));
    if (source.size > 2_000_000) {
      coverage.gaps.push(`oversized source skipped: ${file}`);
      continue;
    }
    const text = await source.text();
    references.push(
      ...sourceAuditReferences(text, file),
      ...managedItemReferences(text, file),
    );
  }
  return references;
}

async function generatedPipelineManifests(): Promise<unknown[]> {
  const manifests: unknown[] = [];
  for (const graph of [[], ["--delivery-catalog-v2"]]) {
    const raw = parsePrivateJson(
      await capturedRead(
        [
          "bun",
          "packages/woodpecker-config-extension/src/dump-steps.ts",
          "--include-canaries",
          ...graph,
        ],
        "evaluated CI grants",
      ),
      z.unknown(),
    );
    manifests.push(
      ...pipelineGrantManifests(raw, graph.length === 0 ? "ci" : "ci-v2"),
    );
  }
  return manifests;
}

async function brokerReferences(): Promise<AuditReference[]> {
  const locators = parsePrivateJson(
    await capturedRead(
      [
        "bun",
        "packages/toolkit/src/index.ts",
        "credentials",
        "references",
        "--json",
      ],
      "broker reference metadata",
    ),
    z.array(z.object({ name: z.string(), ref: z.string() })),
  );
  return locators.flatMap((entry) =>
    sourceAuditReferences(JSON.stringify(entry.ref), "broker:" + entry.name),
  );
}

export function auditArguments(args: readonly string[]) {
  const vaults: string[] = [];
  let live = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--live") live = true;
    else if (
      arg === "--vault" &&
      next !== undefined &&
      /^[a-z0-9]{26}$/u.test(next)
    ) {
      vaults.push(next);
      index++;
    } else throw new Error("Usage: audit-vault.ts [--live] [--vault ID ...]");
  }
  return {
    live,
    vaults: [...new Set(vaults.length === 0 ? [VAULT_ID] : vaults)],
  };
}

async function consumerBindingChecks(items: readonly OpItem[]) {
  const desired = z
    .object({
      openai_service_accounts: z.record(
        z.string(),
        z.object({
          project_key: z.string(),
          onepassword_targets: z.array(z.object({ vault_item_id: z.string() })),
        }),
      ),
    })
    .parse(
      await Bun.file(
        path.join(root, "packages/homelab/src/tofu/openai/desired-state.json"),
      ).json(),
    );
  const runtime = resolveAuditItem(items, "storm-brain");
  const targets = Object.values(desired.openai_service_accounts)
    .filter((unit) => unit.project_key === "storm-brain")
    .flatMap((unit) => unit.onepassword_targets);
  return {
    storm_brain: {
      runtime_item_id: runtime?.id ?? null,
      declared_item_ids: targets.map((target) => target.vault_item_id),
      status:
        runtime !== undefined &&
        targets.length > 0 &&
        targets.every(
          (target) =>
            resolveAuditItem(items, target.vault_item_id)?.id === runtime.id,
        )
          ? "same-item-title-and-id-alias"
          : "unresolved-or-mismatched",
    },
  };
}

function targetReference(
  target: {
    vault_item_id: string;
    vault_field?: string;
    vault_json_path?: string;
    vault_section_id?: string;
    vault_field_id?: string;
  },
  source: string,
  managed: boolean,
): AuditReference {
  return {
    item: target.vault_item_id,
    source,
    managed,
    access: "target",
    ...(target.vault_field === undefined ? {} : { field: target.vault_field }),
    ...(target.vault_json_path === undefined
      ? {}
      : { jsonPath: target.vault_json_path }),
    ...(target.vault_section_id === undefined
      ? {}
      : { sectionId: target.vault_section_id }),
    ...(target.vault_field_id === undefined
      ? {}
      : { fieldId: target.vault_field_id }),
  };
}

async function desiredReferences(): Promise<AuditReference[]> {
  const references: AuditReference[] = [];
  for (const { platform, target } of await collectDesiredStateTargets()) {
    references.push(targetReference(target, `tofu:${platform}`, true));
  }
  for (const stack of ["google", "anthropic-federation"]) {
    const desired = await Bun.file(
      path.join(root, `packages/homelab/src/tofu/${stack}/desired-state.json`),
    ).text();
    for (const match of desired.matchAll(
      /"onepassword_item_title"\s*:\s*"([^"]+)"/gu,
    )) {
      if (match[1] !== undefined)
        references.push({
          item: match[1],
          source: `tofu:${stack}`,
          managed: true,
          wholeItem: true,
        });
    }
  }
  for (const [unit, credential] of Object.entries(
    applicationSecrets.credentials,
  )) {
    for (const target of credential.onepassword_targets)
      references.push(targetReference(target, `preparation:${unit}`, false));
  }
  return references;
}

async function liveReferences(coverage: AuditCoverage) {
  try {
    const live = parsePrivateJson(
      await capturedRead(
        [
          "kubectl",
          "get",
          "onepassworditems,deployments,statefulsets,daemonsets,pods,jobs,cronjobs,applications.argoproj.io",
          "-A",
          "-o",
          "json",
          "--request-timeout=20s",
        ],
        "live consumer metadata",
      ),
      KubeListSchema,
    );
    const collected = manifestAuditReferences(live.items, "live");
    coverage.inspected.push(
      "live Kubernetes item bindings and workload/Argo consumer metadata",
    );
    coverage.gaps.push(
      "live ConfigMaps, custom controllers and opaque chart template consumers",
    );
    return collected;
  } catch {
    coverage.gaps.push(
      "live Kubernetes read unavailable; authentication/authorization/network layer not established",
    );
    return { references: [], unresolved: [] };
  }
}

async function main(): Promise<void> {
  const args = auditArguments(Bun.argv.slice(2));
  const coverage: AuditCoverage = {
    inspected: [
      "explicitly selected active vaults (archived items excluded)",
      "in-memory CDK8s synthesis",
      "platform desired state",
      "tracked production source reference scan including CI and dotfiles (test fixtures excluded)",
    ],
    gaps: [
      "external repositories, dashboards, local rendered dotfiles and human consumers",
      "archived items and attachment contents",
      "provider identities, permissions, revocation and consumer probes",
      "OpenTofu live state ownership/revision",
    ],
  };
  const identity = await sourceIdentity();
  const references = [
    ...(await trackedReferences(coverage)),
    ...(await desiredReferences()),
    ...(await brokerReferences()),
  ];
  const rendered = manifestAuditReferences(
    [...(await synthManifests()), ...(await generatedPipelineManifests())],
    "rendered",
  );
  references.push(...rendered.references);
  const live = args.live
    ? await liveReferences(coverage)
    : { references: [], unresolved: [] };
  if (!args.live)
    coverage.gaps.push("live Kubernetes consumers not inspected (use --live)");
  references.push(...live.references);
  const available = parsePrivateJson(
    await capturedRead(
      [
        "scripts/onepassword/with-service-account.sh",
        "op",
        "vault",
        "list",
        "--format",
        "json",
      ],
      "vault identity metadata",
    ),
    z.array(z.object({ id: z.string(), name: z.string() })),
  );
  const normalized = references.map((reference) => {
    if (reference.vault === undefined) return reference;
    const matches = available.filter(
      (vault) =>
        vault.id.toLowerCase() === reference.vault?.toLowerCase() ||
        vault.name.toLowerCase() === reference.vault?.toLowerCase(),
    );
    const first = matches[0];
    return first !== undefined && matches.length === 1
      ? { ...reference, vault: first.id }
      : reference;
  });
  const outside = normalized.filter(
    (reference) => !args.vaults.includes(reference.vault ?? VAULT_ID),
  );
  if (outside.length > 0)
    coverage.gaps.push(
      "consumer references outside the selected or accessible vaults",
    );
  const items: OpItem[] = [];
  for (const vault of args.vaults) items.push(...(await readVault(vault)));
  const audit = buildVaultAudit(
    items,
    normalized.filter((reference) =>
      args.vaults.includes(reference.vault ?? VAULT_ID),
    ),
    coverage,
  );
  const finished = await sourceIdentity();
  if (JSON.stringify(identity) !== JSON.stringify(finished))
    throw new Error(
      "Source changed during audit; rerun before reviewing candidates.",
    );
  console.log(
    JSON.stringify(
      {
        schema_version: 2,
        generated_at: new Date().toISOString(),
        source_revision: identity.head,
        source_worktree_status: identity.status,
        source_worktree_diff: identity.diff,
        ...audit,
        outside_vault_references: outside,
        unresolved: [
          ...audit.unresolved,
          ...rendered.unresolved,
          ...live.unresolved,
        ],
        generation_preparation: previewAdoption(items),
        bootstrap_preparation: {
          item_title: "application-secrets-tofu-credentials",
          field: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
          create: false,
          ci_grant: false,
        },
        cleanup_preparation: {
          policy: "archive-first after canonical identity and consumer proof",
          canonical_changes: [],
          obsolete_fields: [],
          archive_actions: [],
          prerequisites: [
            "close consumer coverage gaps",
            "confirm issuer/identity/permissions/environment/rotation owner",
            "update every declared consumer reference",
            "refresh structural vault snapshot after operator edits",
            "retain previous values for rollback; no permanent deletion",
          ],
        },
        consumer_binding_checks: await consumerBindingChecks(items),
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error(
      "Vault audit failed; no complete report produced. Private command/response details withheld.",
    );
    process.exitCode = 1;
  }
}
