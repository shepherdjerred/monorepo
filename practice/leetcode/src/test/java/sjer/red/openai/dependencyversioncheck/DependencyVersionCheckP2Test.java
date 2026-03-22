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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class DependencyVersionCheckP2Test {
    private DependencyVersionCheckP2 solver;

    private static String b(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }

    @BeforeEach
    void setUp() {
        solver = new DependencyVersionCheckP2();
    }

    // --- Regression: Part 1 (A tests - monotonic data still works) ---

    @Test
    void scenario_A1_basic() {
        var versions = List.of("1.0", "1.1", "1.2", "1.3", "2.0");
        Function<String, Boolean> check = v -> v.compareTo("1.2") >= 0;
        assertEquals(b("MS4y"), solver.findEarliest(versions, check));
    }

    @Test
    void scenario_A2_first_version() {
        var versions = List.of("1.0", "2.0", "3.0");
        Function<String, Boolean> check = v -> true;
        assertEquals(b("MS4w"), solver.findEarliest(versions, check));
    }

    @Test
    void scenario_A3_last_version() {
        var versions = List.of("1.0", "2.0", "3.0");
        Function<String, Boolean> check = v -> v.equals("3.0");
        assertEquals(b("My4w"), solver.findEarliest(versions, check));
    }

    @Test
    void scenario_A4_none_support() {
        var versions = List.of("1.0", "2.0", "3.0");
        Function<String, Boolean> check = v -> false;
        assertNull(solver.findEarliest(versions, check));
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
        assertEquals("500", solver.findEarliest(versions, check));
    }

    // --- Part 2: Non-monotonic ---

    @Test
    void scenario_B1_broken_monotonicity() {
        var versions = List.of("1.0", "1.1", "1.2", "1.3", "1.4", "2.0");
        Map<String, Boolean> support = Map.of(
                "1.0", false, "1.1", true, "1.2", false,
                "1.3", true, "1.4", true, "2.0", true);
        assertEquals(b("MS4x"), solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_B2_only_last() {
        var versions = List.of("1.0", "2.0", "3.0", "4.0");
        Map<String, Boolean> support = Map.of(
                "1.0", false, "2.0", false, "3.0", false, "4.0", true);
        assertEquals(b("NC4w"), solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_B3_alternating() {
        var versions = List.of("1", "2", "3", "4", "5", "6");
        Map<String, Boolean> support = Map.of(
                "1", true, "2", false, "3", true,
                "4", false, "5", true, "6", false);
        assertEquals("1", solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_B4_none_support() {
        var versions = List.of("a", "b", "c");
        assertNull(solver.findEarliest(versions, v -> false));
    }

    @Test
    void scenario_B5_single_supports() {
        var versions = List.of("x");
        Map<String, Boolean> support = Map.of("x", true);
        assertEquals("x", solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_B6_single_no_support() {
        var versions = List.of("x");
        Map<String, Boolean> support = Map.of("x", false);
        assertNull(solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_B7_empty_list() {
        var versions = List.<String>of();
        assertNull(solver.findEarliest(versions, v -> true));
    }

    @Test
    void scenario_B8_only_first_supports() {
        var versions = List.of("a", "b", "c", "d");
        Map<String, Boolean> support = Map.of(
                "a", true, "b", false, "c", false, "d", false);
        assertEquals("a", solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_B9_only_middle_supports() {
        var versions = List.of("a", "b", "c", "d", "e");
        Map<String, Boolean> support = Map.of(
                "a", false, "b", false, "c", true, "d", false, "e", false);
        assertEquals("c", solver.findEarliest(versions, support::get));
    }
}
