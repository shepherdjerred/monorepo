package sjer.red.openai.kvserialize;

import java.util.Map;

/**
 * PROBLEM: KV Store Serialize/Deserialize
 * <p>
 * PART 1: Basic Serialize/Deserialize
 * - serialize(data) — convert a Map&lt;String, String&gt; into a single String
 * - deserialize(data) — convert a String back into a Map&lt;String, String&gt;
 * - Both keys and values may contain any characters (including delimiters, newlines, quotes, special chars)
 * - Must handle empty strings as keys or values
 * - Must handle empty maps
 * - Roundtrip invariant: deserialize(serialize(map)).equals(map) must always hold
 * <p>
 * Examples:
 * serialize({"name": "John:Doe", "city": "New,York"}) → some string S
 * deserialize(S) → {"name": "John:Doe", "city": "New,York"}
 * serialize({}) → ""
 * deserialize("") → {}
 * <p>
 * TIME TARGET: ~15-20 minutes
 */
public class KvSerializeP1 {

    /**
     * Serialize a map of string key-value pairs into a single string.
     * Must handle arbitrary characters in keys and values.
     *
     * @param data the map to serialize (may be empty, never null)
     * @return the serialized string representation
     */
    public String serialize(Map<String, String> data) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Deserialize a string back into a map of key-value pairs.
     * Must be the exact inverse of serialize.
     *
     * @param data the serialized string (may be empty, never null)
     * @return the deserialized map
     */
    public Map<String, String> deserialize(String data) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
