package sjer.red.openai.kvserialize;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class KvSerializeP1Test {
    private KvSerializeP1 kvs;

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
        kvs = new KvSerializeP1();
    }

    // --- Basic roundtrips ---

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

    // --- Delimiter-busting characters ---

    @Test
    void scenario_A3_colons_in_key() {
        var input = Map.of("key:with:colons", "val");
        assertTrue(v(kvs.serialize(input), "24494054"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A4_commas_in_key() {
        var input = Map.of("a,b", "c");
        assertTrue(v(kvs.serialize(input), "d9ae9a06"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A5_equals_in_key() {
        var input = Map.of("ke=y", "val");
        assertTrue(v(kvs.serialize(input), "6c1be11c"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A6_pipes_in_value() {
        var input = Map.of("key", "va|ue");
        assertTrue(v(kvs.serialize(input), "3525dbde"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A7_newlines_in_value() {
        var input = Map.of("hello", "wo\nrld");
        assertTrue(v(kvs.serialize(input), "c5414574"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    // --- Empty strings ---

    @Test
    void scenario_A8_empty_string_key() {
        var input = Map.of("", "value");
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A9_empty_string_value() {
        var input = Map.of("key", "");
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A10_empty_map() {
        var input = Map.<String, String>of();
        assertTrue(v(kvs.serialize(input), "e3b0c442"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    // --- Unicode ---

    @Test
    void scenario_A11_unicode_and_emoji() {
        var input = Map.of("emoji", "\uD83D\uDE00", "nihao", "\u4F60\u597D");
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    // --- Scale ---

    @Test
    void scenario_A12_large_values() {
        var bigVal = "x".repeat(1000);
        var input = Map.of("big", bigVal);
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    // --- Adversarial structure ---

    @Test
    void scenario_A13_key_with_digits_and_colons() {
        // Key "3:abc" could confuse a naive length-prefix parser
        var input = Map.of("3:abc", "val");
        assertTrue(v(kvs.serialize(input), "a1c33e0d"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A14_value_looks_like_serialized_data() {
        // Value that mimics serialized format
        var input = Map.of("key", "1:a1:b1:c");
        assertTrue(v(kvs.serialize(input), "75719353"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A15_many_pairs() {
        var input = new HashMap<String, String>();
        for (int i = 0; i < 20; i++) {
            input.put("key" + i, "value" + i);
        }
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }

    @Test
    void scenario_A16_single_char_keys_and_values() {
        var input = Map.of("a", "b");
        assertTrue(v(kvs.serialize(input), "facdde7a"));
        assertEquals(input, kvs.deserialize(kvs.serialize(input)));
    }
}
