import { Database } from "bun:sqlite";
import { flagDeployments } from "@shepherdjerred/feature-flags/deployments.ts";
import {
  evaluateBoolean,
  type FlagValue,
} from "@shepherdjerred/feature-flags/evaluate.ts";
import { projectDeploymentFlags } from "@shepherdjerred/feature-flags/project-deployment.ts";
import { unreadFlagDocuments } from "@shepherdjerred/feature-flags/unread-documents.ts";
import { FlagValueSchema } from "./schema.ts";

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
  | { readonly kind: "duplicate-key"; readonly key: string };

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

function parseFlag(body: string, key: string): FlagValue {
  const parsed = FlagValueSchema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    throw new Error(`stored flag ${key} is not a flag value`);
  }
  return parsed.data;
}

export class FlagStore {
  private constructor(private readonly db: Database) {}

  static open(path: string): FlagStore {
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
    return new FlagStore(db);
  }

  /** Inserts each deployment that is not already stored. Existing rows stay. */
  seedFromInventory(): { readonly seeded: readonly string[] } {
    const seeded: string[] = [];
    const insertDeployment = this.db.query(
      "INSERT INTO deployment (id, revision) VALUES (?, 1) ON CONFLICT DO NOTHING",
    );
    const insertFlag = this.db.query(
      "INSERT INTO flag (deployment_id, key, body) VALUES (?, ?, ?)",
    );
    const seed = this.db.transaction(
      (id: string, flags: readonly FlagValue[]) => {
        const result = insertDeployment.run(id);
        if (result.changes === 0) return false;
        for (const flag of flags) {
          insertFlag.run(id, flag.key, JSON.stringify(flag));
        }
        return true;
      },
    );
    for (const deployment of flagDeployments) {
      if (seed(deployment.id, projectDeploymentFlags(deployment))) {
        seeded.push(deployment.id);
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
   * including flags later in the same request.
   */
  apply(
    id: string,
    expectedRevision: number,
    flags: readonly FlagValue[],
  ):
    | { readonly ok: true; readonly revision: number }
    | { readonly ok: false; readonly failure: ApplyFailure } {
    const duplicate = duplicateKey(flags);
    if (duplicate !== undefined) {
      return { ok: false, failure: { kind: "duplicate-key", key: duplicate } };
    }
    const upsert = this.db.query(
      `INSERT INTO flag (deployment_id, key, body) VALUES (?, ?, ?)
       ON CONFLICT (deployment_id, key) DO UPDATE SET body = excluded.body`,
    );
    const bump = this.db.query(
      "UPDATE deployment SET revision = revision + 1 WHERE id = ? AND revision = ?",
    );
    const write = this.db.transaction(() => {
      const current = this.document(id);
      if (current === undefined) return { kind: "unknown" as const };
      if (current.revision !== expectedRevision) {
        return { kind: "conflict" as const, document: current };
      }
      for (const flag of flags) {
        upsert.run(id, flag.key, JSON.stringify(flag));
      }
      const updated = bump.run(id, expectedRevision);
      if (updated.changes !== 1) {
        throw new Error(`deployment ${id} revision changed during apply`);
      }
      return { kind: "written" as const, revision: expectedRevision + 1 };
    });
    const result = write();
    if (result.kind === "unknown") {
      return { ok: false, failure: { kind: "unknown-deployment" } };
    }
    if (result.kind === "conflict") {
      return {
        ok: false,
        failure: { kind: "conflict", document: result.document },
      };
    }
    return { ok: true, revision: result.revision };
  }

  /**
   * Inserts keys that are absent. A key that already exists keeps its body.
   */
  createMissing(
    id: string,
    flags: readonly FlagValue[],
  ):
    | {
        readonly ok: true;
        readonly revision: number;
        readonly created: readonly string[];
      }
    | { readonly ok: false; readonly failure: ApplyFailure } {
    const duplicate = duplicateKey(flags);
    if (duplicate !== undefined) {
      return { ok: false, failure: { kind: "duplicate-key", key: duplicate } };
    }
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
   * Otherwise the document is unchanged.
   */
  retire(
    id: string,
    expectedRevision: number,
    keys: readonly string[],
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
    const bump = this.db.query(
      "UPDATE deployment SET revision = revision + 1 WHERE id = ? AND revision = ?",
    );
    const write = this.db.transaction(() => {
      const current = this.document(id);
      if (current === undefined) return { kind: "unknown" as const };
      if (current.revision !== expectedRevision) {
        return { kind: "conflict" as const, document: current };
      }
      const present = new Set(current.flags.map((flag) => flag.key));
      const missing = keys.filter((key) => !present.has(key));
      if (missing.length > 0)
        return { kind: "missing" as const, keys: missing };
      for (const key of keys) remove.run(id, key);
      const updated = bump.run(id, expectedRevision);
      if (updated.changes !== 1) {
        throw new Error(`deployment ${id} revision changed during retire`);
      }
      return { kind: "retired" as const, revision: expectedRevision + 1 };
    });
    const result = write();
    if (result.kind === "unknown") {
      return { ok: false, failure: { kind: "unknown-deployment" } };
    }
    if (result.kind === "conflict") {
      return {
        ok: false,
        failure: { kind: "conflict", document: result.document },
      };
    }
    return result.kind === "missing"
      ? { ok: false, failure: { kind: "missing", keys: result.keys } }
      : { ok: true, revision: result.revision };
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
