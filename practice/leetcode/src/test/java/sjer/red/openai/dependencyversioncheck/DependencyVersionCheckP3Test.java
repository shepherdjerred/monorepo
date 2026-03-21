package sjer.red.openai.dependencyversioncheck;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DependencyVersionCheckP3Test {
    private DependencyVersionCheckP3 solver;

    private static String b(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }

    // --- Regression: Part 1 ---

    @BeforeEach
    void setUp() {
        solver = new DependencyVersionCheckP3();
    }

    // --- Regression: Part 2 ---

    @Test
    void scenario_A1_basic() {
        var versions = List.of("1.0", "1.1", "1.2", "1.3", "2.0");
        Function<String, Boolean> check = v -> v.compareTo("1.2") >= 0;
        assertEquals(b("MS4y"), solver.findEarliestMonotonic(versions, check));
    }

    // --- Part 3: Budget-limited ---

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
}
