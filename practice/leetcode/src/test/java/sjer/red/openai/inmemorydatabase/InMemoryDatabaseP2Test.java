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

class InMemoryDatabaseP2Test {
    private InMemoryDatabaseP2 db;

    private static List<String[]> w(String col, String op, String val) {
        List<String[]> list = new ArrayList<>();
        list.add(new String[]{col, op, val});
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
        db = new InMemoryDatabaseP2();
    }

    // --- Regression from Part 1 ---

    @Test
    void scenario_A1_create_and_query() {
        db.createTable("users", List.of("name", "age", "city"));
        db.insert("users", Map.of("name", "Alice", "age", "30", "city", "NYC"));
        db.insert("users", Map.of("name", "Bob", "age", "25", "city", "LA"));
        var results = db.query("users", new ArrayList<>());
        assertEquals(2, results.size());
        assertTrue(results.stream().anyMatch(r -> h(r.get("name")).startsWith("3bc5")));
        assertTrue(results.stream().anyMatch(r -> h(r.get("name")).startsWith("cd99")));
    }

    @Test
    void scenario_A2_empty_table() {
        db.createTable("items", List.of("sku", "price"));
        assertEquals(0, db.query("items", new ArrayList<>()).size());
    }

    @Test
    void scenario_A3_multiple_inserts() {
        db.createTable("t", List.of("x"));
        for (int i = 0; i < 100; i++) db.insert("t", Map.of("x", String.valueOf(i)));
        assertEquals(100, db.query("t", new ArrayList<>()).size());
    }

    // --- Part 2: WHERE filtering ---

    @Test
    void scenario_B1_equality() {
        seedUsers();
        var results = db.query("users", w("name", "=", "Alice"));
        assertEquals(1, results.size());
        assertEquals("30", results.get(0).get("age"));
    }

    @Test
    void scenario_B2_greater_than() {
        seedUsers();
        var results = db.query("users", w("age", ">", "27"));
        // Alice=30, Charlie=35
        assertEquals(2, results.size());
    }

    @Test
    void scenario_B3_multiple_conditions() {
        seedUsers();
        List<String[]> where = new ArrayList<>();
        where.add(new String[]{"age", ">", "20"});
        where.add(new String[]{"city", "=", "NYC"});
        var results = db.query("users", where);
        // Only Alice (30, NYC)
        assertEquals(1, results.size());
    }

    @Test
    void scenario_B4_not_equals() {
        seedUsers();
        var results = db.query("users", w("name", "!=", "Bob"));
        assertEquals(2, results.size());
        assertTrue(results.stream().noneMatch(r -> "Bob".equals(r.get("name"))));
    }

    @Test
    void scenario_B5_less_than_or_equal() {
        seedUsers();
        var results = db.query("users", w("age", "<=", "30"));
        // Bob=25, Alice=30
        assertEquals(2, results.size());
    }

    @Test
    void scenario_B6_no_matches() {
        seedUsers();
        var results = db.query("users", w("age", ">", "100"));
        assertEquals(0, results.size());
    }

    @Test
    void scenario_B7_off_by_one_boundary() {
        seedUsers();
        var results1 = db.query("users", w("age", ">", "30"));
        // Only Charlie=35 is > 30
        assertEquals(1, results1.size());
        var results2 = db.query("users", w("age", ">=", "30"));
        // Alice=30 and Charlie=35
        assertEquals(2, results2.size());
    }

    @Test
    void scenario_B8_numeric_string_comparison() {
        db.createTable("t", List.of("value"));
        db.insert("t", Map.of("value", "9"));
        db.insert("t", Map.of("value", "10"));
        var results = db.query("t", w("value", ">", "5"));
        // String comparison: "9" > "5" yes, "10" > "5" no (lexicographic "1" < "5")
        // Numeric comparison: both pass
        // This test documents the behavior: either 1 (string) or 2 (numeric)
        assertTrue(results.size() == 1 || results.size() == 2);
    }

    @Test
    void scenario_B9_empty_where_returns_all() {
        seedUsers();
        var results = db.query("users", new ArrayList<>());
        assertEquals(3, results.size());
    }

    @Test
    void scenario_B10_less_than_operator() {
        seedUsers();
        var results = db.query("users", w("age", "<", "30"));
        // Bob=25
        assertEquals(1, results.size());
    }

    @Test
    void scenario_B11_greater_than_or_equal_operator() {
        seedUsers();
        var results = db.query("users", w("age", ">=", "30"));
        // Alice=30, Charlie=35
        assertEquals(2, results.size());
    }

    @Test
    void scenario_B12_contradictory_conditions() {
        seedUsers();
        List<String[]> where = new ArrayList<>();
        where.add(new String[]{"age", ">", "30"});
        where.add(new String[]{"age", "<", "20"});
        var results = db.query("users", where);
        assertEquals(0, results.size());
    }

    // --- Helpers ---

    private void seedUsers() {
        db.createTable("users", List.of("name", "age", "city"));
        db.insert("users", Map.of("name", "Alice", "age", "30", "city", "NYC"));
        db.insert("users", Map.of("name", "Bob", "age", "25", "city", "LA"));
        db.insert("users", Map.of("name", "Charlie", "age", "35", "city", "Chicago"));
    }
}
