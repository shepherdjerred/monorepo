package sjer.red.openai.dependencyversioncheck;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import sjer.red.openai.dependencyversioncheck.attempt1.DependencyVersionCheckP2;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
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

    // --- Part 2: Non-monotonic with semver-style versions ---
    // These test cases reveal that global monotonicity is broken.
    // The candidate should observe from the data that the LAST version
    // of each major group behaves monotonically across groups.

    @Test
    void scenario_B1_broken_monotonicity_semver() {
        // 103.003.02 supports, but 103.003.03 does NOT — breaks binary search!
        var versions = List.of("103.003.02", "103.003.03", "203.003.02");
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("103.003.02", true);
        support.put("103.003.03", false);
        support.put("203.003.02", true);
        // Answer: 103.003.02
        assertEquals(b("MTAzLjAwMy4wMg=="), solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_B2_support_flips_within_major() {
        // Within major 1: support flips between patches
        // But last version of major 1 (1.1.1) supports, last of major 2 (2.1.1) supports
        var versions = List.of("1.0.0", "1.0.1", "1.1.0", "1.1.1", "2.0.0", "2.0.1", "2.1.0", "2.1.1");
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("1.0.0", false);
        support.put("1.0.1", true);   // earliest!
        support.put("1.1.0", false);  // broken monotonicity
        support.put("1.1.1", true);
        support.put("2.0.0", true);
        support.put("2.0.1", false);  // broken again
        support.put("2.1.0", true);
        support.put("2.1.1", true);
        // Answer: 1.0.1
        assertEquals(b("MS4wLjE="), solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_B3_first_major_no_support() {
        // Major 1 has no support at all, major 2 has some
        var versions = List.of("1.0.0", "1.0.1", "1.1.0", "2.0.0", "2.0.1", "2.1.0");
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("1.0.0", false);
        support.put("1.0.1", false);
        support.put("1.1.0", false);
        support.put("2.0.0", false);
        support.put("2.0.1", true);  // earliest!
        support.put("2.1.0", true);
        // Answer: 2.0.1
        assertEquals(b("Mi4wLjE="), solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_B4_all_majors_some_support() {
        // Every major has at least one supporting version
        var versions = List.of("1.0.0", "1.0.1", "2.0.0", "2.0.1", "3.0.0", "3.0.1");
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("1.0.0", true);   // earliest!
        support.put("1.0.1", false);
        support.put("2.0.0", false);
        support.put("2.0.1", true);
        support.put("3.0.0", true);
        support.put("3.0.1", false);
        assertEquals(b("MS4wLjA="), solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_B5_none_support() {
        var versions = List.of("1.0.0", "1.0.1", "2.0.0");
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("1.0.0", false);
        support.put("1.0.1", false);
        support.put("2.0.0", false);
        assertNull(solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_B6_single_version_supports() {
        var versions = List.of("5.0.0");
        assertEquals("5.0.0", solver.findEarliest(versions, v -> true));
    }

    @Test
    void scenario_B7_single_version_no_support() {
        var versions = List.of("5.0.0");
        assertNull(solver.findEarliest(versions, v -> false));
    }

    @Test
    void scenario_B8_empty_list() {
        var versions = List.<String>of();
        assertNull(solver.findEarliest(versions, v -> true));
    }

    @Test
    void scenario_B9_only_middle_supports() {
        // Only one version in the middle supports — would fool binary search
        var versions = List.of("1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.4");
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("1.0.0", false);
        support.put("1.0.1", false);
        support.put("1.0.2", true);  // only this one
        support.put("1.0.3", false);
        support.put("1.0.4", false);
        assertEquals(b("MS4wLjI="), solver.findEarliest(versions, support::get));
    }
}
