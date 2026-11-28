import { Database } from "bun:sqlite";
import { isDeepStrictEqual } from "node:util";
import {
  flagDeployments,
  type FlagDeployment,
} from "@shepherdjerred/feature-flags/deployments.ts";
import {
  evaluateBoolean,
  type FlagValue,
} from "@shepherdjerred/feature-flags/evaluate.ts";
import {
  managedFlagWriteIssues,
  type FlagValueKeyIssue,
} from "@shepherdjerred/feature-flags/flag-write-validation.ts";
import { projectDeploymentFlags } from "@shepherdjerred/feature-flags/project-deployment.ts";
import { unreadFlagDocuments } from "@shepherdjerred/feature-flags/unread-documents.ts";
import { FlagAuditLog, type FlagsActor } from "./audit.ts";
import { migrate } from "./migrations.ts";
import { FlagValueSchema } from "./schema.ts";

export type FlagStoreOptions = {
  /** Clock for audit rows and the migration's `audit_started_at`. */
  readonly now?: () => Date;
};

export type DeploymentDocument = {
  readonly id: string;
  readonly revision: number;
  readonly flags: readonly FlagValue[];
};

export type DeploymentSummary = {
  readonly id: string;
  readonly revision: number;
  readonly flagCount: number;
};

export type ApplyFailure =
  | { readonly kind: "conflict"; readonly document: DeploymentDocument }
  | { readonly kind: "unknown-deployment" }
  | { readonly kind: "duplicate-key"; readonly key: string }
  | {
      readonly kind: "invalid-values";
      readonly issues: readonly FlagValueKeyIssue[];
    };

export type RetireFailure =
  | { readonly kind: "conflict"; readonly document: DeploymentDocument }
  | { readonly kind: "missing"; readonly keys: readonly string[] }
  | { readonly kind: "unknown-deployment" }
  | { readonly kind: "duplicate-key"; readonly key: string };

type RevisionRow = { readonly revision: number };
type BodyRow = { readonly key: string; readonly body: string };
type SummaryRow = {
  readonly id: string;
  readonly revision: number;
  readonly flag_count: number;
};

function duplicateKey(
  flags: readonly { readonly key: string }[],
): string | undefined {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (seen.has(flag.key)) return flag.key;
    seen.add(flag.key);
  }
  return undefined;
}

/**
 * The first reason a write batch is refused before touching the database:
 * a repeated key, or any flag the managed inventory and value schemas reject.
 */
function batchFailure(flags: readonly FlagValue[]): ApplyFailure | undefined {
  const duplicate = duplicateKey(flags);
  if (duplicate !== undefined) return { kind: "duplicate-key", key: duplicate };
  const issues = managedFlagWriteIssues(flags);
  return issues.length === 0 ? undefined : { kind: "invalid-values", issues };
}

function revisionFailure(
  result:
    | { readonly kind: "unknown" }
    | { readonly kind: "conflict"; readonly document: DeploymentDocument },
): {
  readonly ok: false;
  readonly failure: Extract<
    ApplyFailure,
    { kind: "conflict" | "unknown-deployment" }
  >;
} {
  return result.kind === "unknown"
    ? { ok: false, failure: { kind: "unknown-deployment" } }
    : { ok: false, failure: { kind: "conflict", document: result.document } };
}

function parseFlag(body: string, key: string): FlagValue {
  const parsed = FlagValueSchema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    throw new Error(`stored flag ${key} is not a flag value`);
  }
  return parsed.data;
}

export class FlagStore {
  /** Attributed write history; rows are written inside each write transaction. */
  readonly audit: FlagAuditLog;

  private constructor(
    private readonly db: Database,
    now: () => Date,
  ) {
    this.audit = new FlagAuditLog(db, now);
  }

  static open(
    path: string,
    { now = () => new Date() }: FlagStoreOptions = {},
  ): FlagStore {
    const db = new Database(path);
    db.run("PRAGMA foreign_keys = ON");
    if (path !== ":memory:") db.run("PRAGMA journal_mode = WAL");
    db.run(`
      CREATE TABLE IF NOT EXISTS deployment (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS flag (
        deployment_id TEXT NOT NULL REFERENCES deployment(id),
        key TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (deployment_id, key)
      )
    `);
    try {
      migrate(db, now());
    } catch (error) {
      db.close();
      throw error;
    }
    return new FlagStore(db, now);
  }

  /** Deployments from `deployments` that do not yet have a stored document. */
  missingDeployments(
    deployments: readonly FlagDeployment[] = flagDeployments,
  ): FlagDeployment[] {
    const stored = new Set(this.list().map((summary) => summary.id));
    return deployments.filter((deployment) => !stored.has(deployment.id));
  }

  close(): void {
    this.db.close();
  }

