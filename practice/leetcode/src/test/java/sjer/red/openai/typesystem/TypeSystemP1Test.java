package sjer.red.openai.typesystem;

import org.junit.jupiter.api.Test;
import sjer.red.openai.typesystem.TypeSystemP1.Node;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.*;

class TypeSystemP1Test {

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

    // --- Parse + toString: primitives ---

    @Test
    void scenario_A1_parse_int() {
        assertTrue(v(Node.parse("int").toString(), "6da88c34"));
    }

    @Test
    void scenario_A2_parse_float() {
        assertTrue(v(Node.parse("float").toString(), "76a7e234"));
    }

    @Test
    void scenario_A3_parse_str() {
        assertTrue(v(Node.parse("str").toString(), "8c25cb36"));
    }

    // --- Parse + toString: generics ---

    @Test
    void scenario_A4_parse_generic_T1() {
        assertTrue(v(Node.parse("T1").toString(), "1f93603d"));
    }

    @Test
    void scenario_A5_parse_generic_S() {
        assertTrue(v(Node.parse("S").toString(), "8de0b3c4"));
    }

    // --- Parse + toString: tuples ---

    @Test
    void scenario_A6_simple_tuple() {
        assertTrue(v(Node.parse("[int,str]").toString(), "55183dde"));
    }

    @Test
    void scenario_A7_nested_tuple() {
        assertTrue(v(Node.parse("[int,[str,float]]").toString(), "07d1e12d"));
    }

    @Test
    void scenario_A8_deeply_nested() {
        assertTrue(v(Node.parse("[int,[T1,[str,float]]]").toString(), "23a82d11"));
    }

    // --- isGeneric ---

    @Test
    void scenario_A9_isGeneric_primitive() {
        assertFalse(Node.parse("int").isGeneric());
    }

    @Test
    void scenario_A10_isGeneric_generic() {
        assertTrue(Node.parse("T1").isGeneric());
    }

    @Test
    void scenario_A11_isGeneric_tuple() {
        assertFalse(Node.parse("[int,str]").isGeneric());
    }

    @Test
    void scenario_A12_isGeneric_single_letter() {
        assertTrue(Node.parse("T").isGeneric());
        assertTrue(v(Node.parse("T").toString(), "e632b709"));
    }

    @Test
    void scenario_A13_isGeneric_multi_digit() {
        assertTrue(Node.parse("T12").isGeneric());
        assertTrue(v(Node.parse("T12").toString(), "8fd4b56e"));
    }

    // --- More parse edge cases ---

    @Test
    void scenario_A14_single_element_tuple() {
        assertTrue(v(Node.parse("[int]").toString(), "8fb78391"));
    }

    @Test
    void scenario_A15_triple_nested() {
        assertTrue(v(Node.parse("[[[[int]]]]").toString(), "fab4f9a3"));
    }

    @Test
    void scenario_A16_all_generic_tuple() {
        assertTrue(v(Node.parse("[T1,T2,T3]").toString(), "6bef3828"));
    }

    @Test
    void scenario_A17_parse_with_spaces() {
        // parse should handle whitespace in input
        assertTrue(v(Node.parse("[int, str]").toString(), "55183dde"));
    }

    @Test
    void scenario_A18_parse_nested_with_spaces() {
        assertTrue(v(Node.parse("[int, [str, float]]").toString(), "07d1e12d"));
    }

    @Test
    void scenario_A19_three_element_tuple() {
        var node = Node.parse("[int,float,str]");
        assertFalse(node.isGeneric());
        // toString should be [int,float,str]
        String s = node.toString();
        assertTrue(s.startsWith("["));
        assertTrue(s.endsWith("]"));
        assertFalse(s.contains(" "));
    }

    // --- equals / hashCode ---

    @Test
    void scenario_A20_equals_same_primitive() {
        assertEquals(Node.parse("int"), Node.parse("int"));
    }

    @Test
    void scenario_A21_equals_different_primitive() {
        assertNotEquals(Node.parse("int"), Node.parse("str"));
    }

    @Test
    void scenario_A22_equals_same_generic() {
        assertEquals(Node.parse("T1"), Node.parse("T1"));
    }

    @Test
    void scenario_A23_equals_different_generic() {
        assertNotEquals(Node.parse("T1"), Node.parse("T2"));
    }

    @Test
    void scenario_A24_equals_same_tuple() {
        assertEquals(Node.parse("[int,T1]"), Node.parse("[int,T1]"));
    }

    @Test
    void scenario_A25_equals_different_tuple() {
        assertNotEquals(Node.parse("[int,T1]"), Node.parse("[int,T2]"));
    }

    @Test
    void scenario_A26_equals_nested_tuple() {
        assertEquals(
            Node.parse("[int,[str,float]]"),
            Node.parse("[int,[str,float]]")
        );
    }

    @Test
    void scenario_A27_equals_nested_tuple_different() {
        assertNotEquals(
            Node.parse("[int,[str,float]]"),
            Node.parse("[int,[float,str]]")
        );
    }

    @Test
    void scenario_A28_equals_primitive_vs_generic() {
        // "int" is a primitive, not a generic — they should not be equal
        assertNotEquals(Node.parse("int"), Node.parse("T1"));
    }

    @Test
    void scenario_A29_hashCode_consistency() {
        var a = Node.parse("[int,[T1,str]]");
        var b = Node.parse("[int,[T1,str]]");
        assertEquals(a.hashCode(), b.hashCode());
    }

    @Test
    void scenario_A30_equals_tuple_different_length() {
        assertNotEquals(Node.parse("[int,str]"), Node.parse("[int,str,float]"));
    }
}
