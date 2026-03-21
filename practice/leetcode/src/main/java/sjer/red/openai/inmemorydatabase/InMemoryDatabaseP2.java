package sjer.red.openai.inmemorydatabase;

import java.util.List;
import java.util.Map;

/**
 * PROBLEM: In-Memory Database / SQL
 * <p>
 * PART 2: WHERE Filtering
 * - createTable(name, columns) — define a table with named columns
 * - insert(table, values) — insert a row (map of column->value)
 * - query(table, where) — return rows matching WHERE conditions (empty where = all rows)
 * - Support conditions: =, !=, <, >, <=, >=
 * - Multiple WHERE conditions are AND-ed together
 * - Values can be strings or integers (compare appropriately)
 * <p>
 * Example:
 * query("users", where=[("age", ">", "25"), ("name", "!=", "Bob")])
 * <p>
 * TIME TARGET: ~15-20 minutes (cumulative ~25-35)
 */
public class InMemoryDatabaseP2 {

    public InMemoryDatabaseP2() {
        // TODO: initialize
    }

    /**
     * Create a table with the given column names.
     */
    public void createTable(String name, List<String> columns) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Insert a row into a table.
     *
     * @param values map of column name -> value
     */
    public void insert(String table, Map<String, String> values) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Query with WHERE conditions.
     * Each condition is [column, operator, value] where operator is one of: =, !=, <, >, <=, >=
     * Multiple conditions are AND-ed.
     * Pass an empty list to return all rows.
     */
    public List<Map<String, String>> query(String table, List<String[]> where) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
