package sjer.red.openai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;

class DependencyVersionCheckTest {
    private DependencyVersionCheck solver;

    @BeforeEach
    void setUp() {
        solver = new DependencyVersionCheck();
    }

    // --- Part 1: Monotonic binary search ---

    @Test
    void scenario_A1_basic() {
        var versions = List.of("1.0", "1.1", "1.2", "1.3", "2.0");
        Function<String, Boolean> check = v -> v.compareTo("1.2") >= 0;
        assertEquals(b("MS4y"), solver.findEarliestMonotonic(versions, check));
    }

    @Test
    void scenario_A2_first_version() {
        var versions = List.of("1.0", "2.0", "3.0");
        Function<String, Boolean> check = v -> true;
        assertEquals(b("MS4w"), solver.findEarliestMonotonic(versions, check));
    }

    @Test
    void scenario_A3_last_version() {
        var versions = List.of("1.0", "2.0", "3.0");
        Function<String, Boolean> check = v -> v.equals("3.0");
        assertEquals(b("My4w"), solver.findEarliestMonotonic(versions, check));
    }

    @Test
    void scenario_A4_none_support() {
        var versions = List.of("1.0", "2.0", "3.0");
        Function<String, Boolean> check = v -> false;
        assertNull(solver.findEarliestMonotonic(versions, check));
    }

    @Test
    void scenario_A5_efficiency() {
        // With 1000 versions, binary search should need at most ~10 calls
        var versions = new ArrayList<String>();
        for (int i = 0; i < 1000; i++) versions.add(String.valueOf(i));
        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return Integer.parseInt(v) >= 500;
        };
        assertEquals("500", solver.findEarliestMonotonic(versions, check));
        assertTrue(calls.get() <= 12, "Expected <=12 calls, got " + calls.get());
    }

    // --- Part 2: Non-monotonic ---

    @Test
    void scenario_B1_broken_monotonicity() {
        var versions = List.of("1.0", "1.1", "1.2", "1.3", "1.4", "2.0");
        Map<String, Boolean> support = Map.of(
                "1.0", false, "1.1", true, "1.2", false,
                "1.3", true, "1.4", true, "2.0", true);
        assertEquals(b("MS4x"),
                solver.findEarliestNonMonotonic(versions, support::get));
    }

    @Test
    void scenario_B2_only_last() {
        var versions = List.of("1.0", "2.0", "3.0", "4.0");
        Map<String, Boolean> support = Map.of(
                "1.0", false, "2.0", false, "3.0", false, "4.0", true);
        assertEquals(b("NC4w"),
                solver.findEarliestNonMonotonic(versions, support::get));
    }

    @Test
    void scenario_B3_alternating() {
        var versions = List.of("1", "2", "3", "4", "5", "6");
        Map<String, Boolean> support = Map.of(
                "1", true, "2", false, "3", true,
                "4", false, "5", true, "6", false);
        assertEquals("1", solver.findEarliestNonMonotonic(versions, support::get));
    }

    @Test
    void scenario_B4_none_support() {
        var versions = List.of("a", "b", "c");
        assertNull(solver.findEarliestNonMonotonic(versions, v -> false));
    }

    // --- Part 3: Budget-limited ---

    @Test
    void scenario_C1_unlimited_budget() {
        var versions = List.of("1", "2", "3", "4", "5");
        Map<String, Boolean> support = Map.of(
                "1", false, "2", false, "3", true, "4", false, "5", true);
        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return support.get(v);
        };
        var result = solver.findEarliestWithBudget(versions, check, 5);
        assertEquals("3", result);
        assertTrue(calls.get() <= 5);
    }

    @Test
    void scenario_C2_tight_budget() {
        var versions = List.of("1", "2", "3", "4", "5");
        Map<String, Boolean> support = Map.of(
                "1", false, "2", true, "3", false, "4", true, "5", true);
        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return support.get(v);
        };
        solver.findEarliestWithBudget(versions, check, 3);
        assertTrue(calls.get() <= 3, "Budget exceeded: " + calls.get() + " calls");
    }

    // --- Helpers ---
    private static String b(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }
}
