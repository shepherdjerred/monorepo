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
}
