import type { Database } from "bun:sqlite";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";

/**
 * Who made a write. A human is the verified tailnet login; a machine is the
 * advisory label a token holder sent (or `unknown`); the startup seed is the
 * only system actor.
 */
export type FlagsActor =
  | { readonly kind: "human"; readonly id: string }
  | { readonly kind: "machine"; readonly id: string }
  | { readonly kind: "system"; readonly id: "seed" };

export type FlagAuditAction = "create" | "update" | "retire";

export type FlagAuditEntry = {
  readonly id: number;
  readonly at: Date;
  readonly deploymentId: string;
  readonly key: string;
  readonly action: FlagAuditAction;
  readonly actor: { readonly kind: FlagsActor["kind"]; readonly id: string };
  readonly revisionAfter: number;
  /** Parsed stored body. Not re-validated: old bodies may predate today's schema. */
  readonly before: unknown;
  readonly after: unknown;
};

export const HISTORY_PAGE_LIMIT = 100;

type AuditRow = {
  readonly id: number;
  readonly at: number;
  readonly deployment_id: string;
  readonly key: string;
  readonly action: FlagAuditAction;
  readonly actor_kind: FlagsActor["kind"];
  readonly actor_id: string;
  readonly revision_after: number;
  readonly before_body: string | null;
  readonly after_body: string | null;
};

const AUDIT_COLUMNS = `flag_audit.id AS id, flag_audit.at AS at,
  flag_audit.deployment_id AS deployment_id, flag_audit.key AS key,
  flag_audit.action AS action, flag_audit.actor_kind AS actor_kind,
  flag_audit.actor_id AS actor_id, flag_audit.revision_after AS revision_after,
  flag_audit.before_body AS before_body, flag_audit.after_body AS after_body`;

function parseBody(body: string | null): unknown {
  return body === null ? null : JSON.parse(body);
}

function toEntry(row: AuditRow): FlagAuditEntry {
  return {
    id: row.id,
    at: new Date(row.at),
    deploymentId: row.deployment_id,
    key: row.key,
    action: row.action,
    actor: { kind: row.actor_kind, id: row.actor_id },
    revisionAfter: row.revision_after,
    before: parseBody(row.before_body),
    after: parseBody(row.after_body),
  };
}

/**
 * The append-only `flag_audit` table. Writers call `record` inside the store's
 * own write transaction, so a refused or rolled-back write leaves no row.
 */
export class FlagAuditLog {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date,
  ) {}

  record(entry: {
    readonly deploymentId: string;
    readonly key: string;
    readonly action: FlagAuditAction;
    readonly actor: FlagsActor;
    readonly revisionAfter: number;
    readonly before: FlagValue | null;
    readonly after: FlagValue | null;
  }): void {
    this.db
      .query(
        `INSERT INTO flag_audit (at, deployment_id, key, action, actor_kind,
           actor_id, revision_after, before_body, after_body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.now().getTime(),
        entry.deploymentId,
        entry.key,
        entry.action,
        entry.actor.kind,
        entry.actor.id,
        entry.revisionAfter,
        entry.before === null ? null : JSON.stringify(entry.before),
        entry.after === null ? null : JSON.stringify(entry.after),
      );
  }

  /** When this database began recording audit rows (the v1 migration). */
  startedAt(): Date {
    const row = this.db
      .query<{ readonly value: string }, []>(
        "SELECT value FROM store_meta WHERE name = 'audit_started_at'",
      )
      .get();
    if (row === null) throw new Error("store_meta.audit_started_at is missing");
    return new Date(row.value);
  }

  /**
   * One page of a key's history, newest first. `nextBefore` is the id to pass
   * as `before` for the following page, or null on the last page.
   */
  history(
    deploymentId: string,
    key: string,
    page: { readonly before?: number | undefined; readonly limit: number },
  ): {
    readonly entries: readonly FlagAuditEntry[];
    readonly nextBefore: number | null;
  } {
    if (
      !Number.isSafeInteger(page.limit) ||
      page.limit < 1 ||
      page.limit > HISTORY_PAGE_LIMIT
    ) {
      throw new Error(`history limit ${String(page.limit)} is out of range`);
    }
    const rows = this.db
      .query<AuditRow, [string, string, number, number]>(
        `SELECT ${AUDIT_COLUMNS} FROM flag_audit
         WHERE deployment_id = ? AND key = ? AND id < ?
         ORDER BY id DESC LIMIT ?`,
      )
      .all(
        deploymentId,
        key,
        page.before ?? Number.MAX_SAFE_INTEGER,
        page.limit + 1,
      );
    const entries = rows.slice(0, page.limit).map((row) => toEntry(row));
    const last = entries.at(-1);
    return {
      entries,
      nextBefore:
        last !== undefined && rows.length > page.limit ? last.id : null,
    };
  }

  /** The latest `create` row's time: a re-created key gets its new time. */
  createdAt(deploymentId: string, key: string): Date | undefined {
    const row = this.db
      .query<{ readonly at: number }, [string, string]>(
        `SELECT at FROM flag_audit
         WHERE deployment_id = ? AND key = ? AND action = 'create'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(deploymentId, key);
    return row === null ? undefined : new Date(row.at);
  }

  lastChange(deploymentId: string, key: string): FlagAuditEntry | undefined {
    const row = this.db
      .query<AuditRow, [string, string]>(
        `SELECT ${AUDIT_COLUMNS} FROM flag_audit
         WHERE deployment_id = ? AND key = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(deploymentId, key);
    return row === null ? undefined : toEntry(row);
  }

  /**
   * Keys whose latest audit action is `retire` and which are not live, with
   * the retire row (its `before` is the final stored body).
   */
  archive(): FlagAuditEntry[] {
    return this.db
      .query<AuditRow, []>(
        `SELECT ${AUDIT_COLUMNS} FROM flag_audit
         JOIN (
           SELECT MAX(id) AS id FROM flag_audit GROUP BY deployment_id, key
         ) AS latest ON latest.id = flag_audit.id
         WHERE flag_audit.action = 'retire'
           AND NOT EXISTS (
             SELECT 1 FROM flag
             WHERE flag.deployment_id = flag_audit.deployment_id
               AND flag.key = flag_audit.key
           )
         ORDER BY flag_audit.deployment_id, flag_audit.key`,
      )
      .all()
      .map((row) => toEntry(row));
  }
}
