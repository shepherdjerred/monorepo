package sjer.red.openai.inmemorydatabase;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InMemoryDatabaseP4Test {
    private InMemoryDatabaseP4 db;

    private static List<String[]> w(String col, String op, String val) {
        List<String[]> list = new ArrayList<>();
        list.add(new String[]{col, op, val});
        return list;
    }

    private static List<String[]> o(String col, String dir) {
        List<String[]> list = new ArrayList<>();
        list.add(new String[]{col, dir});
        return list;
    }

    private static String h(String val) {
        try {
            var md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(val.getBytes(StandardCharsets.UTF_8));
            var sb = new StringBuilder();
            for (int i = 0; i < 4; i++) sb.append(String.format("%02x", hash[i]));
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @BeforeEach
    void setUp() {
        db = new InMemoryDatabaseP4();
    }

    // --- Regression from Part 1 ---

    @Test
    void scenario_A1_create_and_query() {
        db.createTable("users", List.of("name", "age", "city"));
        db.insert("users", Map.of("name", "Alice", "age", "30", "city", "NYC"));
        db.insert("users", Map.of("name", "Bob", "age", "25", "city", "LA"));
        var results = db.query("users", new ArrayList<>(), new ArrayList<>());
        assertEquals(2, results.size());
        assertTrue(results.stream().anyMatch(r -> h(r.get("name")).startsWith("3bc5")));
        assertTrue(results.stream().anyMatch(r -> h(r.get("name")).startsWith("cd99")));
    }

    @Test
    void scenario_A2_empty_table() {
        db.createTable("items", List.of("sku", "price"));
        assertEquals(0, db.query("items", new ArrayList<>(), new ArrayList<>()).size());
    }

    @Test
    void scenario_A3_multiple_inserts() {
        db.createTable("t", List.of("x"));
        for (int i = 0; i < 100; i++) db.insert("t", Map.of("x", String.valueOf(i)));
        assertEquals(100, db.query("t", new ArrayList<>(), new ArrayList<>()).size());
    }

    // --- Regression from Part 2 ---

    @Test
    void scenario_B1_equality() {
        seedUsers();
        var results = db.query("users", w("name", "=", "Alice"), new ArrayList<>());
        assertEquals(1, results.size());
        assertEquals("30", results.get(0).get("age"));
    }

    @Test
    void scenario_B2_greater_than() {
        seedUsers();
        var results = db.query("users", w("age", ">", "27"), new ArrayList<>());
        // Alice=30, Charlie=35
        assertEquals(2, results.size());
    }

    @Test
    void scenario_B3_multiple_conditions() {
        seedUsers();
        List<String[]> where = new ArrayList<>();
        where.add(new String[]{"age", ">", "20"});
        where.add(new String[]{"city", "=", "NYC"});
        var results = db.query("users", where, new ArrayList<>());
        // Only Alice (30, NYC)
        assertEquals(1, results.size());
    }

    @Test
    void scenario_B4_not_equals() {
        seedUsers();
        var results = db.query("users", w("name", "!=", "Bob"), new ArrayList<>());
        assertEquals(2, results.size());
        assertTrue(results.stream().noneMatch(r -> "Bob".equals(r.get("name"))));
    }

    @Test
    void scenario_B5_less_than_or_equal() {
        seedUsers();
        var results = db.query("users", w("age", "<=", "30"), new ArrayList<>());
        // Bob=25, Alice=30
        assertEquals(2, results.size());
    }

    @Test
    void scenario_B6_no_matches() {
        seedUsers();
        var results = db.query("users", w("age", ">", "100"), new ArrayList<>());
        assertEquals(0, results.size());
    }

    // --- Regression from Part 3 ---

    @Test
    void scenario_C1_sort_ascending() {
        seedUsers();
        var results = db.query("users", new ArrayList<>(), o("age", "ASC"));
        assertEquals(3, results.size());
        assertTrue(h(results.get(0).get("name")).startsWith("cd99")); // Bob, 25
        assertTrue(h(results.get(2).get("name")).startsWith("79c7")); // Charlie, 35
    }

    @Test
    void scenario_C2_sort_descending() {
        seedUsers();
        var results = db.query("users", new ArrayList<>(), o("age", "DESC"));
        assertTrue(h(results.get(0).get("name")).startsWith("79c7")); // Charlie first
    }

    @Test
    void scenario_C3_multi_column_sort() {
        db.createTable("data", List.of("group", "value", "label"));
        db.insert("data", Map.of("group", "A", "value", "2", "label", "x"));
        db.insert("data", Map.of("group", "B", "value", "1", "label", "y"));
        db.insert("data", Map.of("group", "A", "value", "1", "label", "z"));
        db.insert("data", Map.of("group", "B", "value", "2", "label", "w"));
        List<String[]> orderBy = new ArrayList<>();
        orderBy.add(new String[]{"group", "ASC"});
        orderBy.add(new String[]{"value", "ASC"});
        var results = db.query("data", new ArrayList<>(), orderBy);
        // A-1, A-2, B-1, B-2
        assertEquals("z", results.get(0).get("label"));
        assertEquals("x", results.get(1).get("label"));
        assertEquals("y", results.get(2).get("label"));
        assertEquals("w", results.get(3).get("label"));
    }

    @Test
    void scenario_C4_where_plus_order() {
        seedUsers();
        var results = db.query("users", w("age", ">=", "25"), o("age", "DESC"));
        assertEquals(3, results.size());
        assertTrue(h(results.get(0).get("name")).startsWith("79c7")); // Charlie=35 first
    }

    // --- Part 4: DELETE and UPDATE ---

    @Test
    void scenario_D1_delete() {
        seedUsers();
        int deleted = db.delete("users", w("name", "=", "Bob"));
        assertEquals(1, deleted);
        assertEquals(2, db.query("users", new ArrayList<>(), new ArrayList<>()).size());
    }

    @Test
    void scenario_D2_update() {
        seedUsers();
        int updated = db.update("users", w("name", "=", "Alice"), Map.of("city", "SF"));
        assertEquals(1, updated);
        var results = db.query("users", w("name", "=", "Alice"), new ArrayList<>());
        assertTrue(h(results.get(0).get("city")).startsWith("ab56"));
    }

    @Test
    void scenario_D3_delete_all_rows() {
        seedUsers();
        int deleted = db.delete("users", new ArrayList<>());
        assertEquals(3, deleted);
        assertEquals(0, db.query("users", new ArrayList<>(), new ArrayList<>()).size());
    }

    @Test
    void scenario_D4_delete_from_empty_table() {
        db.createTable("empty", List.of("x"));
        int deleted = db.delete("empty", w("x", "=", "anything"));
        assertEquals(0, deleted);
    }

    @Test
    void scenario_D5_delete_count() {
        db.createTable("t", List.of("val"));
        for (int i = 0; i < 5; i++) db.insert("t", Map.of("val", String.valueOf(i)));
        int deleted = db.delete("t", w("val", "<", "2"));
        assertEquals(2, deleted);
        assertEquals(3, db.query("t", new ArrayList<>(), new ArrayList<>()).size());
    }

    @Test
    void scenario_D6_update_where_matches_nothing() {
        seedUsers();
        int updated = db.update("users", w("name", "=", "Nobody"), Map.of("city", "Mars"));
        assertEquals(0, updated);
    }

    @Test
    void scenario_D7_update_all_rows() {
        seedUsers();
        int updated = db.update("users", new ArrayList<>(), Map.of("city", "SF"));
        assertEquals(3, updated);
        var results = db.query("users", new ArrayList<>(), new ArrayList<>());
        assertTrue(results.stream().allMatch(r -> "SF".equals(r.get("city"))));
    }

    @Test
    void scenario_D8_insert_after_delete() {
        seedUsers();
        db.delete("users", new ArrayList<>());
        assertEquals(0, db.query("users", new ArrayList<>(), new ArrayList<>()).size());
        db.insert("users", Map.of("name", "Dave", "age", "40", "city", "Boston"));
        assertEquals(1, db.query("users", new ArrayList<>(), new ArrayList<>()).size());
    }

    @Test
    void scenario_D9_chained_operations() {
        db.createTable("t", List.of("key", "val"));
        db.insert("t", Map.of("key", "a", "val", "1"));
        db.insert("t", Map.of("key", "b", "val", "2"));
        assertEquals(2, db.query("t", new ArrayList<>(), new ArrayList<>()).size());
        db.update("t", w("key", "=", "a"), Map.of("val", "10"));
        var results = db.query("t", w("key", "=", "a"), new ArrayList<>());
        assertEquals("10", results.get(0).get("val"));
        db.delete("t", w("key", "=", "b"));
        assertEquals(1, db.query("t", new ArrayList<>(), new ArrayList<>()).size());
    }

    @Test
    void scenario_D10_delete_some_then_update_remaining() {
        seedUsers();
        db.delete("users", w("name", "=", "Bob"));
        assertEquals(2, db.query("users", new ArrayList<>(), new ArrayList<>()).size());
        int updated = db.update("users", new ArrayList<>(), Map.of("city", "SF"));
        assertEquals(2, updated);
        var results = db.query("users", new ArrayList<>(), new ArrayList<>());
        assertTrue(results.stream().allMatch(r -> "SF".equals(r.get("city"))));
    }

    @Test
    void scenario_D11_update_column_used_in_where() {
        seedUsers();
        // Alice=30, Charlie=35 match age > "25"
        // Update their age to "20"
        int updated = db.update("users", w("age", ">", "29"), Map.of("age", "20"));
        assertEquals(2, updated);
        // Now only Bob=25 has age > "20" (as string comparison), Alice and Charlie are "20"
        var results = db.query("users", w("age", ">", "20"), new ArrayList<>());
        // Bob (25) should still match; Alice and Charlie now have "20" which is not > "20"
        assertEquals(1, results.size());
    }

    @Test
    void scenario_D12_multiple_sequential_deletes() {
        db.createTable("t", List.of("val"));
        for (int i = 0; i < 5; i++) db.insert("t", Map.of("val", String.valueOf(i)));
        int d1 = db.delete("t", w("val", "=", "0"));
        assertEquals(1, d1);
        assertEquals(4, db.query("t", new ArrayList<>(), new ArrayList<>()).size());
        int d2 = db.delete("t", w("val", "<", "3"));
        assertEquals(2, d2);
        assertEquals(2, db.query("t", new ArrayList<>(), new ArrayList<>()).size());
        int d3 = db.delete("t", new ArrayList<>());
        assertEquals(2, d3);
        assertEquals(0, db.query("t", new ArrayList<>(), new ArrayList<>()).size());
    }

    // --- Helpers ---

    private void seedUsers() {
        db.createTable("users", List.of("name", "age", "city"));
        db.insert("users", Map.of("name", "Alice", "age", "30", "city", "NYC"));
        db.insert("users", Map.of("name", "Bob", "age", "25", "city", "LA"));
        db.insert("users", Map.of("name", "Charlie", "age", "35", "city", "Chicago"));
    }
}
