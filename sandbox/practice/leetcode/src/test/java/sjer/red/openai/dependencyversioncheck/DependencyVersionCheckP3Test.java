package sjer.red.openai.dependencyversioncheck;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import sjer.red.openai.dependencyversioncheck.attempt1.DependencyVersionCheckP3;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
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

    // --- Regression: Part 1 (A tests - monotonic data) ---

    @Test
    void scenario_A1_basic() {
        var versions = List.of("1.0.0", "1.1.0", "1.2.0", "1.3.0", "2.0.0");
        Function<String, Boolean> check = v -> v.compareTo("1.2.0") >= 0;
        assertEquals(b("MS4yLjA="), solver.findEarliest(versions, check));
    }

    @Test
    void scenario_A2_first_version() {
        var versions = List.of("1.0.0", "2.0.0", "3.0.0");
        Function<String, Boolean> check = v -> true;
        assertEquals(b("MS4wLjA="), solver.findEarliest(versions, check));
    }

    @Test
    void scenario_A3_none_support() {
        var versions = List.of("1.0.0", "2.0.0", "3.0.0");
        Function<String, Boolean> check = v -> false;
        assertNull(solver.findEarliest(versions, check));
    }

    // --- Regression: Part 2 (B tests - non-monotonic) ---

    @Test
    void scenario_B1_broken_monotonicity() {
        var versions = List.of("1.0.0", "1.0.1", "1.1.0", "1.1.1", "2.0.0", "2.0.1");
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("1.0.0", false);
        support.put("1.0.1", true);
        support.put("1.1.0", false);
        support.put("1.1.1", true);
        support.put("2.0.0", true);
        support.put("2.0.1", true);
        // Answer: 1.0.1
        assertEquals(b("MS4wLjE="), solver.findEarliest(versions, support::get));
    }

    // --- Part 3: Hierarchical binary search ---
    // Tests verify both correctness AND that call count is sub-linear

    @Test
    void scenario_C1_hierarchical_basic() {
        // 3 major groups x 2 minor groups x 2 patches = 12 versions
        // Major 1: last is 1.1.1 → false (no support in major 1)
        // Major 2: last is 2.1.1 → true  (first supporting major)
        // Within major 2: minor 0 last is 2.0.1 → true (first supporting minor)
        // Within 2.0.*: 2.0.0 → false, 2.0.1 → true (earliest is 2.0.1)
        var versions = List.of(
                "1.0.0", "1.0.1", "1.1.0", "1.1.1",
                "2.0.0", "2.0.1", "2.1.0", "2.1.1",
                "3.0.0", "3.0.1", "3.1.0", "3.1.1"
        );
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("1.0.0", false);
        support.put("1.0.1", false);
        support.put("1.1.0", false);
        support.put("1.1.1", false);
        support.put("2.0.0", false);
        support.put("2.0.1", true);   // earliest!
        support.put("2.1.0", true);
        support.put("2.1.1", true);
        support.put("3.0.0", true);
        support.put("3.0.1", true);
        support.put("3.1.0", true);
        support.put("3.1.1", true);
        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return support.get(v);
        };
        assertEquals(b("Mi4wLjE="), solver.findEarliest(versions, check));
        // Hierarchical: log2(3) + log2(2) + log2(2) ≈ 5 calls, not 12
        assertTrue(calls.get() <= 8, "Expected sub-linear calls, got " + calls.get());
    }

    @Test
    void scenario_C2_first_major_supports() {
        // First major group already has support
        var versions = List.of(
                "1.0.0", "1.0.1", "1.1.0", "1.1.1",
                "2.0.0", "2.0.1", "2.1.0", "2.1.1"
        );
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("1.0.0", true);   // earliest!
        support.put("1.0.1", true);
        support.put("1.1.0", true);
        support.put("1.1.1", true);
        support.put("2.0.0", true);
        support.put("2.0.1", true);
        support.put("2.1.0", true);
        support.put("2.1.1", true);
        assertEquals(b("MS4wLjA="), solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_C3_last_major_supports() {
        var versions = List.of(
                "1.0.0", "1.0.1",
                "2.0.0", "2.0.1",
                "3.0.0", "3.0.1"
        );
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("1.0.0", false);
        support.put("1.0.1", false);
        support.put("2.0.0", false);
        support.put("2.0.1", false);
        support.put("3.0.0", false);
        support.put("3.0.1", true);  // only last patch of last major
        assertEquals(b("My4wLjE="), solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_C4_non_monotonic_within_minor() {
        // Within a minor group, earlier patch supports but later doesn't
        // But last version (2.0.3) supports → group is "supporting"
        var versions = List.of("2.0.0", "2.0.1", "2.0.2", "2.0.3");
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("2.0.0", true);   // earliest!
        support.put("2.0.1", false);  // non-monotonic within patches
        support.put("2.0.2", true);
        support.put("2.0.3", true);   // last version supports → group supports
        assertEquals(b("Mi4wLjA="), solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_C5_none_support() {
        var versions = List.of("1.0.0", "1.0.1", "2.0.0");
        assertNull(solver.findEarliest(versions, v -> false));
    }

    @Test
    void scenario_C6_empty_list() {
        assertNull(solver.findEarliest(List.of(), v -> true));
    }

    @Test
    void scenario_C7_single_version_supports() {
        assertEquals("1.0.0", solver.findEarliest(List.of("1.0.0"), v -> true));
    }

    @Test
    void scenario_C8_single_version_no_support() {
        assertNull(solver.findEarliest(List.of("1.0.0"), v -> false));
    }

    @Test
    void scenario_C9_efficiency_large() {
        // 10 majors x 10 minors x 10 patches = 1000 versions
        // Support starts at major 5, minor 3, patch 7 → version "5.3.7"
        // Hierarchical binary search should need ~log2(10)*3 ≈ 10-12 calls, not 1000
        var versions = new ArrayList<String>();
        var supportSet = new LinkedHashMap<String, Boolean>();

        for (int major = 0; major < 10; major++) {
            for (int minor = 0; minor < 10; minor++) {
                for (int patch = 0; patch < 10; patch++) {
                    String v = major + "." + minor + "." + patch;
                    versions.add(v);
                    // Last version per major (M.9.9) supports if major >= 5
                    // Last version per minor in major 5 (5.N.9) supports if minor >= 3
                    // Within 5.3.*, patch supports if patch >= 7
                    // All later majors/minors/patches: last versions support
                    boolean supports;
                    if (major > 5) {
                        supports = true;
                    } else if (major < 5) {
                        supports = false;
                    } else {
                        // major == 5
                        if (minor > 3) {
                            supports = true;
                        } else if (minor < 3) {
                            supports = false;
                        } else {
                            // major == 5, minor == 3
                            supports = patch >= 7;
                        }
                    }
                    supportSet.put(v, supports);
                }
            }
        }

        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return supportSet.get(v);
        };

        String result = solver.findEarliest(versions, check);
        assertEquals("5.3.7", result);
        // Should be O(log 10 + log 10 + log 10) ≈ 10-12 calls, not 1000
        assertTrue(calls.get() <= 20,
                "Expected O(log) calls for hierarchical search, got " + calls.get() + " (out of 1000 versions)");
    }

    @Test
    void scenario_C10_support_in_first_patch() {
        var versions = List.of(
                "1.0.0", "1.0.1", "1.1.0", "1.1.1",
                "2.0.0", "2.0.1"
        );
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("1.0.0", true);   // very first version
        support.put("1.0.1", true);
        support.put("1.1.0", true);
        support.put("1.1.1", true);
        support.put("2.0.0", true);
        support.put("2.0.1", true);
        assertEquals(b("MS4wLjA="), solver.findEarliest(versions, support::get));
    }

    @Test
    void scenario_C11_multiple_minors_in_winning_major() {
        // Major 3 is the first supporting major
        // Within major 3, minor 2 is the first supporting minor
        // Within 3.2.*, patch 0 is the earliest
        var versions = List.of(
                "1.0.0", "1.0.1",
                "2.0.0", "2.0.1",
                "3.0.0", "3.0.1", "3.1.0", "3.1.1", "3.2.0", "3.2.1",
                "4.0.0", "4.0.1"
        );
        Map<String, Boolean> support = new LinkedHashMap<>();
        support.put("1.0.0", false);
        support.put("1.0.1", false);
        support.put("2.0.0", false);
        support.put("2.0.1", false);
        support.put("3.0.0", false);
        support.put("3.0.1", false);  // last of minor 0 → false
        support.put("3.1.0", false);
        support.put("3.1.1", false);  // last of minor 1 → false
        support.put("3.2.0", true);   // earliest!
        support.put("3.2.1", true);   // last of minor 2 → true
        support.put("4.0.0", true);
        support.put("4.0.1", true);
        assertEquals(b("My4yLjA="), solver.findEarliest(versions, support::get));
    }
}
