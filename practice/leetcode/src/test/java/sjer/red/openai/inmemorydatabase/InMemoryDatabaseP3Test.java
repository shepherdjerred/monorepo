package sjer.red.openai.inmemorydatabase;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertTrue;

class InMemoryDatabaseP3Test {
    private InMemoryDatabaseP3 db;

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
        db = new InMemoryDatabaseP3();
    }

    // --- Regression from Part 1 ---

    @Test
    void scenario_A1_create_and_query() {
        db.createTable("users", List.of("name", "age", "city"));
        db.insert("users", Map.of("name", "Alice", "age", "30", "city", "NYC"));
        db.insert("users", Map.of("name", "Bob", "age", "25", "city", "LA"));
        var results = db.query("users", new ArrayList<>(), new ArrayList<>());
assertTrue(2 == results.size());
        assertTrue(results.stream().anyMatch(r -> h(r.get("name")).startsWith("3bc5")));
        assertTrue(results.stream().anyMatch(r -> h(r.get("name")).startsWith("cd99")));
    }

    @Test
    void scenario_A2_empty_table() {
        db.createTable("items", List.of("sku", "price"));
assertTrue(0 == db.query("items", new ArrayList<>(), new ArrayList<>()).size());
    }

    @Test
    void scenario_A3_multiple_inserts() {
        db.createTable("t", List.of("x"));
        for (int i = 0; i < 100; i++) db.insert("t", Map.of("x", String.valueOf(i)));
assertTrue(100 == db.query("t", new ArrayList<>(), new ArrayList<>()).size());
    }

    // --- Regression from Part 2 ---

    @Test
    void scenario_B1_equality() {
        seedUsers();
        var results = db.query("users", w("name", "=", "Alice"), new ArrayList<>());
assertTrue(1 == results.size());
assertTrue("30".equals(results.get(0).get("age")));
    }

    @Test
    void scenario_B2_greater_than() {
        seedUsers();
        var results = db.query("users", w("age", ">", "27"), new ArrayList<>());
        // Alice=30, Charlie=35
assertTrue(2 == results.size());
    }

    @Test
    void scenario_B3_multiple_conditions() {
        seedUsers();
        List<String[]> where = new ArrayList<>();
        where.add(new String[]{"age", ">", "20"});
        where.add(new String[]{"city", "=", "NYC"});
        var results = db.query("users", where, new ArrayList<>());
        // Only Alice (30, NYC)
assertTrue(1 == results.size());
    }

    @Test
    void scenario_B4_not_equals() {
        seedUsers();
        var results = db.query("users", w("name", "!=", "Bob"), new ArrayList<>());
assertTrue(2 == results.size());
        assertTrue(results.stream().noneMatch(r -> "Bob".equals(r.get("name"))));
    }

    @Test
    void scenario_B5_less_than_or_equal() {
        seedUsers();
        var results = db.query("users", w("age", "<=", "30"), new ArrayList<>());
        // Bob=25, Alice=30
assertTrue(2 == results.size());
    }

    @Test
    void scenario_B6_no_matches() {
        seedUsers();
        var results = db.query("users", w("age", ">", "100"), new ArrayList<>());
assertTrue(0 == results.size());
    }

    // --- Part 3: ORDER BY ---

    @Test
    void scenario_C1_sort_ascending() {
        seedUsers();
        var results = db.query("users", new ArrayList<>(), o("age", "ASC"));
assertTrue(3 == results.size());
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
assertTrue("z".equals(results.get(0).get("label")));
assertTrue("x".equals(results.get(1).get("label")));
assertTrue("y".equals(results.get(2).get("label")));
assertTrue("w".equals(results.get(3).get("label")));
    }

    @Test
    void scenario_C4_where_plus_order() {
        seedUsers();
        var results = db.query("users", w("age", ">=", "25"), o("age", "DESC"));
assertTrue(3 == results.size());
        assertTrue(h(results.get(0).get("name")).startsWith("79c7")); // Charlie=35 first
    }

    @Test
    void scenario_C5_identical_sort_column_values() {
        db.createTable("t", List.of("group", "label"));
        db.insert("t", Map.of("group", "A", "label", "x"));
        db.insert("t", Map.of("group", "A", "label", "y"));
        db.insert("t", Map.of("group", "A", "label", "z"));
        var results = db.query("t", new ArrayList<>(), o("group", "ASC"));
assertTrue(3 == results.size());
    }

    @Test
    void scenario_C6_multi_column_mixed_direction() {
        db.createTable("data", List.of("group", "value", "label"));
        db.insert("data", Map.of("group", "A", "value", "2", "label", "a"));
        db.insert("data", Map.of("group", "A", "value", "1", "label", "b"));
        db.insert("data", Map.of("group", "B", "value", "2", "label", "c"));
        db.insert("data", Map.of("group", "B", "value", "1", "label", "d"));
        List<String[]> orderBy = new ArrayList<>();
        orderBy.add(new String[]{"group", "ASC"});
        orderBy.add(new String[]{"value", "DESC"});
        var results = db.query("data", new ArrayList<>(), orderBy);
        // A-2, A-1, B-2, B-1
assertTrue("a".equals(results.get(0).get("label")));
assertTrue("b".equals(results.get(1).get("label")));
assertTrue("c".equals(results.get(2).get("label")));
assertTrue("d".equals(results.get(3).get("label")));
    }

    @Test
    void scenario_C7_where_matches_zero_rows_with_order_by() {
        seedUsers();
        var results = db.query("users", w("age", ">", "100"), o("age", "ASC"));
assertTrue(0 == results.size());
    }

    @Test
    void scenario_C8_sort_1000_rows() {
        db.createTable("big", List.of("value"));
        for (int i = 999; i >= 0; i--) {
            db.insert("big", Map.of("value", String.format("%04d", i)));
        }
        var results = db.query("big", new ArrayList<>(), o("value", "ASC"));
assertTrue(1000 == results.size());
assertTrue("0000".equals(results.get(0).get("value")));
assertTrue("0999".equals(results.get(999).get("value")));
    }

    // --- Helpers ---

    private void seedUsers() {
        db.createTable("users", List.of("name", "age", "city"));
        db.insert("users", Map.of("name", "Alice", "age", "30", "city", "NYC"));
        db.insert("users", Map.of("name", "Bob", "age", "25", "city", "LA"));
        db.insert("users", Map.of("name", "Charlie", "age", "35", "city", "Chicago"));
    }
}
