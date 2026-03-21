package sjer.red.openai.gpucredits;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class GpuCreditsP2Test {
    private GpuCreditsP2 credits;

    @BeforeEach
    void setUp() {
        credits = new GpuCreditsP2();
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

    // New (B1-B2)

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
}
