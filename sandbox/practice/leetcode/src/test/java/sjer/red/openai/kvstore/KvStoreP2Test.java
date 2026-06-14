package sjer.red.openai.kvstore;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class KvStoreP2Test {
    private TestWal wal;
    private KvStoreP2 store;

    static class TestWal implements KvStoreP2.WriteAheadLog {
        private final List<String> entries = new ArrayList<>();

        @Override
        public void append(String entry) {
            entries.add(entry);
        }

        @Override
        public List<String> readAll() {
            return new ArrayList<>(entries);
        }

        @Override
        public void clear() {
            entries.clear();
        }
    }

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
        wal = new TestWal();
        store = new KvStoreP2(wal);
    }

    // P1 regression tests (A1-A3)

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
    void scenario_A3_delete_existing_returns_true() {
        store.put("key", "value1");
        assertTrue(store.delete("key"));
        assertNull(store.get("key"));
    }

    // P2 tests (B1-B7)

    @Test
    void scenario_B1_put_writes_to_wal_and_recovers() {
        store.put("foo", "bar");
        var store2 = new KvStoreP2(wal);
        assertTrue(v(store2.get("foo"), "fcde2b2e"));
    }

    @Test
    void scenario_B2_delete_writes_to_wal_and_recovers() {
        store.put("foo", "bar");
        store.delete("foo");
        var store2 = new KvStoreP2(wal);
        assertNull(store2.get("foo"));
    }

    @Test
    void scenario_B3_multiple_puts_same_key_recovery_gets_last() {
        store.put("key", "v1");
        store.put("key", "v2");
        store.put("key", "v3");
        var store2 = new KvStoreP2(wal);
        assertTrue(v(store2.get("key"), "e0d2747b"));
    }

    @Test
    void scenario_B4_put_then_delete_then_recover_key_absent() {
        store.put("key", "hello");
        store.delete("key");
        var store2 = new KvStoreP2(wal);
        assertNull(store2.get("key"));
    }

    @Test
    void scenario_B5_empty_wal_recovery_yields_empty_store() {
        var freshWal = new TestWal();
        var freshStore = new KvStoreP2(freshWal);
        assertNull(freshStore.get("anything"));
    }

    @Test
    void scenario_B6_interleaved_operations_full_recovery() {
        store.put("a", "v1");
        store.put("b", "v2");
        store.delete("a");
        store.put("c", "v3");
        store.put("b", "updated");
        var store2 = new KvStoreP2(wal);
        assertNull(store2.get("a"));
        assertTrue(v(store2.get("b"), "27eb5e51"));
        assertTrue(v(store2.get("c"), "e0d2747b"));
    }

    @Test
    void scenario_B7_recover_preserves_order_of_operations() {
        store.put("x", "first");
        store.delete("x");
        store.put("x", "second");
        var store2 = new KvStoreP2(wal);
        assertNotNull(store2.get("x"));
        // The recovered value should be "second", not "first"
        assertFalse(v(store2.get("x"), "a7ffc6f8")); // not empty/null hash
        var recovered = store2.get("x");
        // Verify it's the second value by checking it's not the first
        assertNotEquals("first", recovered);
    }
}
