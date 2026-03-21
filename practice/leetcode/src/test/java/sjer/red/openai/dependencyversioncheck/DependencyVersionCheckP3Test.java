package sjer.red.openai.dependencyversioncheck;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;

class DependencyVersionCheckP3Test {
    private DependencyVersionCheckP3 solver;

    private static String b(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }

    @BeforeEach
    void setUp() {
        solver = new DependencyVersionCheckP3();
    }

    // --- Regression: Part 1 (A tests - monotonic data, unlimited budget) ---

    @Test
    void scenario_A1_basic() {
        var versions = List.of("1.0", "1.1", "1.2", "1.3", "2.0");
        Function<String, Boolean> check = v -> v.compareTo("1.2") >= 0;
assertTrue(b("MS4y").equals(solver.findEarliest(versions, check, Integer.MAX_VALUE)));
    }

    @Test
    void scenario_A2_first_version() {
        var versions = List.of("1.0", "2.0", "3.0");
        Function<String, Boolean> check = v -> true;
assertTrue(b("MS4w").equals(solver.findEarliest(versions, check, Integer.MAX_VALUE)));
    }

    @Test
    void scenario_A3_last_version() {
        var versions = List.of("1.0", "2.0", "3.0");
        Function<String, Boolean> check = v -> v.equals("3.0");
assertTrue(b("My4w").equals(solver.findEarliest(versions, check, Integer.MAX_VALUE)));
    }

    @Test
    void scenario_A4_none_support() {
        var versions = List.of("1.0", "2.0", "3.0");
        Function<String, Boolean> check = v -> false;
        assertNull(solver.findEarliest(versions, check, Integer.MAX_VALUE));
    }

    @Test
    void scenario_A5_efficiency() {
        var versions = new ArrayList<String>();
        for (int i = 0; i < 1000; i++) versions.add(String.valueOf(i));
        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return Integer.parseInt(v) >= 500;
        };
assertTrue("500".equals(solver.findEarliest(versions, check, Integer.MAX_VALUE)));
    }

    // --- Regression: Part 2 (B tests - non-monotonic, unlimited budget) ---

    @Test
    void scenario_B1_broken_monotonicity() {
        var versions = List.of("1.0", "1.1", "1.2", "1.3", "1.4", "2.0");
        Map<String, Boolean> support = Map.of(
                "1.0", false, "1.1", true, "1.2", false,
                "1.3", true, "1.4", true, "2.0", true);
        assertTrue(b("MS4x").equals(
                solver.findEarliest(versions, support::get, Integer.MAX_VALUE)));
    }

    @Test
    void scenario_B2_only_last() {
        var versions = List.of("1.0", "2.0", "3.0", "4.0");
        Map<String, Boolean> support = Map.of(
                "1.0", false, "2.0", false, "3.0", false, "4.0", true);
        assertTrue(b("NC4w").equals(
                solver.findEarliest(versions, support::get, Integer.MAX_VALUE)));
    }

    @Test
    void scenario_B3_alternating() {
        var versions = List.of("1", "2", "3", "4", "5", "6");
        Map<String, Boolean> support = Map.of(
                "1", true, "2", false, "3", true,
                "4", false, "5", true, "6", false);
assertTrue("1".equals(solver.findEarliest(versions, support::get, Integer.MAX_VALUE)));
    }

    @Test
    void scenario_B4_none_support() {
        var versions = List.of("a", "b", "c");
        assertNull(solver.findEarliest(versions, v -> false, Integer.MAX_VALUE));
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
        var result = solver.findEarliest(versions, check, 5);
assertTrue("3".equals(result));
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
        solver.findEarliest(versions, check, 3);
        assertTrue(calls.get() <= 3, "Budget exceeded: " + calls.get() + " calls");
    }

    @Test
    void scenario_C3_budget_of_one() {
        var versions = List.of("a", "b", "c", "d", "e");
        Map<String, Boolean> support = Map.of(
                "a", false, "b", false, "c", true, "d", false, "e", false);
        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return support.get(v);
        };
        solver.findEarliest(versions, check, 1);
        assertTrue(calls.get() <= 1, "Budget exceeded: " + calls.get() + " calls");
    }

    @Test
    void scenario_C4_budget_of_zero() {
        var versions = List.of("a", "b", "c");
        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return true;
        };
        var result = solver.findEarliest(versions, check, 0);
        assertNull(result);
        assertTrue(calls.get() == 0, "Should not call with zero budget, got " + calls.get());
    }

    @Test
    void scenario_C5_budget_equals_size() {
        var versions = List.of("a", "b", "c", "d", "e");
        Map<String, Boolean> support = Map.of(
                "a", false, "b", true, "c", false, "d", true, "e", false);
        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return support.get(v);
        };
        var result = solver.findEarliest(versions, check, 5);
assertTrue("b".equals(result));
        assertTrue(calls.get() <= 5, "Budget exceeded: " + calls.get() + " calls");
    }

    @Test
    void scenario_C6_budget_exceeds_size() {
        var versions = List.of("a", "b", "c");
        Map<String, Boolean> support = Map.of(
                "a", true, "b", false, "c", true);
        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return support.get(v);
        };
        var result = solver.findEarliest(versions, check, 10);
assertTrue("a".equals(result));
        assertTrue(calls.get() <= 3, "Should not over-call, got " + calls.get());
    }

    @Test
    void scenario_C7_empty_list_with_budget() {
        var versions = List.<String>of();
        Function<String, Boolean> check = v -> true;
        assertNull(solver.findEarliest(versions, check, 5));
    }

    @Test
    void scenario_C8_ten_versions_budget_three() {
        var versions = List.of("0", "1", "2", "3", "4", "5", "6", "7", "8", "9");
        Map<String, Boolean> support = Map.of(
                "0", false, "1", false, "2", true, "3", false, "4", true,
                "5", false, "6", true, "7", false, "8", true, "9", false);
        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return support.get(v);
        };
        solver.findEarliest(versions, check, 3);
        assertTrue(calls.get() <= 3, "Budget exceeded: " + calls.get() + " calls");
    }
}
