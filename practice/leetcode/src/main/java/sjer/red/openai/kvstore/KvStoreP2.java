package sjer.red.openai.kvstore;

import java.util.List;

/**
 * PROBLEM: In-Memory KV Store with Recovery
 * <p>
 * PART 2: Write-Ahead Log and Recovery
 * - Constructor takes a WriteAheadLog and replays all entries on initialization
 * - put/get/delete have the same signatures as Part 1
 * - Every put and delete must write to the WAL before applying
 * - WAL format: "PUT key value" for puts, "DELETE key" for deletes
 * <p>
 * KEY INSIGHT: Write to WAL before applying. On construction, replay all entries.
 * <p>
 * Examples:
 * wal = new WriteAheadLog()
 * store1 = new KvStoreP2(wal)
 * store1.put("foo", "bar")       // WAL: ["PUT foo bar"]
 * store2 = new KvStoreP2(wal)    // replays WAL
 * store2.get("foo") → "bar"
 * <p>
 * TIME TARGET: ~15-20 minutes (cumulative ~25-35 minutes)
 */
public class KvStoreP2 {

    public interface WriteAheadLog {
        void append(String entry);
        List<String> readAll();
        void clear();
    }

    public KvStoreP2(WriteAheadLog wal) {
        // TODO: initialize data structures and replay WAL
    }

    /**
     * Store a key-value pair. Write to WAL before applying.
     */
    public void put(String key, String value) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Return the value associated with the key, or null if not found.
     */
    public String get(String key) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Remove the key from the store. Write to WAL before applying.
     *
     * @return true if the key existed, false otherwise
     */
    public boolean delete(String key) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