  private insertDeploymentIfAbsent(
    id: string,
    flags: readonly FlagValue[],
    actor: FlagsActor,
  ): boolean {
    const insertDeployment = this.db.query(
      "INSERT INTO deployment (id, revision) VALUES (?, 1) ON CONFLICT DO NOTHING",
    );
    const insertFlag = this.db.query(
      "INSERT INTO flag (deployment_id, key, body) VALUES (?, ?, ?)",
    );
    const runTx = this.db.transaction(() => {
      if (insertDeployment.run(id).changes === 0) return false;
      for (const flag of flags) {
        insertFlag.run(id, flag.key, JSON.stringify(flag));
        this.audit.record({
          deploymentId: id,
          key: flag.key,
          action: "create",
          actor,
          revisionAfter: 1,
          before: null,
          after: flag,
        });
      }
      return true;
    });
    return runTx();
  }

  /**
   * Inserts each deployment that is not already stored, and creates any newly
   * declared inventory keys on existing deployments without overwriting stored
   * flag values or targeting rules.
   */
  seedFromInventory(actor: FlagsActor): {
    readonly seeded: readonly string[];
  } {
    const seeded: string[] = [];
    for (const deployment of flagDeployments) {
      const flags = projectDeploymentFlags(deployment);
      if (this.insertDeploymentIfAbsent(deployment.id, flags, actor)) {
        seeded.push(deployment.id);
      } else {
        const created = this.createMissing(deployment.id, flags, actor);
        if (!created.ok) {
          throw new Error(
            `failed to seed missing flags for ${deployment.id}: ${created.failure.kind}`,
          );
        }
      }
    }
    return { seeded };
  }

  /**
   * Inserts deployments that are not already stored. A later call does not
   * replace an existing document, preserving live stored values across restarts.
   */
  seedDocuments(
    documents: readonly { id: string; flags: readonly FlagValue[] }[],
    actor: FlagsActor,
  ): { readonly seeded: readonly string[] } {
    const seeded: string[] = [];
    for (const document of documents) {
      if (this.insertDeploymentIfAbsent(document.id, document.flags, actor)) {
        seeded.push(document.id);
      }
    }
    return { seeded };
  }

  unreadDocuments() {
    return unreadFlagDocuments();
  }

  list(): DeploymentSummary[] {
    const rows = this.db
      .query<SummaryRow, []>(
        `SELECT deployment.id AS id, deployment.revision AS revision,
                COUNT(flag.key) AS flag_count
         FROM deployment
         LEFT JOIN flag ON flag.deployment_id = deployment.id
         GROUP BY deployment.id
         ORDER BY deployment.id`,
      )
      .all();
    return rows.map((row) => ({
      id: row.id,
      revision: row.revision,
      flagCount: row.flag_count,
    }));
  }

  document(id: string): DeploymentDocument | undefined {
    const revision = this.db
      .query<RevisionRow, [string]>(
        "SELECT revision FROM deployment WHERE id = ?",
      )
      .get(id);
    if (revision === null) return undefined;
    return {
      id,
      revision: revision.revision,
      flags: this.flags(id),
    };
  }

  flag(
    id: string,
    key: string,
  ): { readonly revision: number; readonly flag: FlagValue } | undefined {
    const document = this.document(id);
    if (document === undefined) return undefined;
    const flag = document.flags.find((candidate) => candidate.key === key);
    return flag === undefined
      ? undefined
      : { revision: document.revision, flag };
  }

  /**
   * Writes named flags when the revision matches. A mismatch writes nothing,
   * including flags later in the same request. A batch with any undeclared
   * key, wrong type, or invalid variant value is refused before the revision
   * check and writes nothing. Each flag that differs from the stored body gets
   * a `create` or `update` audit row; an identical flag gets none, though the
   * revision still advances.
   */
  apply(
    id: string,
    expectedRevision: number,
    flags: readonly FlagValue[],
    actor: FlagsActor,
  ):
    | { readonly ok: true; readonly revision: number }
    | { readonly ok: false; readonly failure: ApplyFailure } {
    const refused = batchFailure(flags);
    if (refused !== undefined) return { ok: false, failure: refused };
    const upsert = this.db.query(
      `INSERT INTO flag (deployment_id, key, body) VALUES (?, ?, ?)
       ON CONFLICT (deployment_id, key) DO UPDATE SET body = excluded.body`,
    );
    const write = this.db.transaction(() => {
      const gate = this.gateRevision(id, expectedRevision);
      if (gate.kind !== "current") return gate;
      const stored = new Map(
        gate.document.flags.map((flag) => [flag.key, flag]),
      );
      for (const flag of flags) {
        upsert.run(id, flag.key, JSON.stringify(flag));
        const before = stored.get(flag.key);
        if (before !== undefined && isDeepStrictEqual(before, flag)) continue;
        this.audit.record({
          deploymentId: id,
          key: flag.key,
          action: before === undefined ? "create" : "update",
          actor,
          revisionAfter: expectedRevision + 1,
          before: before ?? null,
          after: flag,
        });
      }
      this.bumpRevision(id, expectedRevision, "apply");
      return { kind: "written" as const, revision: expectedRevision + 1 };
    });
    const result = write();
    return result.kind === "written"
      ? { ok: true, revision: result.revision }
      : revisionFailure(result);
  }

