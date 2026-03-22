package sjer.red.openai.memoryallocator;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class MemoryAllocatorP2Test {

    @Test
    void scenario_A1_alloc_from_fresh_returns_0() {
        var alloc = new MemoryAllocatorP2(100);
        assertEquals(0, alloc.alloc(10));
    }

    @Test
    void scenario_A2_sequential_allocs_return_sequential_addresses() {
        var alloc = new MemoryAllocatorP2(100);
        assertEquals(0, alloc.alloc(10));
        assertEquals(10, alloc.alloc(20));
        assertEquals(30, alloc.alloc(5));
    }

    @Test
    void scenario_A3_alloc_too_large_returns_negative_one() {
        var alloc = new MemoryAllocatorP2(10);
        assertEquals(-1, alloc.alloc(11));
    }

    @Test
    void scenario_A4_free_then_realloc_reuses_space() {
        var alloc = new MemoryAllocatorP2(100);
        assertEquals(0, alloc.alloc(10));
        assertTrue(alloc.free(0));
        assertEquals(0, alloc.alloc(10));
    }

    @Test
    void scenario_B1_many_small_allocs_then_frees_coalescing() {
        var alloc = new MemoryAllocatorP2(100);
        // Allocate 10 blocks of size 10
        for (int i = 0; i < 10; i++) {
            assertEquals(i * 10, alloc.alloc(10));
        }
        // Free all blocks
        for (int i = 0; i < 10; i++) {
            assertTrue(alloc.free(i * 10));
        }
        // After coalescing, should be able to allocate entire space
        assertEquals(0, alloc.alloc(100));
    }

    @Test
    void scenario_B2_free_middle_block_no_incorrect_merge() {
        var alloc = new MemoryAllocatorP2(30);
        assertEquals(0, alloc.alloc(10));   // A at [0,10)
        assertEquals(10, alloc.alloc(10));  // B at [10,20)
        assertEquals(20, alloc.alloc(10));  // C at [20,30)
        assertTrue(alloc.free(10));         // free B only
        // A and C still allocated, so free region is only [10,20)
        assertEquals(-1, alloc.alloc(11)); // can't fit 11 in the 10-size gap
        assertEquals(10, alloc.alloc(10)); // but 10 fits exactly
    }

    @Test
    void scenario_B3_allocate_all_free_all_allocate_all_again() {
        var alloc = new MemoryAllocatorP2(50);
        assertEquals(0, alloc.alloc(50));
        assertEquals(-1, alloc.alloc(1));
        assertTrue(alloc.free(0));
        assertEquals(0, alloc.alloc(50));
    }

    @Test
    void scenario_B4_interleaved_alloc_free() {
        var alloc = new MemoryAllocatorP2(100);
        assertEquals(0, alloc.alloc(20));   // [0,20)
        assertEquals(20, alloc.alloc(20));  // [20,40)
        assertTrue(alloc.free(0));          // free [0,20)
        assertEquals(40, alloc.alloc(30));  // [40,70) — 20-size gap too small
        assertEquals(0, alloc.alloc(15));   // fits in [0,20) gap
        assertEquals(15, alloc.alloc(5));   // fills rest of [0,20) gap
    }

    @Test
    void scenario_B5_stress_alloc_free_pattern() {
        var alloc = new MemoryAllocatorP2(1000);
        int[] addresses = new int[100];
        // Allocate 100 blocks of size 10
        for (int i = 0; i < 100; i++) {
            addresses[i] = alloc.alloc(10);
            assertEquals(i * 10, addresses[i]);
        }
        // Free even-indexed blocks
        for (int i = 0; i < 100; i += 2) {
            assertTrue(alloc.free(addresses[i]));
        }
        // Re-allocate into the freed gaps
        for (int i = 0; i < 100; i += 2) {
            int addr = alloc.alloc(10);
            assertEquals(addresses[i], addr);
        }
        // Now all 1000 bytes are allocated again
        assertEquals(-1, alloc.alloc(1));
    }

    @Test
    void scenario_B6_free_in_reverse_order_coalescing() {
        var alloc = new MemoryAllocatorP2(50);
        assertEquals(0, alloc.alloc(10));
        assertEquals(10, alloc.alloc(10));
        assertEquals(20, alloc.alloc(10));
        assertEquals(30, alloc.alloc(10));
        assertEquals(40, alloc.alloc(10));
        // Free in reverse order
        assertTrue(alloc.free(40));
        assertTrue(alloc.free(30));
        assertTrue(alloc.free(20));
        assertTrue(alloc.free(10));
        assertTrue(alloc.free(0));
        // Everything coalesced — allocate full block
        assertEquals(0, alloc.alloc(50));
    }
}
