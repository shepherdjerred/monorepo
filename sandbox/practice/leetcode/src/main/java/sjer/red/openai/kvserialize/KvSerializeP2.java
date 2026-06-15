package sjer.red.openai.kvserialize;

import java.util.Map;

/**
 * PROBLEM: KV Store Serialize/Deserialize
 * <p>
 * PART 2: Chunked Serialization
 * - All Part 1 functionality (serialize/deserialize), plus:
 * - serializeChunked(data, store, chunkSize) — serialize the map, then split into
 *   fixed-size chunks and write them to a ChunkStore
 * - deserializeChunked(store) — read all chunks from the store, reassemble, and deserialize
 * - The last chunk may be smaller than chunkSize
 * - ChunkStore.count() returns the number of stored chunks
 * <p>
 * Examples:
 * serializeChunked({"name": "Alice"}, store, 10)
 *   → writes chunks of size ≤10 to store
 * deserializeChunked(store)
 *   → {"name": "Alice"}
 * <p>
 * TIME TARGET: ~15-20 minutes (cumulative ~30-40 minutes)
 */
public class KvSerializeP2 {

    /**
     * Interface for chunked storage.
     */
    public interface ChunkStore {
        /** Write a chunk at the given index. */
        void write(int index, String chunk);

        /** Read the chunk at the given index. */
        String read(int index);

        /** Return the number of chunks stored. */
        int count();
    }

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

    /**
     * Serialize the map and write it to the store in fixed-size chunks.
     * The last chunk may be smaller than chunkSize.
     *
     * @param data      the map to serialize
     * @param store     the chunk store to write to
     * @param chunkSize maximum number of characters per chunk
     */
    public void serializeChunked(Map<String, String> data, ChunkStore store, int chunkSize) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Read all chunks from the store, reassemble, and deserialize.
     *
     * @param store the chunk store to read from
     * @return the deserialized map
     */
    public Map<String, String> deserializeChunked(ChunkStore store) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
