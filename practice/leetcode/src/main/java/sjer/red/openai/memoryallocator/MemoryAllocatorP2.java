package sjer.red.openai.memoryallocator;

/**
 * PROBLEM: Memory Allocator
 * <p>
 * PART 2: O(log N) Operations (cumulative ~30-45 minutes)
 * - Same API as Part 1, but with O(log N) alloc and free
 * - Use TreeMap&lt;Integer, Integer&gt; (start -&gt; size) for free blocks
 * - Use floorEntry/ceilingEntry for efficient lookup
 * - Merge adjacent blocks on free
 * <p>
 * TIME TARGET: ~15-25 minutes (cumulative ~30-45)
 */
public class MemoryAllocatorP2 {

    public MemoryAllocatorP2(int totalSize) {
        // TODO: initialize data structures (TreeMap<Integer, Integer> for free blocks)
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Allocate a contiguous block of the given size.
     * Uses first-fit strategy with O(log N) lookup via TreeMap.
     *
     * @return start address of allocated block, or -1 if no space available
     */
    public int alloc(int size) {
        // TODO: implement using TreeMap floorEntry/ceilingEntry
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Free the block starting at the given address.
     * Merge adjacent free blocks using TreeMap floorEntry/ceilingEntry.
     *
     * @return true if a valid allocation existed at that address
     */
    public boolean free(int start) {
        // TODO: implement with O(log N) merge
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
