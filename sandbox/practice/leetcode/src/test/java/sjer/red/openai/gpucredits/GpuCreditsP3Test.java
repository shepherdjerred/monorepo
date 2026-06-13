package sjer.red.openai.gpucredits;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class GpuCreditsP3Test {
    private GpuCreditsP3 credits;

    @BeforeEach
    void setUp() {
        credits = new GpuCreditsP3();
    }

    // Regression (A1-A3)

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
        assertEquals(30, credits.availableCredits(1));
    }

    @Test
    void scenario_A3_exact_deduction() {
        credits.addCredit(0, 10, 50);
        assertTrue(credits.processCost(1, 50));
        assertEquals(0, credits.availableCredits(1));
    }

    // Regression (B1-B2)

    @Test
    void scenario_B1_fifo_order() {
        credits.addCredit(0, 10, 50);
        credits.addCredit(1, 5, 30);
        assertTrue(credits.processCost(2, 60));
        assertEquals(0x14, credits.availableCredits(2));
    }

    @Test
    void scenario_B2_partial_batch() {
        credits.addCredit(0, 10, 100);
        credits.addCredit(1, 15, 100);
        assertTrue(credits.processCost(2, 70));
        assertEquals(Integer.parseInt("82", 16), credits.availableCredits(2));
    }

    // New (C1-C6)

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
        assertEquals(30, credits.availableCredits(6));
        assertTrue(credits.processCost(6, 30));
        assertFalse(credits.processCost(6, 1));
    }

    @Test
    void scenario_C3_from_problem_description() {
        credits.addCredit(0, 10, 50);
        credits.addCredit(1, 5, 30);
        assertTrue(credits.processCost(2, 60));
        assertFalse(credits.processCost(2, 25));
        assertTrue(credits.processCost(2, 20));
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
        assertEquals(50, credits.availableCredits(1));
        assertTrue(credits.processCost(1, 50));
    }

    @Test
    void scenario_C7_expire_at_exact_boundary() {
        credits.addCredit(0, 5, 50);
        // Test at t=5 (exact expireTime). Implementation may treat this as expired or still valid.
        int available = credits.availableCredits(5);
        // Document: if t=expireTime means expired, available=0; if still valid, available=50
        assertTrue(available == 0 || available == 50);
        // processCost result should be consistent with availableCredits
        if (available == 0) {
            assertFalse(credits.processCost(5, 1));
        } else {
            assertTrue(credits.processCost(5, 1));
        }
    }

    @Test
    void scenario_C8_expire_time_before_add_time() {
        credits.addCredit(5, 3, 50);
        // expire=3 < add=5, credits should never be available
        assertEquals(0, credits.availableCredits(5));
        assertEquals(0, credits.availableCredits(4));
        assertEquals(0, credits.availableCredits(6));
    }

    @Test
    void scenario_C9_multiple_adds_at_same_time() {
        credits.addCredit(0, 10, 30);
        credits.addCredit(0, 10, 20);
        assertEquals(50, credits.availableCredits(0));
    }

    @Test
    void scenario_C10_non_chronological_adds() {
        credits.addCredit(5, 20, 30);
        credits.addCredit(3, 20, 20);
        // FIFO by insertion order: first added (30) consumed first
        assertTrue(credits.processCost(5, 30));
        assertEquals(20, credits.availableCredits(5));
    }

    @Test
    void scenario_C11_all_batches_expire_at_same_time() {
        credits.addCredit(0, 10, 20);
        credits.addCredit(1, 10, 30);
        credits.addCredit(2, 10, 50);
        assertEquals(100, credits.availableCredits(9));
        // At t=10 or t=11, all expired (exact boundary depends on implementation)
        assertEquals(0, credits.availableCredits(11));
    }

    @Test
    void scenario_C12_spend_skips_expired_in_fifo() {
        credits.addCredit(0, 5, 30);
        credits.addCredit(1, 20, 50);
        // At t=6, batch 1 (expire=5) is expired. Only batch 2 (50) remains.
        assertEquals(50, credits.availableCredits(6));
        assertTrue(credits.processCost(6, 30));
        assertEquals(20, credits.availableCredits(6));
    }

    @Test
    void scenario_C13_immediate_expiration() {
        credits.addCredit(5, 5, 100);
        // At t=5, this is the exact boundary (same as C7 pattern)
        int available = credits.availableCredits(5);
        assertTrue(available == 0 || available == 100);
    }
}
