import { DARE_SQL_V3_SOURCES } from "#src/reports/duckdb/dare-sql-v3-profile.ts";
import {
  relationalScoutQlArrayValue as arrayValue,
  relationalScoutQlObjectValue as objectValue,
  relationalScoutQlStringValue as stringValue,
  type RelationalScoutQlJsonValue as JsonValue,
} from "#src/reports/duckdb/relational-scoutql-json.ts";

/**
 * Where a column reference in a frozen Dare SQL AST gets its values.
 *
 * The lake's closed value domains describe lake columns, so a name alone cannot
 * decide anything: `COUNT(*) AS queue` is a CTE's own integer and
 * `queue >= 5` against it is a perfectly good contract. `unknown` is deliberately
 * distinct from `derived` — it means the AST did not say, which is not a licence
 * to guess in either direction.
 */
type DareSqlV3ColumnOrigin = "lake" | "derived" | "unknown";

/** `absent` says the relation does not export the column at all, so keep looking. */
type ColumnLookup = DareSqlV3ColumnOrigin | "absent";

type AstObject = Record<string, JsonValue>;

/** A relation's body plus the FROM-clause names its output columns were given. */
type RelationDefinition = {
  node: AstObject | null;
  columnAliases: string[];
};

type Relation =
  { kind: "lake" } | { kind: "derived"; definition: RelationDefinition };

export type DareSqlV3Scope = {
  relations: { name: string; relation: Relation }[];
  ctes: Map<string, RelationDefinition>;
  parent: DareSqlV3Scope | null;
};

// SQL identifiers are case-insensitive and the lake writes its columns in lower
// case, so every name this module compares is folded once, on the way in.
const LAKE_SOURCE_NAMES = new Set(
  [...DARE_SQL_V3_SOURCES].map((source) => source.toLowerCase()),
);

function lowerString(value: JsonValue | undefined): string | null {
  const text = stringValue(value);
  return text === null ? null : text.toLowerCase();
}

function columnAliasList(value: JsonValue | undefined): string[] {
  return arrayValue(value)
    .map((alias) => lowerString(alias))
    .filter((alias) => alias !== null);
}

/** The name a select-list entry publishes: its alias, else the column it names. */
function projectedName(value: JsonValue | undefined): string | null {
  const expression = objectValue(value);
  if (expression === null) return null;
  const alias = lowerString(expression["alias"]);
  if (alias !== null && alias.length > 0) return alias;
  return lowerString(arrayValue(expression["column_names"]).at(-1));
}

function cteDefinitions(
  node: AstObject,
  inherited: ReadonlyMap<string, RelationDefinition>,
): Map<string, RelationDefinition> {
  const ctes = new Map(inherited);
  for (const entryValue of arrayValue(objectValue(node["cte_map"])?.["map"])) {
    const entry = objectValue(entryValue);
    const name = lowerString(entry?.["key"]);
    if (name === null) continue;
    const value = objectValue(entry?.["value"]);
    ctes.set(name, {
      node: objectValue(objectValue(value?.["query"])?.["node"]),
      columnAliases: columnAliasList(value?.["aliases"]),
    });
  }
  return ctes;
}

function addBaseTable(from: AstObject, scope: DareSqlV3Scope): void {
  const table = lowerString(from["table_name"]);
  if (table === null) return;
  const alias = lowerString(from["alias"]);
  const name = alias !== null && alias.length > 0 ? alias : table;
  // A schema- or catalog-qualified name cannot be a CTE reference, matching how
  // `collectAstFacts` decides which base tables count as physical sources.
  const bare =
    (stringValue(from["schema_name"]) ?? "") === "" &&
    (stringValue(from["catalog_name"]) ?? "") === "";
  const cte = bare ? scope.ctes.get(table) : undefined;
  if (cte !== undefined) {
    scope.relations.push({
      name,
      relation: { kind: "derived", definition: cte },
    });
    return;
  }
  // `FROM T1 AS t(a, b)` renames the lake's columns, so the names written in the
  // query no longer address the lake columns the domain table describes.
  const renamed = columnAliasList(from["column_name_alias"]).length > 0;
  const relation: Relation =
    !renamed && LAKE_SOURCE_NAMES.has(table)
      ? { kind: "lake" }
      : { kind: "derived", definition: { node: null, columnAliases: [] } };
  scope.relations.push({ name, relation });
}

function addRelations(
  fromValue: JsonValue | undefined,
  scope: DareSqlV3Scope,
): void {
  const from = objectValue(fromValue);
  if (from === null) return;
  const type = stringValue(from["type"]);
  if (type === "JOIN") {
    addRelations(from["left"], scope);
    addRelations(from["right"], scope);
    return;
  }
  if (type === "BASE_TABLE") {
    addBaseTable(from, scope);
    return;
  }
  if (type !== "SUBQUERY") return;
  const alias = lowerString(from["alias"]);
  scope.relations.push({
    name: alias ?? "",
    relation: {
      kind: "derived",
      definition: {
        node: objectValue(objectValue(from["subquery"])?.["node"]),
        columnAliases: columnAliasList(from["column_name_alias"]),
      },
    },
  });
}

