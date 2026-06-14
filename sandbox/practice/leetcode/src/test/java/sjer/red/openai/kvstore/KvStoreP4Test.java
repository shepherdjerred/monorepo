package sjer.red.openai.kvstore;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.*;

class KvStoreP4Test {
    private TestClock clock;
    private KvStoreP4 store;

    @TempDir
    Path tempDir;

    static class TestClock implements KvStoreP3.Clock {
        private long time;

        TestClock(long initial) {
            this.time = initial;
        }

        void advance(long delta) {
            this.time += delta;
        }

        void setTime(long time) {
            this.time = time;
        }

        @Override
        public long now() {
            return time;
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
        clock = new TestClock(100);
        store = new KvStoreP4(clock);
    }

    // --- P3 regression (D1-D2) ---

    @Test
    void scenario_D1_set_then_get_with_timestamp() {
        store.set("foo", "bar");       // t=100
        clock.advance(100);
        store.set("foo", "baz");       // t=200
        assertTrue(v(store.get("foo"), "baa5a096"));
        assertTrue(v(store.get("foo", 150), "fcde2b2e"));
    }

    @Test
    void scenario_D2_delete_clears_all_versions() {
        store.set("key", "v1");
        clock.advance(100);
        store.set("key", "v2");
        store.delete("key");
        assertNull(store.get("key"));
        assertNull(store.get("key", 100));
    }

    // --- Save/Load round-trip (D3-D4) ---

    @Test
    void scenario_D3_save_then_load_single_key() throws IOException {
        store.set("foo", "bar");
        Path file = tempDir.resolve("store.dat");
        store.save(file);

        var loaded = KvStoreP4.load(file, new TestClock(500));
        assertTrue(v(loaded.get("foo"), "fcde2b2e"));
    }

    @Test
    void scenario_D4_save_then_load_multiple_keys() throws IOException {
        store.set("a", "alpha");
        clock.advance(50);
        store.set("b", "beta");
        clock.advance(50);
        store.set("c", "gamma");
        Path file = tempDir.resolve("store.dat");
        store.save(file);

        var loaded = KvStoreP4.load(file, new TestClock(500));
        assertTrue(v(loaded.get("a"), "8ed3f6ad"));
        assertTrue(v(loaded.get("b"), "f44e64e7"));
        assertTrue(v(loaded.get("c"), "be9d587d"));
    }

    // --- Special characters (D5-D8) ---

    @Test
    void scenario_D5_values_containing_newlines() throws IOException {
        store.set("key", "line1\nline2");
        Path file = tempDir.resolve("store.dat");
        store.save(file);

        var loaded = KvStoreP4.load(file, new TestClock(500));
        assertTrue(v(loaded.get("key"), "683376e2"));
    }

    @Test
    void scenario_D6_keys_containing_delimiter_characters() throws IOException {
        store.set("key:with=delims,here", "value");
        Path file = tempDir.resolve("store.dat");
        store.save(file);

        var loaded = KvStoreP4.load(file, new TestClock(500));
        assertNotNull(loaded.get("key:with=delims,here"));
    }

    @Test
    void scenario_D7_empty_string_key_and_value_round_trip() throws IOException {
        store.set("", "");
        Path file = tempDir.resolve("store.dat");
        store.save(file);

        var loaded = KvStoreP4.load(file, new TestClock(500));
        assertTrue(v(loaded.get(""), "e3b0c442"));
    }

    @Test
    void scenario_D8_value_containing_serialization_delimiters() throws IOException {
        // Values that might break naive line-based or delimiter-based serialization
        store.set("k1", "val\nwith\nnewlines\n");
        store.set("k2", "val\twith\ttabs");
        store.set("k3", "val:with:colons=and=equals");
        store.set("k4", "val\0with\0nulls");
        Path file = tempDir.resolve("store.dat");
        store.save(file);

        var loaded = KvStoreP4.load(file, new TestClock(500));
        assertEquals("val\nwith\nnewlines\n", loaded.get("k1"));
        assertEquals("val\twith\ttabs", loaded.get("k2"));
        assertEquals("val:with:colons=and=equals", loaded.get("k3"));
        assertEquals("val\0with\0nulls", loaded.get("k4"));
    }

    // --- Larger data (D9) ---

    @Test
    void scenario_D9_many_entries_round_trip() throws IOException {
        for (int i = 0; i < 1000; i++) {
            clock.setTime(i);
            store.set("key" + i, "value" + i);
        }
        Path file = tempDir.resolve("store.dat");
        store.save(file);

        var loaded = KvStoreP4.load(file, new TestClock(5000));
        for (int i = 0; i < 1000; i++) {
            assertNotNull(loaded.get("key" + i), "key" + i + " should exist");
        }
    }

    // --- Error handling (D10) ---

    @Test
    void scenario_D10_load_nonexistent_file_throws() {
        Path missing = tempDir.resolve("no_such_file.dat");
        assertThrows(IOException.class, () -> KvStoreP4.load(missing, clock));
    }

    // --- Version history preservation (D11-D12) ---

    @Test
    void scenario_D11_versioned_data_survives_round_trip() throws IOException {
        store.set("key", "v1");        // t=100
        clock.advance(100);
        store.set("key", "v2");        // t=200
        clock.advance(100);
        store.set("key", "v3");        // t=300
        Path file = tempDir.resolve("store.dat");
        store.save(file);

        var loaded = KvStoreP4.load(file, new TestClock(500));
        assertTrue(v(loaded.get("key", 100), "3bfc2695"));
        assertTrue(v(loaded.get("key", 200), "fb04dcb6"));
        assertTrue(v(loaded.get("key", 300), "e0d2747b"));
        assertTrue(v(loaded.get("key"), "e0d2747b"));
    }

    @Test
    void scenario_D12_loaded_store_supports_new_writes() throws IOException {
        store.set("foo", "bar");       // t=100
        Path file = tempDir.resolve("store.dat");
        store.save(file);

        var loadClock = new TestClock(500);
        var loaded = KvStoreP4.load(file, loadClock);
        loaded.set("foo", "new_value");    // t=500
        assertTrue(v(loaded.get("foo"), "3209852d"));
        assertTrue(v(loaded.get("foo", 100), "fcde2b2e"));
        assertTrue(v(loaded.get("foo", 500), "3209852d"));
    }

    @Test
    void scenario_D13_keys_with_newlines() throws IOException {
        store.set("key\nwith\nnewlines", "value");
        Path file = tempDir.resolve("store.dat");
        store.save(file);

        var loaded = KvStoreP4.load(file, new TestClock(500));
        assertNotNull(loaded.get("key\nwith\nnewlines"));
    }
}
