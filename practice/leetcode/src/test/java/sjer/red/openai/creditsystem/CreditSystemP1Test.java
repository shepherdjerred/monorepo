package sjer.red.openai.creditsystem;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class CreditSystemP1Test {
    private CreditSystemP1 system;

    @BeforeEach
    void setUp() {
        system = new CreditSystemP1();
    }

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
        // At t=22: a expired (end=20), b active, c active, d active, e active
        assertEquals(20 + 30 + 40 + 50, system.getBalance(22));
        // At t=12: a active, b active, c active, d not started, e not started
        assertEquals(10 + 20 + 30, system.getBalance(12));
    }
}
