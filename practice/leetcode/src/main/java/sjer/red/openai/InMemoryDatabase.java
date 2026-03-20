package sjer.red.openai;

import java.util.List;
import java.util.Map;

/**
 * PROBLEM: In-Memory Database / SQL
 *
 * Implement SQL-like operations on an in-memory database.
 *
 * PART 1:
 *   - createTable(name, columns) — define a table with named columns
 *   - insert(table, values) — insert a row (map of column→value)
 *   - query(table) — return all rows
 *
 * PART 2:
 *   - query with WHERE filtering
 *   - Support conditions: =, !=, <, >, <=, >=
 *   - Multiple WHERE conditions are AND-ed together
 *   - Values can be strings or integers (compare appropriately)
 *
 *   Example:
 *     query("users", where=[("age", ">", "25"), ("name", "!=", "Bob")])
 *
 * PART 3:
 *   - Add ORDER BY support (multi-column sorting)
 *   - ORDER BY takes a list of (column, direction) pairs
 *   - direction is "ASC" or "DESC"
 *   - Sort by first column, break ties with second, etc.
 *
 *   Example:
 *     query("users",
 *           where=[("age", ">", "20")],
 *           orderBy=[("age", "DESC"), ("name", "ASC")])
 *
 * PART 4:
 *   - Maintain backward compatibility as API evolves
 *   - Support DELETE with WHERE conditions
 *   - Support UPDATE with WHERE conditions
 *
 * TIME TARGET: 45-60 minutes for parts 1-3
 */
public class InMemoryDatabase {

    public InMemoryDatabase() {
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
     * @param values map of column name → value
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

    /**
     * Query with WHERE conditions.
     * Each condition is [column, operator, value] where operator is one of: =, !=, <, >, <=, >=
     * Multiple conditions are AND-ed.
     */
    public List<Map<String, String>> query(String table, List<String[]> where) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Query with WHERE conditions and ORDER BY.
     * Each orderBy entry is [column, direction] where direction is "ASC" or "DESC".
     */
    public List<Map<String, String>> query(String table, List<String[]> where, List<String[]> orderBy) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Part 4: Delete rows matching WHERE conditions.
     * @return number of rows deleted
     */
    public int delete(String table, List<String[]> where) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Part 4: Update rows matching WHERE conditions.
     * @param updates map of column → new value
     * @return number of rows updated
     */
    public int update(String table, List<String[]> where, Map<String, String> updates) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
