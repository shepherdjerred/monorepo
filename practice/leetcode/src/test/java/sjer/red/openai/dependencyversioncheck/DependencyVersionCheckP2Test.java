package sjer.red.openai.dependencyversioncheck;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class DependencyVersionCheckP2Test {
    private DependencyVersionCheckP2 solver;

    private static String b(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }

    // --- Regression: Part 1 ---

    @BeforeEach
    void setUp() {
        solver = new DependencyVersionCheckP2();
    }

    // --- Part 2: Non-monotonic ---

    @Test
    void scenario_A1_basic() {
        var versions = List.of("1.0", "1.1", "1.2", "1.3", "2.0");
        Function<String, Boolean> check = v -> v.compareTo("1.2") >= 0;
        assertEquals(b("MS4y"), solver.findEarliestMonotonic(versions, check));
    }

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
}
