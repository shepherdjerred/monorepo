package sjer.red.openai.typesystem;

import java.util.List;

/**
 * PROBLEM: Toy Language Type System
 * <p>
 * PART 2: Function Type and Return Type Inference (flat parameters)
 * <p>
 * A Function has parameter types (list of Nodes) and a return type (Node).
 * <p>
 * toString(): "(param1,param2,...) -> returnType"
 * - (int,T1) -> [T1,str]
 * - () -> int (no parameters)
 * <p>
 * getReturnType(actualParams): given a list of concrete (non-generic) actual parameter
 * types, infer the concrete return type.
 * - Match actual params to function params positionally
 * - When a function param is generic, bind it to the actual type
 * - When a function param is concrete, the actual must match exactly
 * - Substitute all bound generics in the return type
 * - Only flat (non-tuple) parameter matching in this part
 * <p>
 * Errors (throw IllegalArgumentException):
 * - Argument count mismatch
 * - Concrete type mismatch (expected int, got str)
 * - Generic conflict (same generic bound to different types)
 * <p>
 * Examples:
 * Function f1 = Function.of(List.of(p("T1"), p("T2")), parse("[T1,T2]"));
 * f1.getReturnType(List.of(p("int"), p("str"))).toString() -> "[int,str]"
 * <p>
 * Function f2 = Function.of(List.of(p("T1"), p("T1")), p("T1"));
 * f2.getReturnType(List.of(p("int"), p("int"))).toString() -> "int"
 * f2.getReturnType(List.of(p("int"), p("str")))            -> throws (generic conflict)
 * <p>
 * Function f3 = Function.of(List.of(p("int"), p("T1")), p("T1"));
 * f3.getReturnType(List.of(p("str"), p("float")))          -> throws (concrete mismatch)
 * <p>
 * TIME TARGET: ~15 minutes (cumulative ~30 minutes)
 */
public class TypeSystemP2 {

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
         * Infer the concrete return type given actual parameter types.
         *
         * @throws IllegalArgumentException on argument count mismatch, concrete type
         *         mismatch, or generic binding conflict
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
