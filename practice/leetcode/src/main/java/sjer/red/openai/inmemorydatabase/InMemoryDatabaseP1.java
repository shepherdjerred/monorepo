package sjer.red.openai.inmemorydatabase;

import java.util.List;
import java.util.Map;

/**
 * PROBLEM: In-Memory Database / SQL
 * <p>
 * PART 1: Basic CRUD
 * - createTable(name, columns) — define a table with named columns
 * - insert(table, values) — insert a row (map of column->value)
 * - query(table) — return all rows
 * <p>
 * Example:
 * createTable("users", ["name", "age", "city"])
 * insert("users", {"name": "Alice", "age": "30", "city": "NYC"})
 * query("users") -> [{"name": "Alice", "age": "30", "city": "NYC"}]
 * <p>
 * TIME TARGET: ~10-15 minutes
 */
public class InMemoryDatabaseP1 {

    public InMemoryDatabaseP1() {
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
     * Query all rows from a table.
     */
    public List<Map<String, String>> query(String table) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
