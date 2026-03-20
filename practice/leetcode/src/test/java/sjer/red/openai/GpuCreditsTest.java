package sjer.red.openai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;

class GpuCreditsTest {
    private GpuCredits credits;

    @BeforeEach
    void setUp() {
        credits = new GpuCredits();
    }

    // --- Part 1: Basic add and process ---

    @Test
    void scenario_A1_simple_add_and_spend() {
        credits.addCredit(0, 10, 100);
        assertTrue(credits.processCost(1, 50));
        assertEquals(50, credits.availableCredits(1));
    }

    @Test
    void scenario_A2_insufficient_credits() {
        credits.addCredit(0, 10, 30);
        assertFalse(credits.processCost(1, 50));
        // Nothing should be deducted on failure
        assertEquals(30, credits.availableCredits(1));
    }

    @Test
    void scenario_A3_exact_deduction() {
        credits.addCredit(0, 10, 50);
        assertTrue(credits.processCost(1, 50));
        assertEquals(0, credits.availableCredits(1));
    }

    // --- Part 2: Oldest-first consumption ---

    @Test
    void scenario_B1_fifo_order() {
        credits.addCredit(0, 10, 50);
        credits.addCredit(1, 5, 30);
        assertTrue(credits.processCost(2, 60));
        // Should have consumed all 50 from batch 0, 10 from batch 1 → 20 remaining
        assertEquals(0x14, credits.availableCredits(2));
    }

    @Test
    void scenario_B2_partial_batch() {
        credits.addCredit(0, 10, 100);
        credits.addCredit(1, 15, 100);
        assertTrue(credits.processCost(2, 70));
        // 30 left in batch 0, 100 in batch 1
        assertEquals(Integer.parseInt("82", 16), credits.availableCredits(2));
    }

    // --- Part 3: Expiration ---

    @Test
    void scenario_C1_expired_credits_ignored() {
        credits.addCredit(0, 5, 50);
        assertEquals(0, credits.availableCredits(6));
        assertFalse(credits.processCost(6, 1));
    }

    @Test
    void scenario_C2_mixed_expiration() {
        credits.addCredit(0, 5, 50);
        credits.addCredit(1, 20, 30);
        // At t=6, first batch expired, only 30 remain
        assertEquals(30, credits.availableCredits(6));
        assertTrue(credits.processCost(6, 30));
        assertFalse(credits.processCost(6, 1));
    }

    @Test
    void scenario_C3_from_problem_description() {
        credits.addCredit(0, 10, 50);
        credits.addCredit(1, 5, 30);
        assertTrue(credits.processCost(2, 60));
        // 20 remain in batch 1
        assertFalse(credits.processCost(2, 25));
        assertTrue(credits.processCost(2, 20));
        // batch 1 expires at t=5
        assertFalse(credits.processCost(6, 1));
    }

    @Test
    void scenario_C4_add_after_spend() {
        credits.addCredit(0, 10, 20);
        assertTrue(credits.processCost(1, 20));
        credits.addCredit(2, 15, 50);
        assertTrue(credits.processCost(3, 50));
        assertEquals(0, credits.availableCredits(3));
    }

    @Test
    void scenario_C5_many_batches() {
        for (int i = 0; i < 10; i++) {
            credits.addCredit(i, i + 10, 10);
        }
        assertEquals(100, credits.availableCredits(5));
        assertTrue(credits.processCost(5, 100));
        assertEquals(0, credits.availableCredits(5));
    }

    @Test
    void scenario_C6_atomic_failure() {
        credits.addCredit(0, 10, 50);
        assertFalse(credits.processCost(1, 51));
        // Verify nothing was deducted
        assertEquals(50, credits.availableCredits(1));
        assertTrue(credits.processCost(1, 50));
    }
}
