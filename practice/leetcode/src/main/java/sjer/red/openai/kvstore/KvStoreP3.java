package sjer.red.openai.kvstore;

/**
 * PROBLEM: In-Memory KV Store with Recovery
 * <p>
 * PART 3: Timestamped KV Store
 * - Constructor takes a Clock (provides current time as a long)
 * - set(key, value) — store a key-value pair at the current timestamp
 * - get(key) — return the latest value, or null if not found
 * - get(key, timestamp) — return the value at or before the given timestamp, or null
 * - delete(key) — remove the key and all its history; return true if it existed
 * <p>
 * Keys and values are strings. Timestamps are longs (milliseconds).
 * Multiple sets to the same key at different times create a version history.
 * <p>
 * Examples:
 * clock is at 100
 * set("foo", "bar")          // stored at t=100
 * clock advances to 200
 * set("foo", "baz")          // stored at t=200
 * get("foo")                 → "baz"
 * get("foo", 150)            → "bar"
 * get("foo", 100)            → "bar"
 * get("foo", 50)             → null
 * get("foo", 200)            → "baz"
 * get("foo", 999)            → "baz"
 * <p>
 * TIME TARGET: ~15-20 minutes (cumulative ~40-55 minutes)
 */
public class KvStoreP3 {

    public interface Clock {
        long now();
    }

    public KvStoreP3(Clock clock) {
        // TODO: initialize data structures
    }

    /**
     * Store a key-value pair at the current timestamp.
     */
    public void set(String key, String value) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Return the latest value for the key, or null if not found.
     */
    public String get(String key) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Return the value for the key at or before the given timestamp, or null if no
     * value exists at or before that time.
     */
    public String get(String key, long timestamp) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Remove the key and all its version history.
     *
     * @return true if the key existed, false otherwise
     */
    public boolean delete(String key) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
