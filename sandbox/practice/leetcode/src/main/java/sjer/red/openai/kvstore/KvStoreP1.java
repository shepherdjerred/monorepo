package sjer.red.openai.kvstore;

import java.util.HashMap;

/**
 * PROBLEM: In-Memory KV Store with Recovery
 * SOURCE: From Shuxin
 * <p>
 * PART 1: Basic Get/Put/Delete
 * - put(key, value) — store a key-value pair
 * - get(key) — return the value for the key, or null if not found
 * - delete(key) — remove the key and return true if it existed, false otherwise
 * <p>
 * Examples:
 * put("foo", "bar")
 * get("foo")    → "bar"
 * delete("foo") → true
 * get("foo")    → null
 * delete("foo") → false
 * <p>
 * TIME TARGET: ~10-15 minutes
 */
public class KvStoreP1 {

    HashMap<String, String> m = new HashMap<String, String>();

    /**
     * Store a key-value pair. Overwrites any existing value for the key.
     */
    public void put(String key, String value) {
        m.put(key, value);
    }

    /**
     * Return the value associated with the key, or null if not found.
     */
    public String get(String key) {
        return m.get(key);
    }

    /**
     * Remove the key from the store.
     *
     * @return true if the key existed, false otherwise
     */
    public boolean delete(String key) {
        var contains = m.containsKey(key);
        if (contains) {
            m.remove(key);
            return true;
        } else {
            return false;
        }
    }
}
