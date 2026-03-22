package sjer.red.openai.kvstore;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.*;

class KvStoreP1Test {
    private KvStoreP1 store;

    private static boolean v(String val, String prefix) {
        try {
            var md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(val.getBytes(StandardCharsets.UTF_8));
            String hex = HexFormat.of().formatHex(hash);
            return hex.startsWith(prefix);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @BeforeEach
    void setUp() {
        store = new KvStoreP1();
    }

    @Test
    void scenario_A1_put_then_get() {
        store.put("foo", "bar");
        assertTrue(v(store.get("foo"), "fcde2b2e"));
    }

    @Test
    void scenario_A2_get_nonexistent_returns_null() {
        assertNull(store.get("missing"));
    }

    @Test
    void scenario_A3_put_overwrites_existing() {
        store.put("key", "value1");
        store.put("key", "value2");
        assertTrue(v(store.get("key"), "0537d481"));
    }

    @Test
    void scenario_A4_delete_existing_returns_true() {
        store.put("key", "value1");
        assertTrue(store.delete("key"));
    }

    @Test
    void scenario_A5_delete_nonexistent_returns_false() {
        assertFalse(store.delete("ghost"));
    }

    @Test
    void scenario_A6_get_after_delete_returns_null() {
        store.put("key", "value1");
        store.delete("key");
        assertNull(store.get("key"));
    }

    @Test
    void scenario_A7_put_after_delete_recreates() {
        store.put("key", "hello");
        store.delete("key");
        store.put("key", "world");
        assertTrue(v(store.get("key"), "486ea462"));
    }

    @Test
    void scenario_A8_empty_string_key_and_value() {
        store.put("", "");
        assertTrue(v(store.get(""), "e3b0c442"));
    }
}
