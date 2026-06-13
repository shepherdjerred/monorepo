package sjer.red.openai.dependencyversioncheck;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import sjer.red.openai.dependencyversioncheck.attempt1.DependencyVersionCheckP1;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;

class DependencyVersionCheckP1Test {
    private DependencyVersionCheckP1 solver;

    private static String b(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }

    @BeforeEach
    void setUp() {
        solver = new DependencyVersionCheckP1();
    }

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
        // With 1000 versions, binary search should need at most ~10 calls
        var versions = new ArrayList<String>();
        for (int i = 0; i < 1000; i++) versions.add(String.valueOf(i));
        AtomicInteger calls = new AtomicInteger(0);
        Function<String, Boolean> check = v -> {
            calls.incrementAndGet();
            return Integer.parseInt(v) >= 500;
        };
        assertEquals("500", solver.findEarliest(versions, check));
        assertTrue(calls.get() <= 12, "Expected <=12 calls, got " + calls.get());
    }

    @Test
    void scenario_A6_single_supports() {
        var versions = List.of("1.0");
        Function<String, Boolean> check = v -> true;
        assertEquals(b("MS4w"), solver.findEarliest(versions, check));
    }

    @Test
    void scenario_A7_single_no_support() {
        var versions = List.of("1.0");
        Function<String, Boolean> check = v -> false;
        assertNull(solver.findEarliest(versions, check));
    }

    @Test
    void scenario_A8_second_supports() {
        var versions = List.of("1.0", "2.0");
        Function<String, Boolean> check = v -> v.equals("2.0");
        assertEquals(b("Mi4w"), solver.findEarliest(versions, check));
    }

    @Test
    void scenario_A9_all_support() {
        var versions = List.of("1.0", "2.0", "3.0");
        Function<String, Boolean> check = v -> true;
        assertEquals(b("MS4w"), solver.findEarliest(versions, check));
    }

    @Test
    void scenario_A10_empty_list() {
        var versions = List.<String>of();
        Function<String, Boolean> check = v -> true;
        assertNull(solver.findEarliest(versions, check));
    }
}
