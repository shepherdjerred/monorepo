package sjer.red.openai.kvserialize;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class KvSerializeP2Test {
    private KvSerializeP2 kvs;

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

    /** Simple in-memory ChunkStore for testing. */
    static class InMemoryChunkStore implements KvSerializeP2.ChunkStore {
        private final List<String> chunks = new ArrayList<>();

        @Override
        public void write(int index, String chunk) {
            while (chunks.size() <= index) {
                chunks.add(null);
            }
            chunks.set(index, chunk);
        }

        @Override
        public String read(int index) {
            return chunks.get(index);
        }

        @Override
        public int count() {
            return chunks.size();
        }
    }

    @BeforeEach
    void setUp() {
        kvs = new KvSerializeP2();
    }

    // --- P1 regression tests (A-series) ---

    @Test
    void scenario_A1_single_pair_roundtrip() {
        var input = Map.of("hello", "world");
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A2_multiple_pairs_roundtrip() {
        var input = Map.of("a", "1", "b", "2", "c", "3");
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A3_colons_in_key() {
        var input = Map.of("key:with:colons", "val");
        assertTrue(v(kvs.serialize(input), "24494054"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A4_newlines_in_value() {
        var input = Map.of("hello", "wo\nrld");
        assertTrue(v(kvs.serialize(input), "c5414574"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A5_empty_string_key_and_value() {
        var input = Map.of("", "value");
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A6_empty_map() {
        var input = Map.<String, String>of();
        assertTrue(v(kvs.serialize(input), "e3b0c442"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A7_key_with_digits_and_colons() {
        var input = Map.of("3:abc", "val");
        assertTrue(v(kvs.serialize(input), "a1c33e0d"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A8_value_looks_like_serialized_data() {
        var input = Map.of("key", "1:a1:b1:c");
        assertTrue(v(kvs.serialize(input), "75719353"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    // --- P2 chunked tests (B-series) ---

    @Test
    void scenario_B1_basic_chunked_roundtrip() {
        var input = Map.of("hello", "world");
        var store = new InMemoryChunkStore();
        kvs.serializeChunked(input, store, 10);
        assertEquals(input, kvs.deserializeChunked(store));
    }

    @Test
    void scenario_B2_multiple_pairs_chunked() {
        var input = Map.of("a", "1", "b", "2", "c", "3");
        var store = new InMemoryChunkStore();
        kvs.serializeChunked(input, store, 8);
        assertEquals(input, kvs.deserializeChunked(store));
    }

    @Test
    void scenario_B3_data_smaller_than_one_chunk() {
        var input = Map.of("a", "b");
        var store = new InMemoryChunkStore();
        kvs.serializeChunked(input, store, 100);
        assertEquals(1, store.count());
        assertEquals(input, kvs.deserializeChunked(store));
    }

    @Test
    void scenario_B4_data_exactly_one_chunk() {
        // "1:a1:b" is 6 chars
        var input = Map.of("a", "b");
        var store = new InMemoryChunkStore();
        kvs.serializeChunked(input, store, 6);
        assertEquals(1, store.count());
        assertEquals(input, kvs.deserializeChunked(store));
    }

    @Test
    void scenario_B5_tiny_chunk_size_many_chunks() {
        var input = Map.of("hello", "world");
        var store = new InMemoryChunkStore();
        // "5:hello5:world" is 14 chars, chunk size 3 -> 5 chunks
        kvs.serializeChunked(input, store, 3);
        assertTrue(store.count() >= 4, "Expected many chunks with size 3, got " + store.count());
        assertEquals(input, kvs.deserializeChunked(store));
    }

    @Test
    void scenario_B6_empty_map_chunked() {
        var input = Map.<String, String>of();
        var store = new InMemoryChunkStore();
        kvs.serializeChunked(input, store, 10);
        assertEquals(input, kvs.deserializeChunked(store));
    }

    @Test
    void scenario_B7_chunk_splits_mid_encoded_data() {
        // Colons in key means chunk boundary can split in misleading places
        var input = Map.of("key:with:colons", "val");
        var store = new InMemoryChunkStore();
        kvs.serializeChunked(input, store, 7);
        assertTrue(store.count() >= 2);
        assertEquals(input, kvs.deserializeChunked(store));
    }

    @Test
    void scenario_B8_large_map_small_chunks() {
        var input = new HashMap<String, String>();
        for (int i = 0; i < 20; i++) {
            input.put("key" + i, "value" + i);
        }
        var store = new InMemoryChunkStore();
        kvs.serializeChunked(input, store, 5);
        assertTrue(store.count() >= 10, "Expected many chunks for large map");
        assertEquals(input, kvs.deserializeChunked(store));
    }
}
