import type { Database } from "#infrastructure/database.ts";

type Extension = Extract<
  Parameters<Database["$extends"]>[0],
  { query?: unknown }
>;
type QueryHooks = NonNullable<Extension["query"]>;

/** Test-only view over a real query-extended client. In particular, interactive
 * and batch transactions still run on that client with all query hooks intact;
 * no callback, SQL, transaction options or result is replaced here. */
export function queryFixtureDatabase(
  db: Database,
  extension: { query: QueryHooks },
): Database {
  // Construct only a query extension here: model/client/result extensions cannot
  // change the base contract exposed by this test-only view.
  const client = db.$extends({ query: extension.query });
  return new Proxy(db, {
    get(_target, property): unknown {
      const receiver = property === "$on" ? db : client;
      const value: unknown = Reflect.get(receiver, property, receiver);
      return typeof value === "function" ? value.bind(receiver) : value;
    },
  });
}