  /**
   * Inserts keys that are absent. A key that already exists keeps its body.
   * Every submitted flag is validated, including ones that already exist, so
   * one invalid entry refuses the whole batch.
   */
  createMissing(
    id: string,
    flags: readonly FlagValue[],
    actor: FlagsActor,
  ):
    | {
        readonly ok: true;
        readonly revision: number;
        readonly created: readonly string[];
      }
    | { readonly ok: false; readonly failure: ApplyFailure } {
    const refused = batchFailure(flags);
    if (refused !== undefined) return { ok: false, failure: refused };
    const insert = this.db.query(
      "INSERT INTO flag (deployment_id, key, body) VALUES (?, ?, ?)",
    );
    const bump = this.db.query(
      "UPDATE deployment SET revision = revision + 1 WHERE id = ?",
    );
    const write = this.db.transaction(() => {
      const current = this.document(id);
      if (current === undefined) return { kind: "unknown" as const };
      const present = new Set(current.flags.map((flag) => flag.key));
      const created: string[] = [];
      for (const flag of flags) {
        if (present.has(flag.key)) continue;
        insert.run(id, flag.key, JSON.stringify(flag));
        this.audit.record({
          deploymentId: id,
          key: flag.key,
          action: "create",
          actor,
          revisionAfter: current.revision + 1,
          before: null,
          after: flag,
        });
        created.push(flag.key);
      }
      if (created.length === 0) {
        return { kind: "unchanged" as const, revision: current.revision };
      }
      const updated = bump.run(id);
      if (updated.changes !== 1) {
        throw new Error(`deployment ${id} disappeared during create-missing`);
      }
      return {
        kind: "created" as const,
        revision: current.revision + 1,
        created,
      };
    });
    const result = write();
    if (result.kind === "unknown") {
      return { ok: false, failure: { kind: "unknown-deployment" } };
    }
    return result.kind === "unchanged"
      ? { ok: true, revision: result.revision, created: [] }
      : { ok: true, revision: result.revision, created: result.created };
  }

  /**
   * Deletes every named key when the revision matches and every key exists.
   * Otherwise the document is unchanged. Each key's final body is kept in its
   * `retire` audit row, written before the delete in the same transaction.
   */
  retire(
    id: string,
    expectedRevision: number,
    keys: readonly string[],
    actor: FlagsActor,
  ):
    | { readonly ok: true; readonly revision: number }
    | { readonly ok: false; readonly failure: RetireFailure } {
    const duplicate = duplicateKey(keys.map((key) => ({ key })));
    if (duplicate !== undefined) {
      return { ok: false, failure: { kind: "duplicate-key", key: duplicate } };
    }
    const remove = this.db.query(
      "DELETE FROM flag WHERE deployment_id = ? AND key = ?",
    );
    const write = this.db.transaction(() => {
      const gate = this.gateRevision(id, expectedRevision);
      if (gate.kind !== "current") return gate;
      const present = new Map(
        gate.document.flags.map((flag) => [flag.key, flag]),
      );
      const missing = keys.filter((key) => !present.has(key));
      if (missing.length > 0)
        return { kind: "missing" as const, keys: missing };
      for (const key of keys) {
        this.audit.record({
          deploymentId: id,
          key,
          action: "retire",
          actor,
          revisionAfter: expectedRevision + 1,
          before: present.get(key) ?? null,
          after: null,
        });
        remove.run(id, key);
      }
      this.bumpRevision(id, expectedRevision, "retire");
      return { kind: "retired" as const, revision: expectedRevision + 1 };
    });
    const result = write();
    if (result.kind === "missing") {
      return { ok: false, failure: { kind: "missing", keys: result.keys } };
    }
    return result.kind === "retired"
      ? { ok: true, revision: result.revision }
      : revisionFailure(result);
  }

  private gateRevision(
    id: string,
    expectedRevision: number,
  ):
    | { readonly kind: "unknown" }
    | { readonly kind: "conflict"; readonly document: DeploymentDocument }
    | { readonly kind: "current"; readonly document: DeploymentDocument } {
    const current = this.document(id);
    if (current === undefined) return { kind: "unknown" };
    return current.revision === expectedRevision
      ? { kind: "current", document: current }
      : { kind: "conflict", document: current };
  }

  private bumpRevision(
    id: string,
    expectedRevision: number,
    action: "apply" | "retire",
  ): void {
    const updated = this.db
      .query(
        "UPDATE deployment SET revision = revision + 1 WHERE id = ? AND revision = ?",
      )
      .run(id, expectedRevision);
    if (updated.changes !== 1) {
      throw new Error(`deployment ${id} revision changed during ${action}`);
    }
  }

  evaluate(id: string, key: string, context: Readonly<Record<string, string>>) {
    const document = this.document(id);
    return document === undefined
      ? { kind: "unknown-deployment" as const }
      : evaluateBoolean(document.flags, key, context);
  }

  private flags(id: string): FlagValue[] {
    const rows = this.db
      .query<BodyRow, [string]>(
        "SELECT key, body FROM flag WHERE deployment_id = ? ORDER BY key",
      )
      .all(id);
    return rows.map((row) => parseFlag(row.body, row.key));
  }
}
