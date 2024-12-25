import { Statement as _Statement } from "https://deno.land/x/sqlite3@0.10.0/mod.ts";

export class Statement extends _Statement {
  get changes() {
    return this.db.changes;
  }

  get lastID() {
    return this.db.lastInsertRowId;
  }
}
