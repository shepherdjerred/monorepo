package sjer.red.openai.memoryallocator;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class MemoryAllocatorP1Test {

    @Test
    void scenario_A1_alloc_from_fresh_returns_0() {
        var alloc = new MemoryAllocatorP1(100);
        assertEquals(0, alloc.alloc(10));
    }

    @Test
    void scenario_A2_sequential_allocs_return_sequential_addresses() {
        var alloc = new MemoryAllocatorP1(100);
        assertEquals(0, alloc.alloc(10));
        assertEquals(10, alloc.alloc(20));
        assertEquals(30, alloc.alloc(5));
    }

    @Test
    void scenario_A3_alloc_too_large_returns_negative_one() {
        var alloc = new MemoryAllocatorP1(10);
        assertEquals(-1, alloc.alloc(11));
    }

    @Test
    void scenario_A4_free_then_realloc_reuses_space() {
        var alloc = new MemoryAllocatorP1(100);
        assertEquals(0, alloc.alloc(10));
        assertTrue(alloc.free(0));
        assertEquals(0, alloc.alloc(10));
    }

    @Test
    void scenario_A5_free_invalid_address_returns_false() {
        var alloc = new MemoryAllocatorP1(100);
        assertFalse(alloc.free(0));
        assertFalse(alloc.free(50));
    }

    @Test
    void scenario_A6_alloc_exact_total_size_succeeds() {
        var alloc = new MemoryAllocatorP1(64);
        assertEquals(0, alloc.alloc(64));
    }

    @Test
    void scenario_A7_alloc_after_full_returns_negative_one() {
        var alloc = new MemoryAllocatorP1(10);
        assertEquals(0, alloc.alloc(10));
        assertEquals(-1, alloc.alloc(1));
    }

    @Test
    void scenario_B1_fragmentation_first_fit() {
        var alloc = new MemoryAllocatorP1(30);
        assertEquals(0, alloc.alloc(10));   // A at [0,10)
        assertEquals(10, alloc.alloc(10));  // B at [10,20)
        assertTrue(alloc.free(0));          // free A
        assertEquals(0, alloc.alloc(5));    // C fits at 0 (first-fit)
    }

    @Test
    void scenario_B2_free_then_alloc_larger_after_coalescing() {
        var alloc = new MemoryAllocatorP1(30);
        assertEquals(0, alloc.alloc(10));   // A at [0,10)
        assertEquals(10, alloc.alloc(10));  // B at [10,20)
        assertTrue(alloc.free(0));          // free A -> [0,10) free
        assertTrue(alloc.free(10));         // free B -> [0,20) free after coalescing
        assertEquals(0, alloc.alloc(20));   // should fit in coalesced block
    }

    @Test
    void scenario_B3_double_free_returns_false_on_second() {
        var alloc = new MemoryAllocatorP1(100);
        assertEquals(0, alloc.alloc(10));
        assertTrue(alloc.free(0));
        assertFalse(alloc.free(0));
    }
}
