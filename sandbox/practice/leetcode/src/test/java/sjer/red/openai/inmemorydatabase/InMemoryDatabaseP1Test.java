package sjer.red.openai.inmemorydatabase;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InMemoryDatabaseP1Test {
    private InMemoryDatabaseP1 db;

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
        db = new InMemoryDatabaseP1();
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
    void scenario_A2_empty_table() {
        db.createTable("items", List.of("sku", "price"));
        assertEquals(0, db.query("items").size());
    }

    @Test
    void scenario_A3_multiple_inserts() {
        db.createTable("t", List.of("x"));
        for (int i = 0; i < 100; i++) db.insert("t", Map.of("x", String.valueOf(i)));
        assertEquals(100, db.query("t").size());
    }

    @Test
    void scenario_A4_single_column_table() {
        db.createTable("single", List.of("val"));
        db.insert("single", Map.of("val", "hello"));
        var results = db.query("single");
        assertEquals(1, results.size());
        assertEquals("hello", results.get(0).get("val"));
    }

    @Test
    void scenario_A5_insert_with_empty_string() {
        db.createTable("t", List.of("name", "desc"));
        db.insert("t", Map.of("name", "item", "desc", ""));
        var results = db.query("t");
        assertEquals(1, results.size());
        assertTrue(h(results.get(0).get("desc")).startsWith("e3b0")); // SHA-256 of ""
    }
}
