package sjer.red.openai.typesystem;

import org.junit.jupiter.api.Test;
import sjer.red.openai.typesystem.TypeSystemP2.Function;
import sjer.red.openai.typesystem.TypeSystemP2.Node;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class TypeSystemP2Test {

    private static boolean v(String val, String prefix) {
        try {
            var md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(val.getBytes(StandardCharsets.UTF_8));
            String hex = HexFormat.of().formatHex(hash);
            return hex.startsWith(prefix);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static Node p(String s) {
        return Node.parse(s);
    }

    // === Node regressions ===

    @Test
    void scenario_A1_node_parse_primitive() {
        assertTrue(v(p("int").toString(), "6da88c34"));
    }

    @Test
    void scenario_A2_node_parse_generic() {
        assertTrue(v(p("T1").toString(), "1f93603d"));
        assertTrue(p("T1").isGeneric());
    }

    @Test
    void scenario_A3_node_parse_tuple() {
        assertTrue(v(p("[int,str]").toString(), "55183dde"));
    }

    @Test
    void scenario_A4_node_parse_nested() {
        assertTrue(v(p("[int,[str,float]]").toString(), "07d1e12d"));
    }

    @Test
    void scenario_A5_node_equals() {
        assertEquals(p("[int,T1]"), p("[int,T1]"));
        assertNotEquals(p("[int,T1]"), p("[int,T2]"));
    }

    // === Function toString ===

    @Test
    void scenario_B1_function_toString() {
        var f = Function.of(List.of(p("int"), p("T1")), p("[T1,str]"));
        assertTrue(v(f.toString(), "25928055"));
    }

    @Test
    void scenario_B2_function_toString_no_params() {
        var f = Function.of(List.of(), p("int"));
        assertTrue(v(f.toString(), "76362442"));
    }

    @Test
    void scenario_B3_function_toString_all_concrete() {
        var f = Function.of(List.of(p("int"), p("str")), p("float"));
        assertTrue(v(f.toString(), "b2cd6d69"));
    }

    // === Happy path inference ===

    @Test
    void scenario_B4_single_generic() {
        // (T1) -> T1, actual [int] -> int
        var f = Function.of(List.of(p("T1")), p("T1"));
        assertTrue(v(f.getReturnType(List.of(p("int"))).toString(), "6da88c34"));
    }

    @Test
    void scenario_B5_two_generics() {
        // (T1, T2) -> [T1, T2], actual [int, str] -> [int,str]
        var f = Function.of(List.of(p("T1"), p("T2")), p("[T1,T2]"));
        assertTrue(v(f.getReturnType(List.of(p("int"), p("str"))).toString(), "55183dde"));
    }

    @Test
    void scenario_B6_repeated_generic() {
        // (T1, T1) -> T1, actual [int, int] -> int
        var f = Function.of(List.of(p("T1"), p("T1")), p("T1"));
        assertTrue(v(f.getReturnType(List.of(p("int"), p("int"))).toString(), "6da88c34"));
    }

    @Test
    void scenario_B7_swap_return() {
        // (T1, T2) -> [T2, T1], actual [int, str] -> [str,int]
        var f = Function.of(List.of(p("T1"), p("T2")), p("[T2,T1]"));
        assertTrue(v(f.getReturnType(List.of(p("int"), p("str"))).toString(), "c516261e"));
    }

    @Test
    void scenario_B8_concrete_passthrough() {
        // (int, str) -> float, actual [int, str] -> float
        var f = Function.of(List.of(p("int"), p("str")), p("float"));
        assertTrue(v(f.getReturnType(List.of(p("int"), p("str"))).toString(), "76a7e234"));
    }

    // === More inference ===

    @Test
    void scenario_B9_many_generics() {
        // (T1, T2, S) -> [S, T1, T2], actual [int, str, float] -> [float,int,str]
        var f = Function.of(List.of(p("T1"), p("T2"), p("S")), p("[S,T1,T2]"));
        assertTrue(v(f.getReturnType(List.of(p("int"), p("str"), p("float"))).toString(), "bed19b8d"));
    }

    @Test
    void scenario_B10_generic_repeated_in_return() {
        // (T1) -> [T1, T1, T1], actual [int] -> [int,int,int]
        var f = Function.of(List.of(p("T1")), p("[T1,T1,T1]"));
        assertTrue(v(f.getReturnType(List.of(p("int"))).toString(), "2be8655a"));
    }

    @Test
    void scenario_B11_mixed_concrete_generic() {
        // (int, T1, str) -> T1, actual [int, float, str] -> float
        var f = Function.of(List.of(p("int"), p("T1"), p("str")), p("T1"));
        assertTrue(v(f.getReturnType(List.of(p("int"), p("float"), p("str"))).toString(), "76a7e234"));
    }

    @Test
    void scenario_B12_nested_return_tuple() {
        // (T1, T2) -> [T2, [T1, float]], actual [int, str] -> [str,[int,float]]
        var f = Function.of(List.of(p("T1"), p("T2")), p("[T2,[T1,float]]"));
        assertTrue(v(f.getReturnType(List.of(p("int"), p("str"))).toString(), "00bae63a"));
    }

    @Test
    void scenario_B13_return_deeply_nested() {
        // (T1) -> [[T1]], actual [int] -> [[int]]
        var f = Function.of(List.of(p("T1")), p("[[T1]]"));
        var result = f.getReturnType(List.of(p("int")));
        assertFalse(result.isGeneric());
    }

    // === Error: argument count ===

    @Test
    void scenario_B14_error_too_few_args() {
        var f = Function.of(List.of(p("T1"), p("T2")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("int"))));
    }

    @Test
    void scenario_B15_error_too_many_args() {
        var f = Function.of(List.of(p("T1")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("int"), p("str"))));
    }

    @Test
    void scenario_B16_error_zero_args_when_expecting() {
        var f = Function.of(List.of(p("T1"), p("T2")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of()));
    }

    // === Error: concrete type mismatch ===

    @Test
    void scenario_B17_error_concrete_mismatch_first() {
        // (int, T1) -> T1, actual [str, float]
        var f = Function.of(List.of(p("int"), p("T1")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("str"), p("float"))));
    }

    @Test
    void scenario_B18_error_concrete_mismatch_middle() {
        // (T1, int, T2) -> T1, actual [str, float, int]
        var f = Function.of(List.of(p("T1"), p("int"), p("T2")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("str"), p("float"), p("int"))));
    }

    @Test
    void scenario_B19_error_concrete_mismatch_last() {
        // (T1, str) -> T1, actual [int, int]
        var f = Function.of(List.of(p("T1"), p("str")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("int"), p("int"))));
    }

    // === Error: generic conflict ===

    @Test
    void scenario_B20_error_generic_conflict_two() {
        // (T1, T1) -> T1, actual [int, str]
        var f = Function.of(List.of(p("T1"), p("T1")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("int"), p("str"))));
    }

    @Test
    void scenario_B21_error_generic_conflict_three() {
        // (T1, T1, T1) -> T1, actual [int, int, str]
        var f = Function.of(List.of(p("T1"), p("T1"), p("T1")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("int"), p("int"), p("str"))));
    }

    @Test
    void scenario_B22_error_generic_conflict_first_two_match() {
        // (T1, T1, T1) -> T1, actual [str, str, int]
        var f = Function.of(List.of(p("T1"), p("T1"), p("T1")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("str"), p("str"), p("int"))));
    }

    // === Edge cases ===

    @Test
    void scenario_B23_all_same_generic_all_same_type() {
        // (T1, T1, T1) -> T1, actual [float, float, float] -> float
        var f = Function.of(List.of(p("T1"), p("T1"), p("T1")), p("T1"));
        assertTrue(v(f.getReturnType(List.of(p("float"), p("float"), p("float"))).toString(), "76a7e234"));
    }

    @Test
    void scenario_B24_no_params_no_generics() {
        // () -> int, actual [] -> int
        var f = Function.of(List.of(), p("int"));
        assertTrue(v(f.getReturnType(List.of()).toString(), "6da88c34"));
    }

    @Test
    void scenario_B25_return_type_is_tuple_no_generics() {
        // (int) -> [str, float], actual [int] -> [str,float]
        var f = Function.of(List.of(p("int")), p("[str,float]"));
        var result = f.getReturnType(List.of(p("int")));
        assertFalse(result.isGeneric());
    }

    @Test
    void scenario_B26_generic_only_in_return() {
        // (int) -> T2, actual [int] -> T2 stays unbound
        var f = Function.of(List.of(p("int")), p("T2"));
        var result = f.getReturnType(List.of(p("int")));
        assertTrue(result.isGeneric());
        assertTrue(v(result.toString(), "0f617ba9"));
    }

    @Test
    void scenario_B27_four_distinct_generics() {
        // (T1, T2, T3, T4) -> [T4, T3, T2, T1], actual [int, str, float, int] -> [int,float,str,int]
        var f = Function.of(
            List.of(p("T1"), p("T2"), p("T3"), p("T4")),
            p("[T4,T3,T2,T1]")
        );
        var result = f.getReturnType(List.of(p("int"), p("str"), p("float"), p("int")));
        assertFalse(result.isGeneric());
    }
}
