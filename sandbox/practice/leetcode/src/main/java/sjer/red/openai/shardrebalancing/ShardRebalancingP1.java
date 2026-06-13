package sjer.red.openai.shardrebalancing;

/**
 * PROBLEM: Overlapping Key Range (Shard Rebalancing)
 * SOURCE: From Shuxin
 * <p>
 * PART 1: Add/Remove Shards, Count Overlaps
 * - addShard(shard) — add a shard with an id, start, and end range
 * - removeShard(shardId) — remove a shard by id; return true if it existed
 * - maxOverlap() — return the maximum number of shards overlapping at any point
 * - isValid() — return true if maxOverlap() <= the configured limit
 * <p>
 * Examples:
 * addShard(A:(0,100)), addShard(B:(80,180))
 * maxOverlap() → 2
 * isValid() with limit=1 → false
 * isValid() with limit=2 → true
 * <p>
 * TIME TARGET: ~15-20 minutes
 */
public class ShardRebalancingP1 {

    public record Shard(String id, int start, int end) {}

    public ShardRebalancingP1(int overlapLimit) {
        // TODO: initialize data structures
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Add a shard to the collection.
     */
    public void addShard(Shard shard) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Remove a shard by its id.
     *
     * @return true if the shard existed and was removed
     */
    public boolean removeShard(String shardId) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Return the maximum number of overlapping shards at any point in the range.
     */
    public int maxOverlap() {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Return true if maxOverlap() <= the configured overlap limit.
     */
    public boolean isValid() {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
