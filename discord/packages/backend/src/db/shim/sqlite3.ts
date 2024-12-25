import * as _sqlite3 from "https://deno.land/x/sqlite3@0.10.0/mod.ts";
import { Database } from "./database.ts";

export const sqlite3 = {
  ..._sqlite3,
  Database,
  verbose: () => {
    return sqlite3;
  },
};

export default sqlite3;
