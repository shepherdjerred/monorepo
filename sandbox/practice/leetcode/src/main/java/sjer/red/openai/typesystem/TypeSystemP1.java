package sjer.red.openai.typesystem;

import java.util.List;

/**
 * PROBLEM: Toy Language Type System
 * <p>
 * PART 1: Node Representation and String Parsing
 * <p>
 * A Node represents a type in a toy language. There are three kinds:
 * - Primitives: int, float, str
 * - Generics: T, T1, T2, S (an uppercase letter optionally followed by digits)
 * - Tuples: ordered collections of types, e.g. [int, T1, str]
 * <p>
 * toString():
 * - Primitive or generic: return the name as-is ("int", "T1")
 * - Tuple: comma-separated children in brackets, no spaces ("[int,float]", "[int,[str,T1]]")
 * <p>
 * parse(String):
 * - "int" -> primitive node
 * - "T1" -> generic node
 * - "[int,str]" -> tuple of two primitives
 * - "[int,[T1,[str,float]]]" -> nested tuple
 * <p>
 * isGeneric(): returns true if this node is a generic type
 * <p>
 * equals/hashCode: structural equality
 * <p>
 * Examples:
 * Node.parse("int").toString()                    -> "int"
 * Node.parse("T1").toString()                     -> "T1"
 * Node.parse("[int,str]").toString()              -> "[int,str]"
 * Node.parse("[int,[str,float]]").toString()      -> "[int,[str,float]]"
 * Node.parse("T1").isGeneric()                    -> true
 * Node.parse("int").isGeneric()                   -> false
 * Node.parse("[int,str]").isGeneric()             -> false
 * Node.parse("[int,T1]").equals(Node.parse("[int,T1]"))  -> true
 * <p>
 * TIME TARGET: ~15 minutes
 */
public class TypeSystemP1 {

    public static class Node {

        /**
         * Parse a type string into a Node.
         */
        public static Node parse(String input) {
            throw new UnsupportedOperationException("Not yet implemented");
        }

        /**
         * Returns true if this node is a generic type.
         */
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
}