/** The relations a SELECT node's expressions may name, over its enclosing query. */
export function dareSqlV3QueryScope(
  node: AstObject,
  parent: DareSqlV3Scope | null,
): DareSqlV3Scope {
  const scope: DareSqlV3Scope = {
    relations: [],
    ctes: cteDefinitions(node, parent?.ctes ?? new Map()),
    parent,
  };
  addRelations(node["from_table"], scope);
  return scope;
}

function projectionOrigin(
  projection: JsonValue | undefined,
  scope: DareSqlV3Scope,
  visited: ReadonlySet<AstObject>,
): DareSqlV3ColumnOrigin {
  const expression = objectValue(projection);
  if (
    expression === null ||
    stringValue(expression["class"]) !== "COLUMN_REF"
  ) {
    return "derived";
  }
  // A projection that only forwards a column keeps that column's origin, which
  // is what lets `WITH g AS (SELECT team_position FROM T1) … g.team_position`
  // stay a lake column.
  return columnOrigin(scope, arrayValue(expression["column_names"]), visited);
}

function derivedOrigin(
  definition: RelationDefinition,
  scope: DareSqlV3Scope,
  column: string,
  visited: ReadonlySet<AstObject>,
): ColumnLookup {
  const node = definition.node;
  // A CTE naming itself parses even though it would never bind; refusing to
  // re-enter a body already on the path keeps this walk finite either way.
  if (
    node === null ||
    visited.has(node) ||
    stringValue(node["type"]) !== "SELECT_NODE"
  ) {
    return "unknown";
  }
  const inner = dareSqlV3QueryScope(node, scope);
  const nextVisited = new Set(visited).add(node);
  const selectList = arrayValue(node["select_list"]);
  if (definition.columnAliases.length > 0) {
    const index = definition.columnAliases.indexOf(column);
    return index === -1
      ? "absent"
      : projectionOrigin(selectList[index], inner, nextVisited);
  }
  const projection = selectList.find(
    (entry) => projectedName(entry) === column,
  );
  if (projection !== undefined) {
    return projectionOrigin(projection, inner, nextVisited);
  }
  const star = selectList.some(
    (entry) => stringValue(objectValue(entry)?.["class"]) === "STAR",
  );
  return star ? unqualifiedOrigin(inner, column, nextVisited) : "absent";
}

function qualifiedOrigin(
  scope: DareSqlV3Scope,
  qualifier: string,
  column: string,
  visited: ReadonlySet<AstObject>,
): DareSqlV3ColumnOrigin {
  let current: DareSqlV3Scope | null = scope;
  while (current !== null) {
    const entry = current.relations.find(
      (candidate) => candidate.name === qualifier,
    );
    if (entry !== undefined) {
      const origin =
        entry.relation.kind === "lake"
          ? "lake"
          : derivedOrigin(entry.relation.definition, current, column, visited);
      return origin === "absent" ? "unknown" : origin;
    }
    current = current.parent;
  }
  return "unknown";
}

function unqualifiedOrigin(
  scope: DareSqlV3Scope,
  column: string,
  visited: ReadonlySet<AstObject>,
): DareSqlV3ColumnOrigin {
  let current: DareSqlV3Scope | null = scope;
  while (current !== null) {
    // A derived relation answers first: it is the one that can rename a lake
    // column out of its domain, and the lake relations carry no such surprise.
    for (const entry of current.relations) {
      if (entry.relation.kind === "lake") continue;
      const origin = derivedOrigin(
        entry.relation.definition,
        current,
        column,
        visited,
      );
      if (origin !== "absent") return origin;
    }
    if (current.relations.some((entry) => entry.relation.kind === "lake")) {
      return "lake";
    }
    current = current.parent;
  }
  return "unknown";
}

function columnOrigin(
  scope: DareSqlV3Scope,
  columnNames: readonly JsonValue[],
  visited: ReadonlySet<AstObject>,
): DareSqlV3ColumnOrigin {
  const names = columnNames
    .map((part) => lowerString(part))
    .filter((part) => part !== null);
  const column = names.at(-1);
  // A part that is not a string means the AST said something this walk does not
  // model, and a partly-read name would resolve against the wrong relation.
  if (column === undefined || names.length !== columnNames.length) {
    return "unknown";
  }
  const qualifier = names.at(-2);
  return qualifier === undefined
    ? unqualifiedOrigin(scope, column, visited)
    : qualifiedOrigin(scope, qualifier, column, visited);
}

/**
 * Where a `COLUMN_REF`'s dotted name parts resolve, read from the AST alone.
 *
 * Qualified names resolve through the FROM aliases of this scope and every
 * enclosing one; unqualified names resolve against the derived relations in
 * scope first, because only a derived relation can publish a lake column name
 * that holds something else.
 */
export function dareSqlV3ColumnOrigin(
  scope: DareSqlV3Scope,
  columnNames: readonly JsonValue[],
): DareSqlV3ColumnOrigin {
  return columnOrigin(scope, columnNames, new Set());
}
