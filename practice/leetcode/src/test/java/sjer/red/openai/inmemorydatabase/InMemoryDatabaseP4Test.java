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

    // --- Regression from Part 1 ---

    private static List<String[]> o(String col, String dir) {
        List<String[]> list = new ArrayList<>();
        list.add(new String[]{col, dir});
        return list;
    }

    // --- Regression from Part 3 ---

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

    // --- Part 4: DELETE and UPDATE ---

    @BeforeEach
    void setUp() {
        db = new InMemoryDatabaseP4();
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

    // --- Helpers ---

    @Test
    void scenario_C1_sort_ascending() {
        seedUsers();
        var results = db.query("users", new ArrayList<>(), o("age", "ASC"));
        assertEquals(3, results.size());
        assertTrue(h(results.get(0).get("name")).startsWith("cd99")); // Bob, 25
        assertTrue(h(results.get(2).get("name")).startsWith("79c7")); // Charlie, 35
    }

    @Test
    void scenario_D1_delete() {
        seedUsers();
        int deleted = db.delete("users", w("name", "=", "Bob"));
        assertEquals(1, deleted);
        assertEquals(2, db.query("users").size());
    }

    @Test
    void scenario_D2_update() {
        seedUsers();
        int updated = db.update("users", w("name", "=", "Alice"), Map.of("city", "SF"));
        assertEquals(1, updated);
        var results = db.query("users", w("name", "=", "Alice"));
        assertTrue(h(results.get(0).get("city")).startsWith("ab56"));
    }

    private void seedUsers() {
        db.createTable("users", List.of("name", "age", "city"));
        db.insert("users", Map.of("name", "Alice", "age", "30", "city", "NYC"));
        db.insert("users", Map.of("name", "Bob", "age", "25", "city", "LA"));
        db.insert("users", Map.of("name", "Charlie", "age", "35", "city", "Chicago"));
    }
}
