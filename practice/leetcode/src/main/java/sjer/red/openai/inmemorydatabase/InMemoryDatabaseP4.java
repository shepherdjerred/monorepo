package sjer.red.openai.inmemorydatabase;

import java.util.List;
import java.util.Map;

/**
 * PROBLEM: In-Memory Database / SQL
 * <p>
 * PART 4: DELETE and UPDATE
 * - createTable(name, columns) — define a table with named columns
 * - insert(table, values) — insert a row (map of column->value)
 * - query(table) — return all rows
 * - query(table, where) — return rows matching WHERE conditions
 * - query(table, where, orderBy) — return filtered rows sorted by ORDER BY
 * - delete(table, where) — delete rows matching WHERE, return count deleted
 * - update(table, where, updates) — update rows matching WHERE, return count updated
 * - WHERE supports: =, !=, <, >, <=, >= (AND-ed together)
 * - ORDER BY supports multi-column sorting with ASC/DESC
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~45-65)
 */
public class InMemoryDatabaseP4 {

    public InMemoryDatabaseP4() {
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
     * Delete rows matching WHERE conditions.
     *
     * @return number of rows deleted
     */
    public int delete(String table, List<String[]> where) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Update rows matching WHERE conditions.
     *
     * @param updates map of column -> new value
     * @return number of rows updated
     */
    public int update(String table, List<String[]> where, Map<String, String> updates) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
