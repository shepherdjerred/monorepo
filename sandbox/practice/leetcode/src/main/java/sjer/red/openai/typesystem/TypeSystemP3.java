package sjer.red.openai.typesystem;

import java.util.List;

/**
 * PROBLEM: Toy Language Type System
 * <p>
 * PART 3: Nested Tuple Matching and Function Parsing (cumulative ~45 minutes)
 * <p>
 * getReturnType now handles tuple parameters:
 * - When a function param is a tuple, the actual arg must also be a tuple
 * - Matching recurses into tuple children to bind generics
 * - Same generic appearing in flat and nested positions must bind consistently
 * <p>
 * Additional errors (throw IllegalArgumentException):
 * - Tuple arity mismatch (function param tuple has different number of children than actual)
 * - Non-tuple actual for tuple param, or tuple actual for non-tuple param
 * <p>
 * Function.parse(String): parse a function signature string
 * - Format: "[param1, param2, ...] -> returnType"
 * - "[int, T1] -> [T1, str]" -> Function with params [int, T1], return [T1, str]
 * - "[int, [T1, str]] -> T1" -> nested tuple in params
 * - "[] -> int" -> no params
 * <p>
 * Examples:
 * Function f = Function.of(params, ret);
 * // where params = [[T1, int]], ret = T1
 * f.getReturnType(List.of(parse("[str,int]")))  -> parse("str")
 * <p>
 * // where params = [[T1, [T2, int]]], ret = [T1, T2]
 * f.getReturnType(List.of(parse("[str,[float,int]]")))  -> parse("[str,float]")
 * <p>
 * Function.parse("[T1, [T2, int]] -> [T1, T2]").toString() -> "(T1,[T2,int]) -> [T1,T2]"
 * <p>
 * TIME TARGET: ~15 minutes (cumulative ~45 minutes)
 */
public class TypeSystemP3 {

    public static class Node {

        public static Node parse(String input) {
            throw new UnsupportedOperationException("Not yet implemented");
        }

        public boolean isGeneric() {
            throw new UnsupportedOperationException("Not yet implemented");
        }

        @Override
        public String toString() {
            throw new UnsupportedOperationException("Not yet implemented");
        }

        @Override
        public boolean equals(Object o) {
            throw new UnsupportedOperationException("Not yet implemented");
        }

        @Override
        public int hashCode() {
            throw new UnsupportedOperationException("Not yet implemented");
        }
    }

    public static class Function {

        /**
         * Create a function type with the given parameter types and return type.
         */
        public static Function of(List<Node> params, Node returnType) {
            throw new UnsupportedOperationException("Not yet implemented");
        }

        /**
         * Parse a function signature string.
         * Format: "[param1, param2, ...] -> returnType"
         */
        public static Function parse(String input) {
            throw new UnsupportedOperationException("Not yet implemented");
        }

        /**
         * Infer the concrete return type given actual parameter types.
         * Handles tuple parameters recursively.
         *
         * @throws IllegalArgumentException on argument count mismatch, type mismatch,
         *         generic conflict, tuple arity mismatch, or tuple/non-tuple mismatch
         */
        public Node getReturnType(List<Node> actualParams) {
            throw new UnsupportedOperationException("Not yet implemented");
        }

        @Override
        public String toString() {
            throw new UnsupportedOperationException("Not yet implemented");
        }
    }
}
