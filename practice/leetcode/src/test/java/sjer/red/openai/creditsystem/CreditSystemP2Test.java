package sjer.red.openai.creditsystem;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class CreditSystemP2Test {
    private CreditSystemP2 system;

    @BeforeEach
    void setUp() {
        system = new CreditSystemP2();
    }

    // ========== Regression (A1-A12) ==========

    @Test
    void scenario_A1_single_grant_inside_window() {
        system.grantCredit("a", 3, 10, 60);
        assertEquals(3, system.getBalance(10));
    }

    @Test
    void scenario_A2_query_before_start_time() {
        system.grantCredit("a", 3, 10, 60);
        assertEquals(0, system.getBalance(9));
    }

    @Test
    void scenario_A3_query_at_exact_end_time_exclusive() {
        system.grantCredit("a", 3, 10, 60);
        assertEquals(0, system.getBalance(60));
    }

    @Test
    void scenario_A4_query_at_start_time_inclusive() {
        system.grantCredit("a", 3, 10, 60);
        assertEquals(3, system.getBalance(10));
    }

    @Test
    void scenario_A5_query_at_end_time_minus_one() {
        system.grantCredit("a", 3, 10, 60);
        assertEquals(3, system.getBalance(59));
    }

    @Test
    void scenario_A6_two_overlapping_grants() {
        system.grantCredit("a", 3, 10, 60);
        system.grantCredit("b", 2, 20, 40);
        assertEquals(5, system.getBalance(25));
    }

    @Test
    void scenario_A7_two_grants_one_expired() {
        system.grantCredit("a", 3, 10, 60);
        system.grantCredit("b", 2, 20, 40);
        assertEquals(3, system.getBalance(45));
    }

    @Test
    void scenario_A8_both_expired() {
        system.grantCredit("a", 3, 10, 60);
        system.grantCredit("b", 2, 20, 40);
        assertEquals(0, system.getBalance(60));
    }

    @Test
    void scenario_A9_no_grants_registered() {
        assertEquals(0, system.getBalance(10));
    }

    @Test
    void scenario_A10_non_overlapping_query_hits_second() {
        system.grantCredit("a", 5, 0, 10);
        system.grantCredit("b", 3, 20, 30);
        assertEquals(3, system.getBalance(25));
    }

    @Test
    void scenario_A11_same_start_different_end() {
        system.grantCredit("a", 3, 10, 50);
        system.grantCredit("b", 2, 10, 30);
        assertEquals(5, system.getBalance(10));
    }

    @Test
    void scenario_A12_many_grants_query_hits_subset() {
        system.grantCredit("a", 10, 0, 20);
        system.grantCredit("b", 20, 5, 25);
        system.grantCredit("c", 30, 10, 30);
        system.grantCredit("d", 40, 15, 35);
        system.grantCredit("e", 50, 20, 40);
        assertEquals(20 + 30 + 40 + 50, system.getBalance(22));
        assertEquals(10 + 20 + 30, system.getBalance(12));
    }

    // ========== New (B1-B16) ==========

    @Test
    void scenario_B1_single_subtract_check_balance() {
        system.grantCredit("a", 10, 0, 100);
        system.subtract(3, 50);
        assertEquals(7, system.getBalance(50));
    }

    @Test
    void scenario_B2_subtract_fails_insufficient() {
        system.grantCredit("a", 5, 0, 100);
        system.subtract(10, 50);
        assertEquals(-1, system.getBalance(50));
    }

    @Test
    void scenario_B3_failed_subtract_atomic_no_deduction() {
        system.grantCredit("a", 5, 0, 100);
        system.subtract(10, 50);
        // Before the failed subtract, balance should still be full
        assertEquals(5, system.getBalance(49));
    }

    @Test
    void scenario_B4_soonest_expiring_consumed_first() {
        system.grantCredit("a", 5, 0, 100);  // expires at 100
        system.grantCredit("b", 5, 0, 50);   // expires at 50 — consumed first
        system.subtract(3, 10);
        // b should lose 3, so at t=10: a=5, b=2 → 7
        assertEquals(7, system.getBalance(10));
        // After b expires at t=50: only a=5 remains (b was partially consumed, now expired)
        assertEquals(5, system.getBalance(50));
    }

    @Test
    void scenario_B5_same_end_time_lexicographic_tiebreak() {
        system.grantCredit("b", 5, 0, 100);
        system.grantCredit("a", 5, 0, 100);  // "a" < "b" lexicographically
        system.subtract(3, 10);
        // "a" consumed first (lex smaller), then check remaining
        // After subtract: a=2, b=5 → 7
        assertEquals(7, system.getBalance(10));
        // Subtract 4 more: takes 2 from a, 2 from b
        system.subtract(4, 20);
        // a=0, b=3 → 3
        assertEquals(3, system.getBalance(20));
    }

    @Test
    void scenario_B6_subtract_spans_two_grants() {
        system.grantCredit("a", 3, 0, 50);   // expires first
        system.grantCredit("b", 5, 0, 100);
        system.subtract(5, 10);
        // Takes 3 from a (soonest expiring), 2 from b → a=0, b=3
        assertEquals(3, system.getBalance(10));
    }

    @Test
    void scenario_B7_getbalance_before_subtract_unaffected() {
        system.grantCredit("a", 10, 0, 100);
        system.subtract(5, 50);
        // Query before subtract timestamp
        assertEquals(10, system.getBalance(49));
        // Query at subtract timestamp
        assertEquals(5, system.getBalance(50));
    }

    @Test
    void scenario_B8_second_subtract_causes_failure() {
        system.grantCredit("a", 10, 0, 100);
        system.subtract(5, 20);
        system.subtract(6, 30);  // only 5 left, need 6 → fails
        assertEquals(5, system.getBalance(25));  // between subtracts, first applied
        assertEquals(-1, system.getBalance(30));  // at failed subtract
        assertEquals(-1, system.getBalance(50));  // after failed subtract
    }

    @Test
    void scenario_B9_subtract_ignores_expired_grants() {
        system.grantCredit("a", 5, 0, 20);   // expired by t=30
        system.grantCredit("b", 3, 0, 100);
        system.subtract(4, 30);  // a expired, only b=3 available → fails
        assertEquals(-1, system.getBalance(30));
    }

    @Test
    void scenario_B10_subtract_exactly_exhausts_credits() {
        system.grantCredit("a", 5, 0, 100);
        system.subtract(5, 50);
        assertEquals(0, system.getBalance(50));  // 0, not -1
    }

    @Test
    void scenario_B11_failed_subtract_permanently_taints() {
        system.grantCredit("a", 5, 0, 100);
        system.subtract(10, 20);  // fails
        system.subtract(1, 30);   // would succeed in isolation, but -1 already set
        assertEquals(-1, system.getBalance(30));
        assertEquals(-1, system.getBalance(99));
    }

    @Test
    void scenario_B12_consumed_credits_dont_reappear_after_expiry() {
        system.grantCredit("a", 5, 0, 50);   // expires at 50
        system.grantCredit("b", 10, 0, 100);
        system.subtract(3, 10);  // takes 3 from a (soonest expiring)
        // a=2, b=10 at t=10
        assertEquals(12, system.getBalance(10));
        // After a expires: only b=10
        assertEquals(10, system.getBalance(50));
    }

    @Test
    void scenario_B13_same_timestamp_expire_before_subtract() {
        // Grant expires at t=50; subtract also at t=50
        system.grantCredit("a", 5, 0, 50);
        system.grantCredit("b", 3, 0, 100);
        system.subtract(5, 50);
        // At t=50: a is expired [0,50), only b=3 active. Subtract 5 fails.
        assertEquals(-1, system.getBalance(50));
    }

    @Test
    void scenario_B14_same_timestamp_add_before_subtract() {
        // Grant starts at t=50; subtract also at t=50
        system.grantCredit("a", 5, 50, 100);
        system.subtract(3, 50);
        // At t=50: a just became active, subtract should succeed
        assertEquals(2, system.getBalance(50));
    }

    @Test
    void scenario_B15_three_grants_drain_in_expiry_order() {
        system.grantCredit("x", 3, 0, 30);   // expires first
        system.grantCredit("y", 4, 0, 50);   // expires second
        system.grantCredit("z", 5, 0, 100);  // expires last
        system.subtract(9, 10);
        // Consumes: x=3 (all), y=4 (all), z=2 → z has 3 remaining
        assertEquals(3, system.getBalance(10));
        // After x and y expire, only z=3 remains
        assertEquals(3, system.getBalance(50));
    }

    @Test
    void scenario_B16_full_leetcode_example() {
        system.grantCredit("a", 3, 10, 60);
        assertEquals(3, system.getBalance(10));
        system.grantCredit("b", 2, 20, 40);
        system.subtract(1, 30);
        system.subtract(3, 50);
        assertEquals(3, system.getBalance(10));
        assertEquals(5, system.getBalance(20));
        assertEquals(4, system.getBalance(30));
        assertEquals(4, system.getBalance(35));
        assertEquals(3, system.getBalance(40));
        assertEquals(0, system.getBalance(50));
    }
}
