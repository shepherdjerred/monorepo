package sjer.red.openai.creditsystem;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class CreditSystemP3Test {
    private CreditSystemP3 system;

    @BeforeEach
    void setUp() {
        system = new CreditSystemP3();
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

    // ========== Regression (B1-B16) ==========

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
        assertEquals(5, system.getBalance(49));
    }

    @Test
    void scenario_B4_soonest_expiring_consumed_first() {
        system.grantCredit("a", 5, 0, 100);
        system.grantCredit("b", 5, 0, 50);
        system.subtract(3, 10);
        assertEquals(7, system.getBalance(10));
        assertEquals(5, system.getBalance(50));
    }

    @Test
    void scenario_B5_same_end_time_lexicographic_tiebreak() {
        system.grantCredit("b", 5, 0, 100);
        system.grantCredit("a", 5, 0, 100);
        system.subtract(3, 10);
        assertEquals(7, system.getBalance(10));
        system.subtract(4, 20);
        assertEquals(3, system.getBalance(20));
    }

    @Test
    void scenario_B6_subtract_spans_two_grants() {
        system.grantCredit("a", 3, 0, 50);
        system.grantCredit("b", 5, 0, 100);
        system.subtract(5, 10);
        assertEquals(3, system.getBalance(10));
    }

    @Test
    void scenario_B7_getbalance_before_subtract_unaffected() {
        system.grantCredit("a", 10, 0, 100);
        system.subtract(5, 50);
        assertEquals(10, system.getBalance(49));
        assertEquals(5, system.getBalance(50));
    }

    @Test
    void scenario_B8_second_subtract_causes_failure() {
        system.grantCredit("a", 10, 0, 100);
        system.subtract(5, 20);
        system.subtract(6, 30);
        assertEquals(5, system.getBalance(25));
        assertEquals(-1, system.getBalance(30));
        assertEquals(-1, system.getBalance(50));
    }

    @Test
    void scenario_B9_subtract_ignores_expired_grants() {
        system.grantCredit("a", 5, 0, 20);
        system.grantCredit("b", 3, 0, 100);
        system.subtract(4, 30);
        assertEquals(-1, system.getBalance(30));
    }

    @Test
    void scenario_B10_subtract_exactly_exhausts_credits() {
        system.grantCredit("a", 5, 0, 100);
        system.subtract(5, 50);
        assertEquals(0, system.getBalance(50));
    }

    @Test
    void scenario_B11_failed_subtract_permanently_taints() {
        system.grantCredit("a", 5, 0, 100);
        system.subtract(10, 20);
        system.subtract(1, 30);
        assertEquals(-1, system.getBalance(30));
        assertEquals(-1, system.getBalance(99));
    }

    @Test
    void scenario_B12_consumed_credits_dont_reappear_after_expiry() {
        system.grantCredit("a", 5, 0, 50);
        system.grantCredit("b", 10, 0, 100);
        system.subtract(3, 10);
        assertEquals(12, system.getBalance(10));
        assertEquals(10, system.getBalance(50));
    }

    @Test
    void scenario_B13_same_timestamp_expire_before_subtract() {
        system.grantCredit("a", 5, 0, 50);
        system.grantCredit("b", 3, 0, 100);
        system.subtract(5, 50);
        assertEquals(-1, system.getBalance(50));
    }

    @Test
    void scenario_B14_same_timestamp_add_before_subtract() {
        system.grantCredit("a", 5, 50, 100);
        system.subtract(3, 50);
        assertEquals(2, system.getBalance(50));
    }

    @Test
    void scenario_B15_three_grants_drain_in_expiry_order() {
        system.grantCredit("x", 3, 0, 30);
        system.grantCredit("y", 4, 0, 50);
        system.grantCredit("z", 5, 0, 100);
        system.subtract(9, 10);
        assertEquals(3, system.getBalance(10));
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

    // ========== New (C1-C16) ==========

    @Test
    void scenario_C1_subtract_registered_before_grant() {
        system.subtract(5, 20);
        system.grantCredit("x", 10, 10, 30);
        assertEquals(5, system.getBalance(20));
    }

    @Test
    void scenario_C2_grant_registered_after_first_getbalance() {
        system.subtract(3, 50);
        // Before grant is registered, subtract at t=50 has no credits → -1
        assertEquals(-1, system.getBalance(50));
        // Now add the grant that covers it
        system.grantCredit("a", 10, 0, 100);
        // Re-query: grant active at t=50, subtract(3,50) now valid
        assertEquals(7, system.getBalance(50));
    }

    @Test
    void scenario_C3_revoke_unused_grant() {
        system.grantCredit("a", 5, 0, 100);
        system.grantCredit("b", 3, 0, 100);
        system.revokeGrant("b");
        assertEquals(5, system.getBalance(50));
    }

    @Test
    void scenario_C4_revoke_nonexistent_noop() {
        system.grantCredit("a", 5, 0, 100);
        system.revokeGrant("z");  // no-op
        assertEquals(5, system.getBalance(50));
    }

    @Test
    void scenario_C5_revoke_invalidates_subtract() {
        system.grantCredit("a", 10, 0, 100);
        system.grantCredit("b", 5, 0, 100);
        system.subtract(8, 50);
        // Before revoke: a consumed first (lex), a=2, b=5 → 7
        assertEquals(7, system.getBalance(50));
        // Revoke a: only b=5, subtract(8,50) needs 8 but only 5 available → -1
        system.revokeGrant("a");
        assertEquals(-1, system.getBalance(50));
    }

    @Test
    void scenario_C6_revoke_query_before_affected_subtract() {
        system.grantCredit("a", 10, 0, 100);
        system.subtract(8, 50);
        system.revokeGrant("a");
        // At t=49 (before subtract): no grants active (a revoked) → 0
        assertEquals(0, system.getBalance(49));
        // At t=50: subtract fails → -1
        assertEquals(-1, system.getBalance(50));
    }

    @Test
    void scenario_C7_same_timestamp_registration_order() {
        system.grantCredit("a", 5, 0, 100);
        system.grantCredit("b", 3, 0, 100);
        // Register two subtracts at same timestamp
        system.subtract(4, 50);  // registered first → processed first
        system.subtract(3, 50);  // registered second → processed second
        // First subtract: consume 4 from "a" (lex first). a=1, b=3
        // Second subtract: consume 1 from "a", 2 from "b". a=0, b=1
        assertEquals(1, system.getBalance(50));
    }

    @Test
    void scenario_C8_out_of_order_subtract_then_grant() {
        system.subtract(3, 50);
        system.grantCredit("a", 10, 0, 100);
        assertEquals(10, system.getBalance(49));
        assertEquals(7, system.getBalance(50));
    }

    @Test
    void scenario_C9_getbalance_before_any_events() {
        assertEquals(0, system.getBalance(0));
        assertEquals(0, system.getBalance(100));
    }

    @Test
    void scenario_C10_revoke_partially_consumed_grant() {
        system.grantCredit("a", 5, 0, 50);   // expires first
        system.grantCredit("b", 3, 0, 100);
        system.subtract(4, 10);
        // Simulation: a expires at 50 (soonest), consume 4 from a. a=1, b=3 → 4
        assertEquals(4, system.getBalance(10));
        // Revoke a: only b=3 at t=10, subtract(4,10) needs 4 but only 3 → -1
        system.revokeGrant("a");
        assertEquals(-1, system.getBalance(10));
    }

    @Test
    void scenario_C11_multiple_revocations_cascade() {
        system.grantCredit("a", 5, 0, 100);
        system.grantCredit("b", 5, 0, 100);
        system.grantCredit("c", 5, 0, 100);
        system.subtract(8, 50);
        // Consume: a=5 (all, lex first), b=3 → a=0, b=2, c=5 → 7
        assertEquals(7, system.getBalance(50));
        // Revoke b: a=5, c=5 at t=50. Subtract 8: a=5 (all), c=3 → 2
        system.revokeGrant("b");
        assertEquals(2, system.getBalance(50));
        // Revoke a: only c=5 at t=50. Subtract 8 needs 8, only 5 → -1
        system.revokeGrant("a");
        assertEquals(-1, system.getBalance(50));
    }

    @Test
    void scenario_C12_revoke_then_add_different_grant() {
        system.grantCredit("a", 5, 0, 100);
        system.subtract(5, 50);
        assertEquals(0, system.getBalance(50));
        system.revokeGrant("a");
        assertEquals(-1, system.getBalance(50));
        // Add a new grant that covers the same window
        system.grantCredit("b", 10, 0, 100);
        // Now subtract(5,50) can be satisfied by b
        assertEquals(5, system.getBalance(50));
    }

    @Test
    void scenario_C13_full_leetcode_example_original_order() {
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

    @Test
    void scenario_C14_full_leetcode_example_reversed_registration() {
        // Same events, but registered in reverse order
        system.subtract(3, 50);
        system.subtract(1, 30);
        system.grantCredit("b", 2, 20, 40);
        system.grantCredit("a", 3, 10, 60);
        // Results must be identical to original order
        assertEquals(3, system.getBalance(10));
        assertEquals(5, system.getBalance(20));
        assertEquals(4, system.getBalance(30));
        assertEquals(4, system.getBalance(35));
        assertEquals(3, system.getBalance(40));
        assertEquals(0, system.getBalance(50));
    }

    @Test
    void scenario_C15_same_timestamp_expire_add_subtract() {
        // At t=50: grant "a" expires, grant "b" starts, subtract happens
        system.grantCredit("a", 5, 0, 50);    // expires at 50
        system.grantCredit("b", 8, 50, 100);   // starts at 50
        system.subtract(6, 50);
        // Order: expire a, then add b (8 available), then subtract 6 → b=2
        assertEquals(2, system.getBalance(50));
    }

    @Test
    void scenario_C16_revoke_soonest_expiring_changes_order() {
        system.grantCredit("a", 5, 0, 30);   // expires at 30 (soonest)
        system.grantCredit("b", 5, 0, 50);   // expires at 50
        system.grantCredit("c", 5, 0, 100);  // expires at 100
        system.subtract(4, 10);
        // Normal: consume from a first (expires soonest). a=1, b=5, c=5 → 11
        assertEquals(11, system.getBalance(10));
        // Revoke a: now b is soonest expiring. Consume 4 from b. b=1, c=5 → 6
        system.revokeGrant("a");
        assertEquals(6, system.getBalance(10));
    }
}
