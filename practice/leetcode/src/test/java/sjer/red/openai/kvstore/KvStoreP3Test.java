package sjer.red.openai.kvstore;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.*;

class KvStoreP3Test {
    private TestClock clock;
    private KvStoreP3 store;

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
        store = new KvStoreP3(clock);
    }

    // --- P1 regression (C1-C3) ---

    @Test
    void scenario_C1_set_then_get() {
        store.set("foo", "bar");
        assertTrue(v(store.get("foo"), "fcde2b2e"));
    }

    @Test
    void scenario_C2_get_nonexistent_returns_null() {
        assertNull(store.get("missing"));
    }

    @Test
    void scenario_C3_delete_existing_returns_true_then_null() {
        store.set("key", "value");
        assertTrue(store.delete("key"));
        assertNull(store.get("key"));
    }

    // --- Timestamp basics (C4-C8) ---

    @Test
    void scenario_C4_get_latest_returns_most_recent_value() {
        store.set("foo", "bar");
        clock.advance(100);
        store.set("foo", "baz");
        assertTrue(v(store.get("foo"), "baa5a096"));
    }

    @Test
    void scenario_C5_get_at_timestamp_between_two_sets() {
        store.set("foo", "bar");       // t=100
        clock.advance(100);
        store.set("foo", "baz");       // t=200
        assertTrue(v(store.get("foo", 150), "fcde2b2e"));
    }

    @Test
    void scenario_C6_get_at_timestamp_before_any_set_returns_null() {
        store.set("foo", "bar");       // t=100
        assertNull(store.get("foo", 50));
    }

    @Test
    void scenario_C7_get_at_exact_timestamp_of_set() {
        store.set("foo", "bar");       // t=100
        clock.advance(100);
        store.set("foo", "baz");       // t=200
        assertTrue(v(store.get("foo", 100), "fcde2b2e"));
        assertTrue(v(store.get("foo", 200), "baa5a096"));
    }

    @Test
    void scenario_C8_get_at_timestamp_after_all_sets_returns_latest() {
        store.set("foo", "bar");       // t=100
        clock.advance(100);
        store.set("foo", "baz");       // t=200
        assertTrue(v(store.get("foo", 999), "baa5a096"));
    }

    // --- Multiple keys (C9) ---

    @Test
    void scenario_C9_multiple_keys_interleaved_timestamps() {
        store.set("a", "alpha");           // t=100
        clock.advance(50);
        store.set("b", "beta");            // t=150
        clock.advance(50);
        store.set("a", "gamma");           // t=200

        assertTrue(v(store.get("a", 100), "8ed3f6ad"));
        assertTrue(v(store.get("a", 175), "8ed3f6ad"));
        assertTrue(v(store.get("a", 200), "be9d587d"));
        assertTrue(v(store.get("b", 125), "f44e64e7"));
        assertNull(store.get("b", 100));
    }

    // --- Delete behavior (C10-C11) ---

    @Test
    void scenario_C10_delete_removes_all_versions() {
        store.set("key", "v1");        // t=100
        clock.advance(100);
        store.set("key", "v2");        // t=200
        store.delete("key");
        assertNull(store.get("key"));
        assertNull(store.get("key", 100));
        assertNull(store.get("key", 200));
        assertNull(store.get("key", 999));
    }

    @Test
    void scenario_C11_set_after_delete_creates_fresh_history() {
        store.set("key", "v1");        // t=100
        store.delete("key");
        clock.advance(100);
        store.set("key", "fresh");     // t=200
        assertTrue(v(store.get("key"), "d098ab5e"));
        assertNull(store.get("key", 100));
        assertTrue(v(store.get("key", 200), "d098ab5e"));
    }

    // --- Many versions (C12) ---

    @Test
    void scenario_C12_many_versions_correct_at_each_timestamp() {
        store.set("key", "v1");        // t=100
        clock.advance(100);
        store.set("key", "v2");        // t=200
        clock.advance(100);
        store.set("key", "v3");        // t=300

        assertNull(store.get("key", 50));
        assertTrue(v(store.get("key", 100), "3bfc2695"));
        assertTrue(v(store.get("key", 150), "3bfc2695"));
        assertTrue(v(store.get("key", 200), "fb04dcb6"));
        assertTrue(v(store.get("key", 250), "fb04dcb6"));
        assertTrue(v(store.get("key", 300), "e0d2747b"));
        assertTrue(v(store.get("key", 999), "e0d2747b"));
    }

    // --- Future timestamp (C13) ---

    @Test
    void scenario_C13_get_at_future_timestamp_resolves_after_later_set() {
        store.set("key", "v1");            // t=100
        // Query at timestamp 300 — only v1 at t=100 exists
        assertTrue(v(store.get("key", 300), "3bfc2695"));

        // Now advance clock and add a value at t=200
        clock.advance(100);
        store.set("key", "v2");            // t=200

        // Same query at timestamp 300 should now return v2 (latest at or before 300)
        assertTrue(v(store.get("key", 300), "fb04dcb6"));
    }

    // --- Edge cases (C14-C16) ---

    @Test
    void scenario_C14_delete_nonexistent_returns_false() {
        assertFalse(store.delete("ghost"));
    }

    @Test
    void scenario_C15_get_at_timestamp_for_nonexistent_key_returns_null() {
        assertNull(store.get("nope", 100));
    }

    @Test
    void scenario_C16_empty_string_key_and_value() {
        store.set("", "");
        assertTrue(v(store.get(""), "e3b0c442"));
        assertTrue(v(store.get("", 100), "e3b0c442"));
    }

    @Test
    void scenario_C17_get_at_timestamp_nonexistent_key_returns_null() {
        store.set("a", "alpha");
        assertNull(store.get("b", 100));
    }

    @Test
    void scenario_C18_overwrite_at_same_timestamp() {
        store.set("key", "v1");        // t=100
        store.set("key", "v2");        // t=100 (same timestamp)
        // Latest should be v2
        assertTrue(v(store.get("key"), "fb04dcb6"));
        assertTrue(v(store.get("key", 100), "fb04dcb6"));
    }
}
