package sjer.red.openai.typesystem;

import org.junit.jupiter.api.Test;
import sjer.red.openai.typesystem.TypeSystemP3.Function;
import sjer.red.openai.typesystem.TypeSystemP3.Node;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class TypeSystemP3Test {

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
    void scenario_A1_node_parse() {
        assertTrue(v(p("[int,[T1,str]]").toString(), "78fcab38"));
        // structural check
        assertEquals(p("[int,T1]"), p("[int,T1]"));
    }

    @Test
    void scenario_A2_node_isGeneric() {
        assertTrue(p("T1").isGeneric());
        assertFalse(p("int").isGeneric());
        assertFalse(p("[int,str]").isGeneric());
    }

    @Test
    void scenario_A3_node_equals() {
        assertEquals(p("[int,[str,float]]"), p("[int,[str,float]]"));
        assertNotEquals(p("[int,[str,float]]"), p("[int,[float,str]]"));
    }

    // === Flat inference regressions ===

    @Test
    void scenario_B1_flat_inference_happy() {
        var f = Function.of(List.of(p("T1"), p("T2")), p("[T2,T1]"));
        assertTrue(v(f.getReturnType(List.of(p("int"), p("str"))).toString(), "c516261e"));
    }

    @Test
    void scenario_B2_flat_concrete_mismatch() {
        var f = Function.of(List.of(p("int"), p("T1")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("str"), p("float"))));
    }

    @Test
    void scenario_B3_flat_generic_conflict() {
        var f = Function.of(List.of(p("T1"), p("T1")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("int"), p("str"))));
    }

    // === Tuple param binding ===

    @Test
    void scenario_C1_simple_tuple_param() {
        // ([T1, int]) -> T1, actual [[str, int]] -> str
        var f = Function.of(List.of(p("[T1,int]")), p("T1"));
        assertTrue(v(f.getReturnType(List.of(p("[str,int]"))).toString(), "8c25cb36"));
    }

    @Test
    void scenario_C2_nested_tuple_two_generics() {
        // ([T1, [T2, int]]) -> [T1, T2], actual [[str, [float, int]]] -> [str,float]
        var f = Function.of(List.of(p("[T1,[T2,int]]")), p("[T1,T2]"));
        assertTrue(v(f.getReturnType(List.of(p("[str,[float,int]]"))).toString(), "494f4247"));
    }

    @Test
    void scenario_C3_two_tuple_params() {
        // ([T1, int], [T2, str]) -> [T1, T2], actual [[str, int], [float, str]] -> [str,float]
        var f = Function.of(List.of(p("[T1,int]"), p("[T2,str]")), p("[T1,T2]"));
        assertTrue(v(f.getReturnType(List.of(p("[str,int]"), p("[float,str]"))).toString(), "494f4247"));
    }

    @Test
    void scenario_C4_shared_generic_across_tuples() {
        // ([T1, float], [T1, str]) -> [T1, T1], actual [[int, float], [int, str]] -> [int,int]
        var f = Function.of(List.of(p("[T1,float]"), p("[T1,str]")), p("[T1,T1]"));
        assertTrue(v(f.getReturnType(List.of(p("[int,float]"), p("[int,str]"))).toString(), "d06c548f"));
    }

    // === Deep nesting ===

    @Test
    void scenario_C5_double_nested() {
        // ([[T1, T2]]) -> [T2, T1], actual [[[int, str]]] -> [str,int]
        var f = Function.of(List.of(p("[[T1,T2]]")), p("[T2,T1]"));
        assertTrue(v(f.getReturnType(List.of(p("[[int,str]]"))).toString(), "c516261e"));
    }

    @Test
    void scenario_C6_triple_nested() {
        // ([[[T1]]]) -> T1, actual [[[[int]]]] -> int
        var f = Function.of(List.of(p("[[[T1]]]")), p("T1"));
        assertTrue(v(f.getReturnType(List.of(p("[[[int]]]"))).toString(), "6da88c34"));
    }

    @Test
    void scenario_C7_generic_multiple_nested_levels() {
        // ([T1, [T1, int]]) -> T1, actual [[str, [str, int]]] -> str (T1=str consistent)
        var f = Function.of(List.of(p("[T1,[T1,int]]")), p("T1"));
        assertTrue(v(f.getReturnType(List.of(p("[str,[str,int]]"))).toString(), "8c25cb36"));
    }

    @Test
    void scenario_C8_tuple_mixed_primitives_generics() {
        // ([int, T1, [T2, float]]) -> [T2, T1], actual [[int, str, [int, float]]] -> [int,str]
        var f = Function.of(List.of(p("[int,T1,[T2,float]]")), p("[T2,T1]"));
        var result = f.getReturnType(List.of(p("[int,str,[int,float]]")));
        assertFalse(result.isGeneric());
    }

    // === Cross-position: generic in flat and tuple ===

    @Test
    void scenario_C9_generic_flat_and_tuple() {
        // (T1, [T1, T2]) -> T2, actual [int, [int, str]] -> str
        var f = Function.of(List.of(p("T1"), p("[T1,T2]")), p("T2"));
        assertTrue(v(f.getReturnType(List.of(p("int"), p("[int,str]"))).toString(), "8c25cb36"));
    }

    @Test
    void scenario_C10_generic_conflict_flat_and_tuple() {
        // (T1, [T1, T2]) -> T2, actual [int, [str, float]] -> throws (T1=int vs T1=str)
        var f = Function.of(List.of(p("T1"), p("[T1,T2]")), p("T2"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("int"), p("[str,float]"))));
    }

    @Test
    void scenario_C11_same_generic_three_nesting_levels() {
        // (T1, [T1], [[T1]]) -> T1, actual [int, [int], [[int]]] -> int
        var f = Function.of(List.of(p("T1"), p("[T1]"), p("[[T1]]")), p("T1"));
        assertTrue(v(f.getReturnType(List.of(p("int"), p("[int]"), p("[[int]]"))).toString(), "6da88c34"));
    }

    @Test
    void scenario_C12_same_generic_three_levels_conflict() {
        // (T1, [T1], [[T1]]) -> T1, actual [int, [int], [[str]]] -> throws
        var f = Function.of(List.of(p("T1"), p("[T1]"), p("[[T1]]")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("int"), p("[int]"), p("[[str]]"))));
    }

    // === Tuple errors ===

    @Test
    void scenario_C13_tuple_arity_mismatch() {
        // ([T1, T2]) -> T1, actual [[int]] (1 child vs 2 expected)
        var f = Function.of(List.of(p("[T1,T2]")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("[int]"))));
    }

    @Test
    void scenario_C14_non_tuple_for_tuple_param() {
        // ([T1, T2]) -> T1, actual [int] (primitive instead of tuple)
        var f = Function.of(List.of(p("[T1,T2]")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("int"))));
    }

    @Test
    void scenario_C15_tuple_for_non_tuple_param() {
        // (T1) -> T1, actual [[int,str]] (tuple for generic param)
        // This should bind T1 to the tuple [int,str], which is valid
        var f = Function.of(List.of(p("T1")), p("T1"));
        var result = f.getReturnType(List.of(p("[int,str]")));
        assertTrue(v(result.toString(), "55183dde"));
    }

    @Test
    void scenario_C15b_tuple_for_concrete_param() {
        // (int) -> int, actual [[int,str]] -> throws (expected int, got tuple)
        var f = Function.of(List.of(p("int")), p("int"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("[int,str]"))));
    }

    @Test
    void scenario_C15c_nested_arity_mismatch() {
        // ([T1, [T2, T3]]) -> T1, actual [[int, [str]]] -> throws (inner tuple 1 vs 2)
        var f = Function.of(List.of(p("[T1,[T2,T3]]")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("[int,[str]]"))));
    }

    // === Function.parse ===

    @Test
    void scenario_C16_parse_simple() {
        var f = Function.parse("[int, T1] -> [T1, str]");
        assertTrue(v(f.toString(), "25928055"));
    }

    @Test
    void scenario_C17_parse_nested_tuple() {
        var f = Function.parse("[int, [T1, str]] -> T1");
        assertTrue(v(f.toString(), "52aae446"));
    }

    @Test
    void scenario_C18_parse_no_params() {
        var f = Function.parse("[] -> int");
        assertTrue(v(f.toString(), "76362442"));
    }

    // === End-to-end: parse then infer ===

    @Test
    void scenario_C19_parse_and_infer() {
        // parse "[T1, [T2, int]] -> [T2, T1]", infer with [str, [float, int]] -> [float,str]
        var f = Function.parse("[T1, [T2, int]] -> [T2, T1]");
        assertTrue(v(f.getReturnType(List.of(p("str"), p("[float,int]"))).toString(), "a2234079"));
    }

    @Test
    void scenario_C20_parse_toString_roundtrip() {
        var f = Function.parse("[int, T1] -> [T1, str]");
        assertTrue(v(f.toString(), "25928055"));
    }

    @Test
    void scenario_C21_parse_deeply_nested() {
        var f = Function.parse("[[T1, T2]] -> [T2, T1]");
        assertTrue(v(f.toString(), "da3ec09c"));
    }

    @Test
    void scenario_C22_parse_complex_roundtrip() {
        var f = Function.parse("[T1, [T2, int], T1] -> [T2, T1]");
        // verify toString
        var s = f.toString();
        assertTrue(s.contains("T1"));
        assertTrue(s.contains("T2"));
        assertTrue(s.contains("->"));
    }

    @Test
    void scenario_C23_parse_and_infer_conflict() {
        // parse "[T1, T1] -> T1", infer with [int, str] -> throws
        var f = Function.parse("[T1, T1] -> T1");
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("int"), p("str"))));
    }

    // === Edge cases ===

    @Test
    void scenario_C24_all_generic_tuple() {
        // ([T1, T2, T3]) -> [T3, T2, T1], actual [[int, str, float]] -> [float,str,int]
        var f = Function.of(List.of(p("[T1,T2,T3]")), p("[T3,T2,T1]"));
        assertTrue(v(f.getReturnType(List.of(p("[int,str,float]"))).toString(), "9b438ef0"));
    }

    @Test
    void scenario_C25_return_deeper_than_params() {
        // (T1, T2) -> [[T1, T2]], actual [int, str] -> [[int,str]]
        var f = Function.of(List.of(p("T1"), p("T2")), p("[[T1,T2]]"));
        assertTrue(v(f.getReturnType(List.of(p("int"), p("str"))).toString(), "665eb586"));
    }

    @Test
    void scenario_C26_generic_bound_to_tuple_in_flat_position() {
        // (T1) -> [T1, int], actual [[str, float]] -> [[str,float],int]
        var f = Function.of(List.of(p("T1")), p("[T1,int]"));
        var result = f.getReturnType(List.of(p("[str,float]")));
        assertFalse(result.isGeneric());
    }

    @Test
    void scenario_C27_generic_bound_to_tuple_conflict() {
        // (T1, T1) -> T1, actual [[int,str], [int,float]] -> throws (T1 bound to [int,str] vs [int,float])
        var f = Function.of(List.of(p("T1"), p("T1")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("[int,str]"), p("[int,float]"))));
    }

    @Test
    void scenario_C28_generic_bound_to_tuple_consistent() {
        // (T1, T1) -> T1, actual [[int,str], [int,str]] -> [int,str]
        var f = Function.of(List.of(p("T1"), p("T1")), p("T1"));
        assertTrue(v(f.getReturnType(List.of(p("[int,str]"), p("[int,str]"))).toString(), "55183dde"));
    }

    @Test
    void scenario_C29_concrete_mismatch_inside_tuple() {
        // ([int, T1]) -> T1, actual [[str, float]] -> throws (expected int, got str inside tuple)
        var f = Function.of(List.of(p("[int,T1]")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("[str,float]"))));
    }

    @Test
    void scenario_C30_conflict_inside_nested_tuple() {
        // ([T1, [T1, int]]) -> T1, actual [[str, [int, int]]] -> throws (T1=str vs T1=int)
        var f = Function.of(List.of(p("[T1,[T1,int]]")), p("T1"));
        assertThrows(IllegalArgumentException.class,
            () -> f.getReturnType(List.of(p("[str,[int,int]]"))));
    }
}
