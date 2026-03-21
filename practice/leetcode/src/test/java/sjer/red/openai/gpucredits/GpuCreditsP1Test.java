package sjer.red.openai.gpucredits;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class GpuCreditsP1Test {
    private GpuCreditsP1 credits;

    @BeforeEach
    void setUp() {
        credits = new GpuCreditsP1();
    }

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
}
