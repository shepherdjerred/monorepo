package sjer.red.openai.kvstore;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;

/**
 * PROBLEM: In-Memory KV Store with Recovery
 * <p>
 * PART 2: Write-Ahead Log and Recovery
 * - Constructor takes a WriteAheadLog and replays all entries on initialization
 * - put/get/delete have the same signatures as Part 1
 * - Every put and delete must write to the WAL before applying
 * - WAL format: "PUT key value" for puts, "DELETE key" for deletes
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

    Map<String, String> m = new HashMap<>();
    WriteAheadLog wal;

    public KvStoreP2(WriteAheadLog wal) {
        this.wal = wal;
        for (String s : wal.readAll()) {
            System.out.printf("%s", s);
            // assumption: key/values cannot have spaces in them
            var split = s.split(" ");
            var cmd = split[0];
            if (cmd.equals("PUT")) {
                m.put(split[1], split[2]);
            } else if (cmd.equals("DELETE")) {
                m.remove(split[1]);
            } else {
                throw new IllegalStateException();
            }
        }
    }

    /**
     * Store a key-value pair. Write to WAL before applying.
     */
    public void put(String key, String value) {
        wal.append(String.format("PUT %s %s", key, value));
        m.put(key, value);
    }

    /**
     * Return the value associated with the key, or null if not found.
     */
    public String get(String key) {
        return m.getOrDefault(key, null);
    }

    /**
     * Remove the key from the store. Write to WAL before applying.
     *
     * @return true if the key existed, false otherwise
     */
    public boolean delete(String key) {
        var contains = m.containsKey(key);
        if (contains) {
            wal.append(String.format("DELETE %s", key));
            m.remove(key);
            return true;
        } else {
            return false;
        }
    }
}
