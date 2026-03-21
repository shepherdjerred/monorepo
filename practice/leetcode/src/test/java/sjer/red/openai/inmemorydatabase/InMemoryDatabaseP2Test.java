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

    // --- Regression from Part 1 ---

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

    // --- Part 2: WHERE filtering ---

    @BeforeEach
    void setUp() {
        db = new InMemoryDatabaseP2();
    }

    @Test
    void scenario_A1_create_and_query() {
        db.createTable("users", List.of("name", "age", "city"));
        db.insert("users", Map.of("name", "Alice", "age", "30", "city", "NYC"));
        db.insert("users", Map.of("name", "Bob", "age", "25", "city", "LA"));
        var results = db.query("users");
        assertEquals(2, results.size());
        assertTrue(results.stream().anyMatch(r -> h(r.get("name")).startsWith("3bc5")));
        assertTrue(results.stream().anyMatch(r -> h(r.get("name")).startsWith("cd99")));
    }

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

    // --- Helpers ---

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

    private void seedUsers() {
        db.createTable("users", List.of("name", "age", "city"));
        db.insert("users", Map.of("name", "Alice", "age", "30", "city", "NYC"));
        db.insert("users", Map.of("name", "Bob", "age", "25", "city", "LA"));
        db.insert("users", Map.of("name", "Charlie", "age", "35", "city", "Chicago"));
    }
}
