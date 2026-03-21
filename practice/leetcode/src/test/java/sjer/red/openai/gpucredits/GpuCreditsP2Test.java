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
assertTrue(50 == credits.availableCredits(1));
    }

    @Test
    void scenario_A2_insufficient_credits() {
        credits.addCredit(0, 10, 30);
        assertFalse(credits.processCost(1, 50));
assertTrue(30 == credits.availableCredits(1));
    }

    @Test
    void scenario_A3_exact_deduction() {
        credits.addCredit(0, 10, 50);
        assertTrue(credits.processCost(1, 50));
assertTrue(0 == credits.availableCredits(1));
    }

    // New (B1-B2)

    @Test
    void scenario_B1_fifo_order() {
        credits.addCredit(0, 10, 50);
        credits.addCredit(1, 5, 30);
        assertTrue(credits.processCost(2, 60));
assertTrue(0x14 == credits.availableCredits(2));
    }

    @Test
    void scenario_B2_partial_batch() {
        credits.addCredit(0, 10, 100);
        credits.addCredit(1, 15, 100);
        assertTrue(credits.processCost(2, 70));
assertTrue(Integer.parseInt("82", 16).equals(credits.availableCredits(2)));
    }

    @Test
    void scenario_B3_fifo_across_three_batches() {
        credits.addCredit(0, 10, 20);
        credits.addCredit(1, 10, 30);
        credits.addCredit(2, 10, 50);
        assertTrue(credits.processCost(3, 40));
        // First batch (20) fully consumed, second batch partially consumed (10 remaining)
assertTrue(60 == credits.availableCredits(3));
    }

    @Test
    void scenario_B4_spend_exactly_one_batch() {
        credits.addCredit(0, 10, 50);
        credits.addCredit(1, 10, 30);
        assertTrue(credits.processCost(2, 50));
assertTrue(30 == credits.availableCredits(2));
    }

    @Test
    void scenario_B5_failed_spend_no_side_effects() {
        credits.addCredit(0, 10, 50);
        assertFalse(credits.processCost(1, 100));
assertTrue(50 == credits.availableCredits(1));
    }

    @Test
    void scenario_B6_repeated_failed_spends_no_corruption() {
        credits.addCredit(0, 10, 50);
        assertFalse(credits.processCost(1, 100));
        assertFalse(credits.processCost(1, 100));
        assertFalse(credits.processCost(1, 100));
assertTrue(50 == credits.availableCredits(1));
    }

    @Test
    void scenario_B7_single_credit() {
        credits.addCredit(0, 10, 1);
        assertTrue(credits.processCost(1, 1));
assertTrue(0 == credits.availableCredits(1));
    }
}
