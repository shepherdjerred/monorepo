package sjer.red.openai.memoryallocator;

/**
 * PROBLEM: Memory Allocator
 * SOURCE: From Shuxin
 * <p>
 * PART 1: Basic Alloc/Free (First-Fit)
 * - MemoryAllocatorP1(int totalSize) — memory range [0, totalSize)
 * - int alloc(int size) — allocate contiguous block, return start address. Return -1 if no space. First-fit strategy.
 * - boolean free(int start) — free block at start. Return true if valid allocation existed.
 * <p>
 * TIME TARGET: ~15-20 minutes
 */
public class MemoryAllocatorP1 {

    public MemoryAllocatorP1(int totalSize) {
        // TODO: initialize data structures
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Allocate a contiguous block of the given size.
     * Uses first-fit strategy: scan free list for the first block >= size.
     *
     * @return start address of allocated block, or -1 if no space available
     */
    public int alloc(int size) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Free the block starting at the given address.
     * Merge adjacent free blocks after freeing.
     *
     * @return true if a valid allocation existed at that address
     */
    public boolean free(int start) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
